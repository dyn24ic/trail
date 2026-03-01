"""
trAIl Nemotron Inference Server

Wraps the fine-tuned Llama-3.1-Nemotron-70B LoRA adapter as a FastAPI service.
Accepts the same payload shape as the Django hotspot_service and returns
HotspotPredictionResponse JSON (with added incidentType per hotspot).

Deploy on Brev:
    # Install deps
    pip install -r requirements.txt
    pip install flash-attn --no-build-isolation   # optional but recommended on A100
    # Set env vars
    export ADAPTER_PATH=./checkpoints/final_adapter
    export BASE_MODEL=nvidia/Llama-3.1-Nemotron-70B-Instruct-HF
    export BREV_API_KEY=<secret>          # optional bearer-token auth
    # Launch (binds to 0.0.0.0:8080 — use Brev's "expose port" UI to make public)
    uvicorn server:app --host 0.0.0.0 --port 8080 --workers 1

Notes:
- Use --workers 1: the model is loaded once at startup and is not fork-safe.
- Memory: merged 70B model in bfloat16 requires ~140 GB VRAM → 2x A100 80GB.
  Use device_map="auto" so both GPUs are utilised automatically.
- If you merged the adapter (see finetune.py note), set ADAPTER_PATH="" and
  BASE_MODEL to the merged checkpoint directory for faster first-token latency.
"""
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional

import torch
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from peft import PeftModel
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ── Config from env ───────────────────────────────────────────────────────────
BASE_MODEL   = os.getenv("BASE_MODEL",   "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF")
ADAPTER_PATH = os.getenv("ADAPTER_PATH", "./checkpoints/final_adapter")
BREV_API_KEY = os.getenv("BREV_API_KEY", "")    # empty = no auth
MAX_NEW_TOKENS = int(os.getenv("MAX_NEW_TOKENS", "2048"))
TEMPERATURE    = float(os.getenv("TEMPERATURE", "0.15"))
MODEL_VERSION  = "trAIl-weather-v1.1+nemotron-70b"

# ── Global model state ────────────────────────────────────────────────────────
_model: Any = None
_tokenizer: Any = None

SYSTEM_PROMPT = (
    "You are trAIl (Trail Guardian), a search-and-rescue hotspot prediction AI for national parks. "
    "Given current environmental conditions and pre-scored terrain candidates for a geographic "
    "bounding box, identify the most likely accident hotspot locations for the next 24 hours. "
    "For each hotspot, predict the probable incident type based on terrain and conditions. "
    "Return a single JSON object: { \"hotspots\": [...] }. "
    "If conditions are safe and no hotspots are warranted, return { \"hotspots\": [] }."
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model, _tokenizer
    log.info("Loading tokenizer from %s ...", BASE_MODEL)
    _tokenizer = AutoTokenizer.from_pretrained(
        BASE_MODEL, trust_remote_code=True, padding_side="left",
    )
    if _tokenizer.pad_token is None:
        _tokenizer.pad_token = _tokenizer.eos_token

    log.info("Loading base model (bfloat16, device_map=auto) ...")
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
    )

    if ADAPTER_PATH and os.path.isdir(ADAPTER_PATH):
        log.info("Loading LoRA adapter from %s ...", ADAPTER_PATH)
        _model = PeftModel.from_pretrained(base, ADAPTER_PATH)
        _model = _model.merge_and_unload()   # merge for faster inference
        log.info("Adapter merged into base model.")
    else:
        log.warning("ADAPTER_PATH not found or empty — using base model without fine-tuning")
        _model = base

    _model.eval()
    log.info("Model ready.")
    yield
    # Cleanup (optional)
    del _model, _tokenizer


app = FastAPI(title="trAIl Nemotron Inference", lifespan=lifespan)
security = HTTPBearer(auto_error=False)


def _check_auth(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not BREV_API_KEY:
        return  # auth disabled
    if credentials is None or credentials.credentials != BREV_API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


# ── Request / Response schemas ────────────────────────────────────────────────

class BBoxModel(BaseModel):
    south: float; north: float; west: float; east: float


class PredictRequest(BaseModel):
    bbox:       BBoxModel
    conditions: dict = Field(default_factory=dict)
    candidates: list[dict] = Field(default_factory=list)
    month:      int = 7
    hour_local: int = 14


# ── Inference ─────────────────────────────────────────────────────────────────

def _run_inference(payload: dict) -> list[dict]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": json.dumps(payload, separators=(",", ":"))},
    ]
    text = _tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True,
    )
    inputs = _tokenizer(text, return_tensors="pt").to(_model.device)

    t0 = time.time()
    with torch.inference_mode():
        output_ids = _model.generate(
            **inputs,
            max_new_tokens=MAX_NEW_TOKENS,
            temperature=TEMPERATURE,
            do_sample=TEMPERATURE > 0,
            pad_token_id=_tokenizer.pad_token_id,
        )
    elapsed = time.time() - t0

    # Decode only the newly generated tokens
    new_ids = output_ids[0][inputs["input_ids"].shape[-1]:]
    raw = _tokenizer.decode(new_ids, skip_special_tokens=True).strip()
    log.info("Generated %d tokens in %.1f s", len(new_ids), elapsed)

    # Parse JSON from response
    # The model is trained to output {"hotspots": [...]} — find and parse that
    start = raw.find("{")
    end   = raw.rfind("}") + 1
    if start == -1 or end == 0:
        log.warning("No JSON found in model output — returning empty hotspots")
        return []

    parsed = json.loads(raw[start:end])
    hotspots = parsed.get("hotspots", [])
    return [_validate_hotspot(h, i) for i, h in enumerate(hotspots[:10])]


def _validate_hotspot(h: dict, idx: int) -> dict:
    def clamp(v, lo=0.0, hi=1.0):
        try:
            return round(float(max(lo, min(hi, v))), 3)
        except (TypeError, ValueError):
            return round((lo + hi) / 2, 3)

    factors = h.get("factors", {})
    risk_score = clamp(h.get("riskScore", 0.5))
    risk_level = h.get("riskLevel", "moderate")
    if risk_level not in ("low", "moderate", "high", "extreme"):
        risk_level = _score_to_level(risk_score)
    incident_type = h.get("incidentType", "unknown")
    valid_types = {"fall","drowning","medical","vehicle","rockfall","lightning","search_rescue","fire_related","unknown"}
    if incident_type not in valid_types:
        incident_type = "unknown"

    return {
        "id":           h.get("id", f"HOTSPOT-{idx+1:03d}"),
        "lat":          float(h.get("lat", 37.76)),
        "lon":          float(h.get("lon", -119.54)),
        "radiusMeters": max(50, min(2000, int(h.get("radiusMeters", 400)))),
        "riskScore":    risk_score,
        "riskLevel":    risk_level,
        "incidentType": incident_type,
        "factors": {
            "fire":          clamp(factors.get("fire", 0.5)),
            "weather":       clamp(factors.get("weather", 0.5)),
            "terrain":       clamp(factors.get("terrain", 0.5)),
            "water":         clamp(factors.get("water", 0.2)),
            "accessibility": clamp(factors.get("accessibility", 0.3)),
        },
        "description":     str(h.get("description", "Risk zone identified.")),
        "recommendations": [str(r) for r in h.get("recommendations", [])[:5]],
    }


def _score_to_level(score: float) -> str:
    if score >= 0.75: return "extreme"
    if score >= 0.55: return "high"
    if score >= 0.35: return "moderate"
    return "low"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "modelVersion": MODEL_VERSION}


@app.post("/predict")
def predict(req: PredictRequest, _=Depends(_check_auth)):
    payload = {
        "bbox":       req.bbox.model_dump(),
        "month":      req.month,
        "hour_local": req.hour_local,
        "conditions": req.conditions,
        "candidates": req.candidates,
    }

    try:
        hotspots = _run_inference(payload)
    except Exception as exc:
        log.exception("Inference failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Inference error: {exc}")

    conditions = req.conditions.get("fire", {})
    weather    = req.conditions.get("weather", {})
    smoke_aqi  = req.conditions.get("smoke_aqi")

    return {
        "hotspots": hotspots,
        "bbox": req.bbox.model_dump(),
        "generatedAt": datetime.now(tz=timezone.utc).isoformat(),
        "modelVersion": MODEL_VERSION,
        "conditions": {
            "fireDangerRating": conditions.get("danger_rating", "UNKNOWN"),
            "weatherSummary": (
                f"{weather.get('temperature_c', '?')}°C, "
                f"wind {weather.get('windspeed_kmh', '?')} km/h, "
                f"{weather.get('description', '')}"
            ) if weather else "unavailable",
            "activeFires": len(req.conditions.get("wildfires_active", [])),
            "smokeAqi": smoke_aqi,
        },
    }
