"""
Assemble the final training and validation JSONL files from conditions snapshots.

Each output line is a single training example in chat format for SFTTrainer:
  { "messages": [ {role:system}, {role:user}, {role:assistant} ] }

The "assistant" message places a hotspot at the actual incident lat/lon with
the correct incidentType, plus plausible risk scores derived from the snapshot.

Negative samples (~4x each positive): same bbox / conditions but with no incident —
the assistant responds with an empty hotspot list. This teaches the model restraint.

Input:  01_data/output/conditions_snapshots.jsonl
Output: 01_data/output/training.jsonl
        01_data/output/validation.jsonl  (10% held-out by date, not random)

Run (from backend/ root, Django not required):
    python 01_data/build_training_jsonl.py
"""
import json
import logging
import math
import random
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

HERE = Path(__file__).parent
INPUT_FILE  = HERE / "output" / "conditions_snapshots.jsonl"
TRAIN_FILE  = HERE / "output" / "training.jsonl"
VAL_FILE    = HERE / "output" / "validation.jsonl"

SYSTEM_PROMPT = (
    "You are trAIl (Trail Guardian), a search-and-rescue hotspot prediction AI for national parks. "
    "Given current environmental conditions and pre-scored terrain candidates for a geographic "
    "bounding box, identify the most likely accident hotspot locations for the next 24 hours. "
    "For each hotspot, predict the probable incident type based on terrain and conditions. "
    "Return a single JSON object: { \"hotspots\": [...] }. "
    "If conditions are safe and no hotspots are warranted, return { \"hotspots\": [] }."
)

# Candidate grid size matching hotspot_service.py
GRID_SIZE = 8
# Number of negative samples generated per positive
NEG_RATIO = 4
# Validation split: incidents from the last calendar year in dataset
VAL_YEAR_CUTOFF = None  # set dynamically below

INCIDENT_TYPE_WEIGHTS = {
    "fall": 0.38,
    "vehicle": 0.18,
    "drowning": 0.13,
    "medical": 0.10,
    "rockfall": 0.07,
    "search_rescue": 0.07,
    "lightning": 0.04,
    "fire_related": 0.03,
}


def seed_candidates(bbox: dict) -> list[dict]:
    """Reproduce the same 8×8 grid as elevation_service.seed_candidate_points."""
    points = []
    lat_span = bbox["north"] - bbox["south"]
    lon_span = bbox["east"] - bbox["west"]
    for row in range(GRID_SIZE):
        for col in range(GRID_SIZE):
            lat = bbox["south"] + ((row + 0.5) / GRID_SIZE) * lat_span
            lon = bbox["west"]  + ((col + 0.5) / GRID_SIZE) * lon_span
            points.append({"lat": round(lat, 6), "lon": round(lon, 6), "row": row, "col": col})
    return points


def score_candidate(pt: dict, snap: dict) -> dict:
    """Quick rules-based scoring — mirrors elevation_service.score_candidates."""
    fire    = snap.get("fire") or {}
    weather = snap.get("weather") or {}
    hydro   = snap.get("hydro") or {}
    roads   = snap.get("roads") or {}
    terrain = snap.get("terrain") or {}

    fire_score  = float(fire.get("danger_score", 0.4))
    w_risk      = float(weather.get("weather_risk_score", 0.15))
    t_score     = min(1.0, float(terrain.get("slope_deg", 15)) / 60 * 0.45
                      + min(1.0, (float(terrain.get("elevation_m", 1800)) - 600) / 3400) * 0.35
                      + 0.5 * 0.20)
    flood_map   = {"none": 0.15, "minor": 0.55, "moderate": 0.80, "major": 1.0}
    water_score = flood_map.get(hydro.get("flood_severity", "none"), 0.2)
    n_road      = int(roads.get("count", 0))
    closure     = 0.3 if roads.get("has_closure") else 0.0
    access      = min(1.0, n_road / 5.0 + closure)

    composite = (fire_score*0.25 + w_risk*0.30 + t_score*0.25
                 + water_score*0.10 + access*0.10)

    return {
        **pt,
        "fire_score":    round(fire_score, 3),
        "weather_score": round(w_risk, 3),
        "terrain_score": round(t_score, 3),
        "water_score":   round(water_score, 3),
        "access_score":  round(access, 3),
        "composite_score": round(float(np.clip(composite, 0.0, 1.0)), 3),
    }


def score_to_level(score: float) -> str:
    if score >= 0.75: return "extreme"
    if score >= 0.55: return "high"
    if score >= 0.35: return "moderate"
    return "low"


def build_user_message(snap: dict, candidates: list[dict]) -> str:
    """Format the user-turn JSON payload."""
    top20 = sorted(candidates, key=lambda c: c["composite_score"], reverse=True)[:20]
    payload = {
        "bbox": snap["bbox"],
        "month": snap.get("month", 7),
        "hour_local": 14,
        "conditions": {
            "weather": {k: v for k, v in (snap.get("weather") or {}).items() if k != "source"},
            "fire": snap.get("fire") or {},
            "hydro": snap.get("hydro") or {},
            "roads": snap.get("roads") or {},
            "wildfires_active": [],
        },
        "candidates": top20,
    }
    return json.dumps(payload, separators=(",", ":"))


def build_positive_assistant(snap: dict) -> str:
    """Build the assistant message placing a hotspot at the actual incident location."""
    fire    = snap.get("fire") or {}
    weather = snap.get("weather") or {}
    terrain = snap.get("terrain") or {}
    hydro   = snap.get("hydro") or {}

    fire_s   = float(fire.get("danger_score", 0.4))
    w_risk   = float(weather.get("weather_risk_score", 0.15))
    t_score  = min(1.0, float(terrain.get("slope_deg", 15)) / 60 * 0.45 + 0.4)
    flood_m  = {"none": 0.15, "minor": 0.55, "moderate": 0.80, "major": 1.0}
    water_s  = flood_m.get((hydro.get("flood_severity") or "none"), 0.2)
    access_s = 0.3 if snap.get("roads", {}).get("has_closure") else 0.2

    risk_score = round(float(np.clip(
        fire_s*0.25 + w_risk*0.30 + t_score*0.25 + water_s*0.10 + access_s*0.10
        + 0.10,  # +0.10 bias: this is a known incident location
        0.0, 1.0,
    )), 3)
    risk_level = score_to_level(risk_score)
    incident_type = snap.get("incident_type", "unknown")

    # Short description from terrain + type
    type_desc = {
        "fall":         "steep terrain and exposed trail increases fall risk",
        "drowning":     "proximity to water crossings with elevated flow",
        "medical":      "remote location with limited emergency access",
        "vehicle":      "road section with historically elevated incident frequency",
        "rockfall":     "unstable rock faces above the trail corridor",
        "lightning":    "exposed ridge with afternoon convective storm risk",
        "search_rescue":"remote backcountry with limited trail markings",
        "fire_related": "active fire perimeter with smoke and access restrictions",
        "unknown":      "elevated composite risk score from multiple factors",
    }.get(incident_type, "elevated composite risk")

    hotspot = {
        "id": "HOTSPOT-001",
        "lat": round(snap["incident_lat"], 6),
        "lon": round(snap["incident_lon"], 6),
        "radiusMeters": 400,
        "riskScore": risk_score,
        "riskLevel": risk_level,
        "incidentType": incident_type,
        "factors": {
            "fire":          round(fire_s, 3),
            "weather":       round(w_risk, 3),
            "terrain":       round(t_score, 3),
            "water":         round(water_s, 3),
            "accessibility": round(access_s, 3),
        },
        "description": f"Historical incident zone: {type_desc}.",
        "recommendations": [
            f"Increase ranger patrol frequency near {snap.get('location_raw') or 'this zone'}",
            "Verify sensor coverage and alert thresholds in this area",
        ],
    }
    return json.dumps({"hotspots": [hotspot]}, separators=(",", ":"))


def build_negative_assistant() -> str:
    return json.dumps({"hotspots": []}, separators=(",", ":"))


def shift_bbox(bbox: dict, dlat: float, dlon: float) -> dict:
    return {
        "south": bbox["south"] + dlat,
        "north": bbox["north"] + dlat,
        "west":  bbox["west"]  + dlon,
        "east":  bbox["east"]  + dlon,
    }


def make_sample(system: str, user: str, assistant: str) -> dict:
    return {"messages": [
        {"role": "system",    "content": system},
        {"role": "user",      "content": user},
        {"role": "assistant", "content": assistant},
    ]}


def main():
    random.seed(42)

    if not INPUT_FILE.exists():
        log.error("Input file not found: %s — run build_conditions_snapshot.py first", INPUT_FILE)
        return

    snapshots = []
    with open(INPUT_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                snapshots.append(json.loads(line))

    log.info("Loaded %d condition snapshots", len(snapshots))

    # Determine validation year cutoff (latest year in dataset)
    all_years = sorted({s.get("year", 2000) for s in snapshots})
    global VAL_YEAR_CUTOFF
    VAL_YEAR_CUTOFF = all_years[-1] if all_years else 1991

    train_samples: list[dict] = []
    val_samples:   list[dict] = []

    for snap in snapshots:
        bbox = snap["bbox"]
        candidates = [score_candidate(pt, snap) for pt in seed_candidates(bbox)]

        # Positive sample
        user_msg   = build_user_message(snap, candidates)
        assist_msg = build_positive_assistant(snap)
        sample = make_sample(SYSTEM_PROMPT, user_msg, assist_msg)

        is_val = (snap.get("year", 0) >= VAL_YEAR_CUTOFF)
        if is_val:
            val_samples.append(sample)
        else:
            train_samples.append(sample)

        # Negative samples (shifted bbox, same conditions)
        if not is_val:
            offsets = [
                (+0.15, +0.20), (-0.15, -0.20),
                (+0.20, -0.10), (-0.10, +0.15),
            ]
            for dlat, dlon in offsets:
                neg_snap = dict(snap)
                neg_snap["bbox"] = shift_bbox(bbox, dlat, dlon)
                neg_bbox = neg_snap["bbox"]
                # Lower risk conditions slightly for negatives
                neg_weather = dict(snap.get("weather") or {})
                neg_weather["weather_risk_score"] = max(0.05, float(neg_weather.get("weather_risk_score", 0.1)) - 0.15)
                neg_snap["weather"] = neg_weather
                neg_cands = [score_candidate(pt, neg_snap) for pt in seed_candidates(neg_bbox)]
                neg_user  = build_user_message(neg_snap, neg_cands)
                neg_sample = make_sample(SYSTEM_PROMPT, neg_user, build_negative_assistant())
                train_samples.append(neg_sample)

    random.shuffle(train_samples)
    random.shuffle(val_samples)

    HERE.parent  # backend/training/
    (HERE / "output").mkdir(parents=True, exist_ok=True)

    with open(TRAIN_FILE, "w", encoding="utf-8") as f:
        for s in train_samples:
            f.write(json.dumps(s) + "\n")

    with open(VAL_FILE, "w", encoding="utf-8") as f:
        for s in val_samples:
            f.write(json.dumps(s) + "\n")

    log.info("Training samples: %d  →  %s", len(train_samples), TRAIN_FILE)
    log.info("Validation samples: %d  →  %s", len(val_samples), VAL_FILE)
    log.info("Val year cutoff: %d", VAL_YEAR_CUTOFF)


if __name__ == "__main__":
    main()
