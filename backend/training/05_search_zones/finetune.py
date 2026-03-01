"""
QLoRA fine-tuning of nvidia/Llama-3.1-Nemotron-70B-Instruct-HF for search zone prediction.

The model learns to reason over emergency trigger events and environmental conditions
to output 3 prioritised geographic search zones (lat, lng, radius, confidence, reasoning).

Hardware requirement: 2x A100 80GB (Brev instance recommended).
Launch:
    torchrun --nproc_per_node=2 05_search_zones/finetune.py

Environment variables (optional overrides):
    BASE_MODEL      — HuggingFace model ID (default: nvidia/Llama-3.1-Nemotron-70B-Instruct-HF)
    TRAIN_JSONL     — path to training JSONL (default: 05_search_zones/output/train.jsonl)
    VAL_JSONL       — path to validation JSONL (default: 05_search_zones/output/val.jsonl)
    OUTPUT_DIR      — checkpoint output directory (default: 05_search_zones/checkpoints)
    HF_TOKEN        — HuggingFace access token (required for gated model download)
"""
import os
import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_MODEL  = os.getenv("BASE_MODEL", "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF")
TRAIN_JSONL = os.getenv("TRAIN_JSONL", str(Path(__file__).parent / "output" / "train.jsonl"))
VAL_JSONL   = os.getenv("VAL_JSONL",   str(Path(__file__).parent / "output" / "val.jsonl"))
OUTPUT_DIR  = os.getenv("OUTPUT_DIR",  str(Path(__file__).parent / "checkpoints"))

# QLoRA hyperparameters
LORA_RANK          = 16
LORA_ALPHA         = 32
LORA_DROPOUT       = 0.05
TARGET_MODULES     = ["q_proj", "v_proj", "k_proj", "o_proj"]

# Training hyperparameters
MAX_SEQ_LEN   = 2048    # zone prediction prompts are compact
BATCH_SIZE    = 1
GRAD_ACCUM    = 8       # effective batch = 8
LR            = 2e-4
EPOCHS        = 3
WARMUP_RATIO  = 0.05
SAVE_STEPS    = 50


# ---------------------------------------------------------------------------
# Dataset loader
# ---------------------------------------------------------------------------

def load_jsonl(path: str) -> list[dict]:
    samples = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                samples.append(json.loads(line))
    return samples


def format_sample(sample: dict, tokenizer) -> str:
    """Apply Nemotron chat template to a single sample."""
    messages = sample["messages"]
    return tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=False,
    )


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train():
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        TrainingArguments,
    )
    from trl import SFTTrainer

    log.info("BASE_MODEL  : %s", BASE_MODEL)
    log.info("TRAIN_JSONL : %s", TRAIN_JSONL)
    log.info("OUTPUT_DIR  : %s", OUTPUT_DIR)

    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

    # ── Load tokeniser ────────────────────────────────────────────────────
    log.info("Loading tokenizer …")
    tokenizer = AutoTokenizer.from_pretrained(
        BASE_MODEL,
        trust_remote_code=True,
        padding_side="right",
        token=os.getenv("HF_TOKEN"),
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # ── 4-bit quantisation config ─────────────────────────────────────────
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    # ── Load base model ───────────────────────────────────────────────────
    # Pin this rank to its own single GPU — do NOT use device_map="auto" with
    # torchrun DDP. "auto" spreads the model across ALL visible GPUs, so every
    # rank fights over every GPU and causes OOM. {"": local_rank} gives each
    # rank one exclusive GPU.
    local_rank = int(os.environ.get("LOCAL_RANK", 0))
    log.info("Loading base model (4-bit) on GPU %d …", local_rank)
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb_config,
        device_map={"": local_rank},
        torch_dtype=torch.bfloat16,   # explicit dtype — prevents float32 intermediates
        low_cpu_mem_usage=True,        # load + quantize one tensor at a time (old serial path)
        trust_remote_code=True,
        token=os.getenv("HF_TOKEN"),
    )
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model.config.use_cache = False

    # ── LoRA adapter ──────────────────────────────────────────────────────
    lora_cfg = LoraConfig(
        r=LORA_RANK,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    # ── Datasets ──────────────────────────────────────────────────────────
    train_raw = load_jsonl(TRAIN_JSONL)
    val_raw   = load_jsonl(VAL_JSONL)

    log.info("Training samples: %d  |  Validation samples: %d", len(train_raw), len(val_raw))

    train_texts = [format_sample(s, tokenizer) for s in train_raw]
    val_texts   = [format_sample(s, tokenizer) for s in val_raw]

    train_dataset = Dataset.from_dict({"text": train_texts})
    val_dataset   = Dataset.from_dict({"text": val_texts})

    # ── Training arguments ────────────────────────────────────────────────
    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        learning_rate=LR,
        warmup_ratio=WARMUP_RATIO,
        lr_scheduler_type="cosine",
        fp16=False,
        bf16=True,
        logging_steps=10,
        save_steps=SAVE_STEPS,
        evaluation_strategy="steps",
        eval_steps=SAVE_STEPS,
        save_total_limit=3,
        load_best_model_at_end=True,
        gradient_checkpointing=True,
        ddp_find_unused_parameters=False,
        report_to="none",
        dataloader_num_workers=0,
    )

    # ── Trainer ───────────────────────────────────────────────────────────
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LEN,
        packing=False,
    )

    log.info("Starting fine-tuning …")
    trainer.train()

    # ── Save final adapter ────────────────────────────────────────────────
    final_dir = Path(OUTPUT_DIR) / "final_adapter"
    trainer.model.save_pretrained(str(final_dir))
    tokenizer.save_pretrained(str(final_dir))
    log.info("Fine-tuning complete. Adapter saved → %s", final_dir)
    log.info("Next: uvicorn server:app --host 0.0.0.0 --port 8081")


if __name__ == "__main__":
    train()
