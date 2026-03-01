"""
Fine-tune nvidia/Llama-3.1-Nemotron-70B-Instruct-HF with QLoRA + TRL SFTTrainer
on the trAIl hotspot prediction dataset.

Usage (Brev 2x A100 80GB):
    torchrun --nproc_per_node=2 02_finetune/finetune.py --config 02_finetune/config.yaml

Prerequisites:
    pip install -r requirements.txt
    huggingface-cli login          # nvidia/* models require HF access request approval
    # optional: wandb login
"""
import argparse
import json
import logging
import os
from pathlib import Path

import torch
import yaml
from datasets import Dataset, load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
)
from trl import SFTTrainer, DataCollatorForCompletionOnlyLM

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)


def load_config(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def load_jsonl_dataset(path: str) -> Dataset:
    data = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                data.append(json.loads(line))
    return Dataset.from_list(data)


def format_chat(example: dict, tokenizer) -> dict:
    """Apply the model's built-in chat template to the messages list."""
    text = tokenizer.apply_chat_template(
        example["messages"],
        tokenize=False,
        add_generation_prompt=False,
    )
    return {"text": text}


def build_bnb_config(cfg: dict) -> BitsAndBytesConfig:
    model_cfg = cfg["model"]
    dtype_map = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}
    compute_dtype = dtype_map.get(model_cfg.get("bnb_4bit_compute_dtype", "bfloat16"), torch.bfloat16)
    return BitsAndBytesConfig(
        load_in_4bit=model_cfg.get("load_in_4bit", True),
        bnb_4bit_compute_dtype=compute_dtype,
        bnb_4bit_quant_type=model_cfg.get("bnb_4bit_quant_type", "nf4"),
        bnb_4bit_use_double_quant=model_cfg.get("use_nested_quant", True),
    )


def build_lora_config(cfg: dict) -> LoraConfig:
    lora_cfg = cfg["lora"]
    return LoraConfig(
        r=lora_cfg["rank"],
        lora_alpha=lora_cfg["alpha"],
        lora_dropout=lora_cfg.get("dropout", 0.05),
        target_modules=lora_cfg["target_modules"],
        bias=lora_cfg.get("bias", "none"),
        task_type=lora_cfg.get("task_type", "CAUSAL_LM"),
        inference_mode=False,
    )


def build_training_args(cfg: dict, local_rank: int) -> TrainingArguments:
    t = cfg["training"]
    o = cfg["output"]
    wandb_cfg = cfg.get("wandb", {})

    # Only rank 0 reports to wandb
    report_to = "wandb" if (os.getenv("WANDB_API_KEY") and local_rank == 0) else "none"

    return TrainingArguments(
        output_dir=o["dir"],
        num_train_epochs=t["epochs"],
        per_device_train_batch_size=t["per_device_batch_size"],
        gradient_accumulation_steps=t["gradient_accumulation_steps"],
        learning_rate=t["learning_rate"],
        lr_scheduler_type=t["lr_scheduler_type"],
        warmup_ratio=t["warmup_ratio"],
        weight_decay=t["weight_decay"],
        max_grad_norm=t["max_grad_norm"],
        fp16=t.get("fp16", False),
        bf16=t.get("bf16", True),
        gradient_checkpointing=t.get("gradient_checkpointing", True),
        optim=t.get("optim", "paged_adamw_8bit"),
        save_strategy=o["save_strategy"],
        save_steps=o["save_steps"],
        save_total_limit=o.get("save_total_limit", 3),
        eval_strategy=o["eval_strategy"],
        eval_steps=o["eval_steps"],
        logging_steps=o["logging_steps"],
        load_best_model_at_end=o.get("load_best_model_at_end", True),
        metric_for_best_model=o.get("metric_for_best_model", "eval_loss"),
        greater_is_better=False,
        report_to=report_to,
        run_name=wandb_cfg.get("run_name", "trail-nemotron"),
        ddp_find_unused_parameters=False,  # required for gradient_checkpointing with DDP
        dataloader_pin_memory=False,
        remove_unused_columns=False,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, help="Path to config.yaml")
    args = parser.parse_args()

    cfg = load_config(args.config)
    local_rank = int(os.getenv("LOCAL_RANK", 0))
    is_main = (local_rank == 0)

    if is_main:
        log.info("Model: %s", cfg["model"]["name"])
        log.info("QLoRA rank: %d, alpha: %d", cfg["lora"]["rank"], cfg["lora"]["alpha"])

    # ── Tokenizer ─────────────────────────────────────────────────────────────
    tokenizer = AutoTokenizer.from_pretrained(
        cfg["model"]["name"],
        trust_remote_code=True,
        padding_side="right",
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # ── Load datasets ─────────────────────────────────────────────────────────
    t_cfg = cfg["training"]
    data_cfg = cfg["data"]
    max_seq = t_cfg["max_seq_len"]

    train_ds = load_jsonl_dataset(data_cfg["train_file"])
    val_ds   = load_jsonl_dataset(data_cfg["val_file"])

    if is_main:
        log.info("Train: %d samples, Val: %d samples", len(train_ds), len(val_ds))

    # Apply chat template
    train_ds = train_ds.map(lambda ex: format_chat(ex, tokenizer), remove_columns=["messages"])
    val_ds   = val_ds.map(  lambda ex: format_chat(ex, tokenizer), remove_columns=["messages"])

    # ── Model ─────────────────────────────────────────────────────────────────
    bnb_cfg = build_bnb_config(cfg)
    model = AutoModelForCausalLM.from_pretrained(
        cfg["model"]["name"],
        quantization_config=bnb_cfg,
        device_map={"": local_rank},   # one GPU per process
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
        attn_implementation="flash_attention_2",  # requires flash-attn; remove if unavailable
    )
    model = prepare_model_for_kbit_training(
        model,
        use_gradient_checkpointing=t_cfg.get("gradient_checkpointing", True),
    )
    model = get_peft_model(model, build_lora_config(cfg))
    if is_main:
        model.print_trainable_parameters()

    # ── Trainer ───────────────────────────────────────────────────────────────
    training_args = build_training_args(cfg, local_rank)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        dataset_text_field="text",
        max_seq_length=max_seq,
        packing=True,          # pack multiple short sequences into one input → better GPU util
        args=training_args,
    )

    if is_main:
        log.info("Starting fine-tuning...")
    trainer.train()

    # ── Save adapter ──────────────────────────────────────────────────────────
    if is_main:
        adapter_dir = Path(cfg["output"]["dir"]) / "final_adapter"
        trainer.model.save_pretrained(str(adapter_dir))
        tokenizer.save_pretrained(str(adapter_dir))
        log.info("LoRA adapter saved to %s", adapter_dir)
        log.info(
            "To merge adapter into full model for faster inference:\n"
            "  from peft import PeftModel\n"
            "  base = AutoModelForCausalLM.from_pretrained('%s', torch_dtype=torch.bfloat16)\n"
            "  merged = PeftModel.from_pretrained(base, '%s').merge_and_unload()\n"
            "  merged.save_pretrained('./merged_model')",
            cfg["model"]["name"], adapter_dir,
        )


if __name__ == "__main__":
    main()
