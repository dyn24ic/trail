"""
Brev inference server for trAIl search zone prediction (Stage 2).

Accepts a POST /predict_zones request containing a trigger event + environmental context,
runs Nemotron 70B (+ fine-tuned LoRA adapter) to predict the most likely search zones,
and returns a JSON list of SearchZone objects.

Environment variables:
    CHECKPOINT_DIR   — path to LoRA adapter directory (default: ./checkpoints/final_adapter)
    BASE_MODEL       — HuggingFace model ID (default: nvidia/Llama-3.1-Nemotron-70B-Instruct-HF)
    BREV_API_KEY     — bearer token for auth (if empty, auth is disabled)
    HF_TOKEN         — HuggingFace access token for model download

Usage:
    uvicorn server:app --host 0.0.0.0 --port 8081

    # Or launch directly:
    python server.py
"""
import json
import logging
import math
import os
import random
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "./checkpoints/final_adapter")
BASE_MODEL     = os.getenv("BASE_MODEL", "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF")
BREV_API_KEY   = os.getenv("BREV_API_KEY", "")
TEMPERATURE    = 0.15
MAX_NEW_TOKENS = 1024

SYSTEM_PROMPT = (
    "You are trAIl's emergency search zone predictor. "
    "Given an emergency trigger event and current environmental conditions, "
    "identify the most likely geographic zones where a person in distress would be found. "
    "Return a single JSON object: "
    "{\"search_zones\": [{\"lat\": float, \"lng\": float, \"radiusMeters\": float, "
    "\"confidence\": float, \"reasoning\": string}]}. "
    "Zones must be ordered by confidence descending. "
    "If environmental data indicates no realistic emergency risk, return {\"search_zones\": []}."
)

# ---------------------------------------------------------------------------
# Module-level model state
# ---------------------------------------------------------------------------

_model     = None
_tokenizer = None
_model_loaded = False


def _load_model():
    global _model, _tokenizer, _model_loaded
    if _model_loaded:
        return

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    log.info("Loading tokenizer from %s …", CHECKPOINT_DIR)
    try:
        _tokenizer = AutoTokenizer.from_pretrained(
            CHECKPOINT_DIR,
            trust_remote_code=True,
            padding_side="left",
            token=os.getenv("HF_TOKEN"),
        )
    except Exception:
        log.info("Checkpoint tokenizer not found; using base model tokenizer")
        _tokenizer = AutoTokenizer.from_pretrained(
            BASE_MODEL,
            trust_remote_code=True,
            padding_side="left",
            token=os.getenv("HF_TOKEN"),
        )
    if _tokenizer.pad_token is None:
        _tokenizer.pad_token = _tokenizer.eos_token

    log.info("Loading base model %s …", BASE_MODEL)
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
        token=os.getenv("HF_TOKEN"),
    )

    if os.path.isdir(CHECKPOINT_DIR) and os.path.isfile(
        os.path.join(CHECKPOINT_DIR, "adapter_config.json")
    ):
        log.info("Merging LoRA adapter from %s …", CHECKPOINT_DIR)
        _model = PeftModel.from_pretrained(base, CHECKPOINT_DIR).merge_and_unload()
    else:
        log.warning("No LoRA adapter found at %s — running base model", CHECKPOINT_DIR)
        _model = base

    _model.eval()
    _model_loaded = True
    log.info("Model ready.")


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def _run_inference(payload: dict) -> list[dict]:
    """Run model inference and return list of search zone dicts."""
    user_content = json.dumps(payload, separators=(",", ":"))
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_content},
    ]

    text = _tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True,
    )

    import torch
    inputs = _tokenizer(text, return_tensors="pt").to(_model.device)

    with torch.inference_mode():
        out_ids = _model.generate(
            **inputs,
            max_new_tokens=MAX_NEW_TOKENS,
            temperature=TEMPERATURE,
            do_sample=True,
            pad_token_id=_tokenizer.pad_token_id,
        )

    new_ids = out_ids[0][inputs["input_ids"].shape[-1]:]
    raw = _tokenizer.decode(new_ids, skip_special_tokens=True).strip()

    start, end = raw.find("{"), raw.rfind("}") + 1
    if start == -1 or end == 0:
        log.warning("No JSON object in model output; returning fallback zones")
        return _fallback_zones(payload.get("lat", 0.0), payload.get("lng", 0.0))

    try:
        result = json.loads(raw[start:end])
        zones  = result.get("search_zones", [])
        return [_validate_zone(z) for z in zones if _validate_zone(z) is not None]
    except json.JSONDecodeError:
        log.warning("JSON decode error; returning fallback zones")
        return _fallback_zones(payload.get("lat", 0.0), payload.get("lng", 0.0))


def _validate_zone(z: Any) -> Optional[dict]:
    """Validate and normalise a single zone dict. Returns None if invalid."""
    if not isinstance(z, dict):
        return None
    try:
        lat  = float(z["lat"])
        lng  = float(z["lng"])
        rad  = float(z.get("radiusMeters", 300))
        conf = float(z.get("confidence", 0.5))
    except (KeyError, TypeError, ValueError):
        return None

    if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        return None

    return {
        "lat":          round(lat, 6),
        "lng":          round(lng, 6),
        "radiusMeters": max(50.0, min(2000.0, rad)),
        "confidence":   round(max(0.0, min(1.0, conf)), 3),
        "reasoning":    str(z.get("reasoning", "")),
    }


def _offset_coords(lat: float, lng: float, dist_m: float, bearing_deg: float):
    R = 6_371_000.0
    b = math.radians(bearing_deg)
    lr = math.radians(lat)
    new_lat = math.asin(
        math.sin(lr) * math.cos(dist_m / R)
        + math.cos(lr) * math.sin(dist_m / R) * math.cos(b)
    )
    new_lng = math.radians(lng) + math.atan2(
        math.sin(b) * math.sin(dist_m / R) * math.cos(lr),
        math.cos(dist_m / R) - math.sin(lr) * math.sin(new_lat),
    )
    return round(math.degrees(new_lat), 6), round(math.degrees(new_lng), 6)


def _fallback_zones(lat: float, lng: float) -> list[dict]:
    """Return 3 random-offset zones (same behaviour as original Scala mock)."""
    rng    = random.Random()
    zones  = []
    radii  = [200.0, 350.0, 500.0]
    confs  = [round(0.50 + rng.random() * 0.45, 2) for _ in range(3)]
    confs.sort(reverse=True)
    for i, (r, c) in enumerate(zip(radii, confs)):
        dist  = rng.uniform(100, 800) if i > 0 else 0
        bear  = rng.uniform(0, 360)
        if dist > 0:
            zlat, zlng = _offset_coords(lat, lng, dist, bear)
        else:
            zlat, zlng = round(lat, 6), round(lng, 6)
        zones.append({
            "lat":          zlat,
            "lng":          zlng,
            "radiusMeters": r,
            "confidence":   c,
            "reasoning":    "Fallback zone (model inference unavailable).",
        })
    return zones


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_model()
    yield


app = FastAPI(title="trAIl Search Zone Predictor", lifespan=lifespan)


def _check_auth(request: Request):
    if not BREV_API_KEY:
        return
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or auth[7:] != BREV_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class ZonePredictRequest(BaseModel):
    trigger_type:    str
    lat:             float
    lng:             float
    trigger_payload: dict = {}
    month:           int  = 7
    hour_local:      int  = 14
    weather:         dict = {}
    fire:            dict = {}
    hydro:           dict = {}
    incident_type_context: str = "unknown"


class SearchZoneOut(BaseModel):
    lat:          float
    lng:          float
    radiusMeters: float
    confidence:   float
    reasoning:    str = ""


class ZonePredictResponse(BaseModel):
    search_zones:  list[SearchZoneOut]
    model_version: str = "nemotron-70b-search-zones-v1"
    latency_ms:    float = 0.0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status":        "ok",
        "model":         "nemotron-70b-search-zones",
        "model_loaded":  _model_loaded,
    }


@app.post("/predict_zones", response_model=ZonePredictResponse)
async def predict_zones(body: ZonePredictRequest, request: Request):
    _check_auth(request)

    payload = body.model_dump()
    t0 = time.time()

    zones_raw = _run_inference(payload)

    latency_ms = round((time.time() - t0) * 1000, 1)
    log.info(
        "predict_zones  trigger=%s  lat=%.4f  lng=%.4f  zones=%d  latency=%.0f ms",
        body.trigger_type, body.lat, body.lng, len(zones_raw), latency_ms,
    )

    zones_out = [SearchZoneOut(**z) for z in zones_raw]
    return ZonePredictResponse(
        search_zones=zones_out,
        latency_ms=latency_ms,
    )


# ---------------------------------------------------------------------------
# Entry point (for direct python server.py launch)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8081, log_level="info")
