"""
Brev inference server for trAIl responder route optimization (Stage 2b).

Accepts POST /predict_route with trailhead/victim coordinates, triage, and weather.
Runs Nemotron 70B (+ fine-tuned LoRA) to produce a step-by-step responder route.

Environment variables:
    CHECKPOINT_DIR   — path to LoRA adapter (default: ./checkpoints/final_adapter)
    BASE_MODEL       — HuggingFace model ID
    BREV_API_KEY     — bearer token for auth
    HF_TOKEN         — HuggingFace access token

Usage:
    uvicorn server:app --host 0.0.0.0 --port 8082
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

CHECKPOINT_DIR = os.getenv("CHECKPOINT_DIR", "./checkpoints/final_adapter")
BASE_MODEL     = os.getenv("BASE_MODEL", "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF")
BREV_API_KEY   = os.getenv("BREV_API_KEY", "")
TEMPERATURE    = 0.15
MAX_NEW_TOKENS = 2048

SYSTEM_PROMPT = (
    "You are trAIl's responder route optimizer. "
    "Given a trailhead origin, victim location, injury triage, and environmental conditions, "
    "calculate the fastest and safest route for search-and-rescue responders. "
    "Return a single JSON object: "
    "{\"steps\": [{\"stepNumber\": int, \"description\": string, "
    "\"distanceMeters\": float, \"estimatedMinutes\": int, \"hazards\": [string]}], "
    "\"totalDistanceMeters\": float, \"totalEtaMinutes\": int, "
    "\"accessType\": string, \"notes\": string}. "
    "accessType must be one of: \"helicopter\", \"ground\", \"boat\". "
    "Steps must be ordered from trailhead to victim."
)

_model        = None
_tokenizer    = None
_model_loaded = False

VALID_ACCESS_TYPES = {"helicopter", "ground", "boat"}


def _load_model():
    global _model, _tokenizer, _model_loaded
    if _model_loaded:
        return

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    log.info("Loading tokenizer …")
    try:
        _tokenizer = AutoTokenizer.from_pretrained(
            CHECKPOINT_DIR, trust_remote_code=True, padding_side="left",
            token=os.getenv("HF_TOKEN"),
        )
    except Exception:
        _tokenizer = AutoTokenizer.from_pretrained(
            BASE_MODEL, trust_remote_code=True, padding_side="left",
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
        log.warning("No LoRA adapter at %s — using base model", CHECKPOINT_DIR)
        _model = base

    _model.eval()
    _model_loaded = True
    log.info("Model ready.")


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def _run_inference(payload: dict) -> dict:
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
    raw     = _tokenizer.decode(new_ids, skip_special_tokens=True).strip()

    start, end = raw.find("{"), raw.rfind("}") + 1
    if start == -1 or end == 0:
        log.warning("No JSON in model output; returning fallback route")
        return _fallback_route(payload)

    try:
        result = json.loads(raw[start:end])
        return _validate_route(result, payload)
    except json.JSONDecodeError:
        log.warning("JSON decode error; returning fallback route")
        return _fallback_route(payload)


def _validate_step(s: Any) -> Optional[dict]:
    if not isinstance(s, dict):
        return None
    try:
        return {
            "stepNumber":       int(s.get("stepNumber", 1)),
            "description":      str(s.get("description", "")),
            "distanceMeters":   max(0.0, float(s.get("distanceMeters", 0))),
            "estimatedMinutes": max(1,   int(s.get("estimatedMinutes", 1))),
            "hazards":          [str(h) for h in s.get("hazards", []) if isinstance(h, str)],
        }
    except (TypeError, ValueError):
        return None


def _validate_route(r: dict, payload: dict) -> dict:
    steps_raw = r.get("steps", [])
    steps     = [v for s in steps_raw if (v := _validate_step(s)) is not None]

    access = r.get("accessType", "ground")
    if access not in VALID_ACCESS_TYPES:
        access = "ground"

    total_dist = float(r.get("totalDistanceMeters", payload.get("distance_km", 1) * 1000))
    total_eta  = int(r.get("totalEtaMinutes", max(5, int(total_dist / 4200 * 60))))

    return {
        "steps":                steps if steps else _fallback_route(payload)["steps"],
        "totalDistanceMeters":  max(0.0, total_dist),
        "totalEtaMinutes":      max(1, total_eta),
        "accessType":           access,
        "notes":                str(r.get("notes", "")),
    }


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _fallback_route(payload: dict) -> dict:
    """Haversine + fixed 4-step route (mirrors original Scala mock)."""
    rng = random.Random()
    th_lat = payload.get("trailhead_lat", 37.7459)
    th_lng = payload.get("trailhead_lng", -119.5332)
    v_lat  = payload.get("victim_lat", th_lat)
    v_lng  = payload.get("victim_lng", th_lng)
    dist_km = _haversine_km(th_lat, th_lng, v_lat, v_lng)
    dist_m  = dist_km * 1000

    severity    = (payload.get("triage") or {}).get("severity", "Moderate")
    access_type = "helicopter" if severity == "Severe" else "ground"
    speed_kmh   = 150.0 if access_type == "helicopter" else 4.2
    eta_min     = max(5, int(dist_km / speed_kmh * 60) + rng.randint(2, 10))

    steps = [
        {"stepNumber": 1, "description": "Depart trailhead / staging area",      "distanceMeters": round(dist_m * 0.15, 1), "estimatedMinutes": max(1, int(eta_min * 0.10)), "hazards": []},
        {"stepNumber": 2, "description": "Navigate to ridge access point",        "distanceMeters": round(dist_m * 0.35, 1), "estimatedMinutes": max(1, int(eta_min * 0.30)), "hazards": ["Loose rock"]},
        {"stepNumber": 3, "description": "Approach victim GPS coordinates",       "distanceMeters": round(dist_m * 0.40, 1), "estimatedMinutes": max(1, int(eta_min * 0.45)), "hazards": ["Steep slope"]},
        {"stepNumber": 4, "description": "Stabilise and prepare for evacuation",  "distanceMeters": round(dist_m * 0.10, 1), "estimatedMinutes": max(1, int(eta_min * 0.15)), "hazards": []},
    ]

    return {
        "steps":                steps,
        "totalDistanceMeters":  round(dist_m, 1),
        "totalEtaMinutes":      eta_min,
        "accessType":           access_type,
        "notes":                f"Fallback route. Distance: {dist_km:.1f} km. ETA: {eta_min} min.",
    }


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_model()
    yield


app = FastAPI(title="trAIl Responder Route Optimizer", lifespan=lifespan)


def _check_auth(request: Request):
    if not BREV_API_KEY:
        return
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or auth[7:] != BREV_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class TriageIn(BaseModel):
    severity:                      str   = "Moderate"
    injuryType:                    str   = "Unknown injury"
    consciousAndResponsive:        bool  = True
    recommendedResponse:           str   = ""
    estimatedMedicalUrgencyMinutes: int  = 45


class RouteRequest(BaseModel):
    trailhead_name: str   = "Trailhead"
    trailhead_lat:  float
    trailhead_lng:  float
    victim_lat:     float
    victim_lng:     float
    distance_km:    float = 0.0
    month:          int   = 7
    hour_local:     int   = 14
    triage:         TriageIn = TriageIn()
    weather:        dict  = {}
    terrain:        dict  = {}


class RouteStepOut(BaseModel):
    stepNumber:       int
    description:      str
    distanceMeters:   float
    estimatedMinutes: int
    hazards:          list[str] = []


class RouteResponse(BaseModel):
    steps:               list[RouteStepOut]
    totalDistanceMeters: float
    totalEtaMinutes:     int
    accessType:          str
    notes:               str
    model_version:       str   = "nemotron-70b-route-optimizer-v1"
    latency_ms:          float = 0.0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status":       "ok",
        "model":        "nemotron-70b-route-optimizer",
        "model_loaded": _model_loaded,
    }


@app.post("/predict_route", response_model=RouteResponse)
async def predict_route(body: RouteRequest, request: Request):
    _check_auth(request)

    payload = body.model_dump()
    t0 = time.time()

    result     = _run_inference(payload)
    latency_ms = round((time.time() - t0) * 1000, 1)

    log.info(
        "predict_route  access=%s  dist=%.1f m  eta=%d min  steps=%d  latency=%.0f ms",
        result["accessType"], result["totalDistanceMeters"],
        result["totalEtaMinutes"], len(result["steps"]), latency_ms,
    )

    return RouteResponse(
        steps               = [RouteStepOut(**s) for s in result["steps"]],
        totalDistanceMeters = result["totalDistanceMeters"],
        totalEtaMinutes     = result["totalEtaMinutes"],
        accessType          = result["accessType"],
        notes               = result["notes"],
        latency_ms          = latency_ms,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8082, log_level="info")
