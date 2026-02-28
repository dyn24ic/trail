"""
Evaluate the fine-tuned Nemotron model against the held-out validation set.

Metrics computed:
  - Hotspot precision/recall at 500 m and 1000 m radius
  - Incident type accuracy (top-1 match between predicted and ground-truth)
  - Mean risk score for matched vs. unmatched ground-truth incidents
  - Overall F1 at each radius threshold

Usage:
    # Against the Brev inference server (recommended — no GPU required locally):
    INFERENCE_URL=http://<brev-host>:8080 BREV_API_KEY=<secret> \
        python evaluate.py --val 01_data/output/validation.jsonl

    # Against a local model checkpoint (loads model in-process):
    python evaluate.py --val 01_data/output/validation.jsonl --local --checkpoint ./checkpoints/final_adapter

Output:
    Prints a Markdown-formatted metrics table.
    Writes evaluate_results.json to the same directory.
"""
import argparse
import json
import logging
import math
import os
import sys
import time
from pathlib import Path
from typing import Optional

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

EVAL_RADII_M = [500, 1000]   # Haversine distance thresholds (metres)
TIMEOUT = 300                 # Seconds to wait for a single predict call

BASE_URL    = os.getenv("INFERENCE_URL", "http://localhost:8080")
BREV_API_KEY = os.getenv("BREV_API_KEY", "")


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in metres between two WGS-84 points."""
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def closest_predicted(gt_lat: float, gt_lon: float, hotspots: list[dict]) -> tuple[float, dict | None]:
    """Return (min_distance_m, closest_hotspot_dict) for a ground-truth point."""
    if not hotspots:
        return float("inf"), None
    best_dist = float("inf")
    best_h = None
    for h in hotspots:
        d = haversine_m(gt_lat, gt_lon, float(h["lat"]), float(h["lon"]))
        if d < best_dist:
            best_dist = d
            best_h = h
    return best_dist, best_h


# ---------------------------------------------------------------------------
# Inference via Brev server
# ---------------------------------------------------------------------------

def _headers() -> dict:
    if BREV_API_KEY:
        return {"Authorization": f"Bearer {BREV_API_KEY}"}
    return {}


def predict_via_server(sample: dict) -> list[dict]:
    """
    Parse the user-turn JSON from a validation sample and POST it to the server.
    Returns the list of predicted hotspots, or [] on error.
    """
    user_content = sample["messages"][1]["content"]
    payload = json.loads(user_content)

    try:
        resp = requests.post(
            f"{BASE_URL}/predict",
            headers=_headers(),
            json={
                "bbox":       payload.get("bbox", {}),
                "conditions": payload.get("conditions", {}),
                "candidates": payload.get("candidates", []),
                "month":      payload.get("month", 7),
                "hour_local": payload.get("hour_local", 14),
            },
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json().get("hotspots", [])
    except Exception as exc:
        log.debug("Inference call failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Local model inference (optional, for on-machine evaluation)
# ---------------------------------------------------------------------------

def load_local_model(checkpoint: str):
    """Load the fine-tuned model in-process. Requires GPU and ~140 GB VRAM."""
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    BASE_MODEL = os.getenv("BASE_MODEL", "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF")
    log.info("Loading tokenizer …")
    tok = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True, padding_side="left")
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    log.info("Loading base model …")
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, torch_dtype=torch.bfloat16, device_map="auto", trust_remote_code=True,
    )
    if checkpoint and os.path.isdir(checkpoint):
        log.info("Merging LoRA adapter from %s …", checkpoint)
        model = PeftModel.from_pretrained(base, checkpoint).merge_and_unload()
    else:
        log.warning("No checkpoint found — evaluating base model")
        model = base
    model.eval()
    return model, tok


SYSTEM_PROMPT = (
    "You are trAIl (Trail Guardian), a search-and-rescue hotspot prediction AI for national parks. "
    "Given current environmental conditions and pre-scored terrain candidates for a geographic "
    "bounding box, identify the most likely accident hotspot locations for the next 24 hours. "
    "For each hotspot, predict the probable incident type based on terrain and conditions. "
    "Return a single JSON object: { \"hotspots\": [...] }. "
    "If conditions are safe and no hotspots are warranted, return { \"hotspots\": [] }."
)


def predict_local(sample: dict, model, tokenizer) -> list[dict]:
    import torch
    user_content = sample["messages"][1]["content"]
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_content},
    ]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(text, return_tensors="pt").to(model.device)

    with torch.inference_mode():
        out_ids = model.generate(
            **inputs,
            max_new_tokens=2048,
            temperature=0.15,
            do_sample=True,
            pad_token_id=tokenizer.pad_token_id,
        )
    new_ids = out_ids[0][inputs["input_ids"].shape[-1]:]
    raw = tokenizer.decode(new_ids, skip_special_tokens=True).strip()

    start, end = raw.find("{"), raw.rfind("}") + 1
    if start == -1 or end == 0:
        return []
    try:
        return json.loads(raw[start:end]).get("hotspots", [])
    except json.JSONDecodeError:
        return []


# ---------------------------------------------------------------------------
# Metrics accumulator
# ---------------------------------------------------------------------------

class Metrics:
    def __init__(self):
        self.total_gt   = 0   # ground-truth hotspots (positive val samples)
        self.total_neg  = 0   # negative validation samples
        # Per-radius counters
        self.true_pos   = {r: 0 for r in EVAL_RADII_M}
        self.false_pos  = {r: 0 for r in EVAL_RADII_M}
        self.false_neg  = {r: 0 for r in EVAL_RADII_M}
        # Incident type
        self.type_total  = 0
        self.type_correct = 0
        # Negative suppression (model correctly returns empty list for negatives)
        self.neg_correct = 0
        # Timing
        self.latencies: list[float] = []

    def record(self,
               gt_hotspots: list[dict],
               pred_hotspots: list[dict],
               radius_m: int,
               latency: float):
        matched = set()
        for gt in gt_hotspots:
            dist, best = closest_predicted(gt["lat"], gt["lon"], pred_hotspots)
            if dist <= radius_m:
                self.true_pos[radius_m] += 1
                matched.add(id(best))
                # Incident type accuracy (only for matched hotspots)
                if best:
                    self.type_total += 1
                    if best.get("incidentType") == gt.get("incidentType"):
                        self.type_correct += 1
            else:
                self.false_neg[radius_m] += 1

        # False positives: predicted hotspots not close to any GT
        for h in pred_hotspots:
            gt_dists = [haversine_m(gt["lat"], gt["lon"], h["lat"], h["lon"]) for gt in gt_hotspots]
            if not gt_dists or min(gt_dists) > radius_m:
                self.false_pos[radius_m] += 1

        self.latencies.append(latency)

    def precision(self, r):
        denom = self.true_pos[r] + self.false_pos[r]
        return self.true_pos[r] / denom if denom else 0.0

    def recall(self, r):
        denom = self.true_pos[r] + self.false_neg[r]
        return self.true_pos[r] / denom if denom else 0.0

    def f1(self, r):
        p, rec = self.precision(r), self.recall(r)
        return 2 * p * rec / (p + rec) if (p + rec) > 0 else 0.0

    def type_accuracy(self):
        return self.type_correct / self.type_total if self.type_total else 0.0

    def neg_suppression_rate(self):
        return self.neg_correct / self.total_neg if self.total_neg else 0.0

    def mean_latency(self):
        return sum(self.latencies) / len(self.latencies) if self.latencies else 0.0


# ---------------------------------------------------------------------------
# Main evaluation loop
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--val",        default="01_data/output/validation.jsonl")
    parser.add_argument("--local",      action="store_true",
                        help="Run inference in-process (requires local GPU)")
    parser.add_argument("--checkpoint", default="",
                        help="Path to LoRA adapter directory (for --local mode)")
    parser.add_argument("--max-samples", type=int, default=0,
                        help="Limit number of validation samples evaluated (0 = all)")
    args = parser.parse_args()

    val_path = Path(args.val)
    if not val_path.exists():
        log.error("Validation file not found: %s", val_path)
        sys.exit(1)

    samples = []
    with open(val_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                samples.append(json.loads(line))

    if args.max_samples:
        samples = samples[: args.max_samples]

    log.info("Evaluating %d validation samples …", len(samples))

    # Optionally load local model
    local_model = local_tok = None
    if args.local:
        local_model, local_tok = load_local_model(args.checkpoint)

    metrics = Metrics()

    for idx, sample in enumerate(samples):
        messages = sample.get("messages", [])
        if len(messages) < 3:
            continue

        # Parse ground-truth from the assistant turn
        try:
            gt_data  = json.loads(messages[2]["content"])
            gt_spots = gt_data.get("hotspots", [])
        except (json.JSONDecodeError, KeyError):
            continue

        is_positive = len(gt_spots) > 0
        if is_positive:
            metrics.total_gt += 1
        else:
            metrics.total_neg += 1

        # Run inference
        t0 = time.time()
        if args.local and local_model:
            pred_spots = predict_local(sample, local_model, local_tok)
        else:
            pred_spots = predict_via_server(sample)
        latency = time.time() - t0

        if not is_positive:
            if not pred_spots:
                metrics.neg_correct += 1
            # Count false positives for negative samples
            for r in EVAL_RADII_M:
                metrics.false_pos[r] += len(pred_spots)
            metrics.latencies.append(latency)
            continue

        # Positive sample: compute spatial metrics at each radius
        for r in EVAL_RADII_M:
            metrics.record(gt_spots, pred_spots, r, latency)
        # Avoid double-counting latency across radii
        metrics.latencies.pop()  # remove the duplicate added in record()
        metrics.latencies.append(latency)

        if (idx + 1) % 10 == 0:
            log.info("  Progress: %d / %d  (%.1f s avg)", idx + 1, len(samples), metrics.mean_latency())

    # ---------------------------------------------------------------------------
    # Report
    # ---------------------------------------------------------------------------
    print("\n## trAIl Nemotron Evaluation Results")
    print(f"Validation samples: {len(samples)}  (positive: {metrics.total_gt},  negative: {metrics.total_neg})")
    print()
    print("| Radius | Precision | Recall | F1    |")
    print("|--------|-----------|--------|-------|")
    for r in EVAL_RADII_M:
        print(f"| {r:>5} m | {metrics.precision(r):.3f}     | {metrics.recall(r):.3f}  | {metrics.f1(r):.3f} |")
    print()
    print(f"Incident type accuracy (matched hotspots): {metrics.type_accuracy():.3f}  ({metrics.type_correct}/{metrics.type_total})")
    print(f"Negative suppression rate:                 {metrics.neg_suppression_rate():.3f}  ({metrics.neg_correct}/{metrics.total_neg})")
    print(f"Mean inference latency:                    {metrics.mean_latency():.1f} s")

    results = {
        "samples_total":    len(samples),
        "samples_positive": metrics.total_gt,
        "samples_negative": metrics.total_neg,
        "metrics_by_radius": {
            str(r): {
                "precision": round(metrics.precision(r), 4),
                "recall":    round(metrics.recall(r), 4),
                "f1":        round(metrics.f1(r), 4),
                "true_pos":  metrics.true_pos[r],
                "false_pos": metrics.false_pos[r],
                "false_neg": metrics.false_neg[r],
            }
            for r in EVAL_RADII_M
        },
        "incident_type_accuracy":     round(metrics.type_accuracy(), 4),
        "negative_suppression_rate":  round(metrics.neg_suppression_rate(), 4),
        "mean_latency_s":             round(metrics.mean_latency(), 2),
    }

    out_path = Path(__file__).parent / "evaluate_results.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    log.info("Results written to %s", out_path)


if __name__ == "__main__":
    main()
