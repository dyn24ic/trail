"""
XGBoost-based hotspot prediction for the trAIl Django service.

Loads pre-trained XGBoost models from the directory specified by the Django
setting XGBOOST_MODEL_DIR. Models are lazy-loaded on first call and then
cached in module state for the lifetime of the process.

Expected files in XGBOOST_MODEL_DIR (produced by training/04_xgboost/train_xgboost.py):
  hotspot_model.json        — XGBClassifier: P(candidate is a hotspot)
  incident_type_model.json  — XGBClassifier: incident type for detected hotspots
  label_encoder.json        — {"int_to_type": {...}, "type_to_int": {...}}

Public API:
    predict(scored_candidates, raw_conditions, bbox, month, hour_local)
        -> list[dict]   (hotspot dicts, same schema as hotspot_service._validate_hotspot)

Returns None if models are unavailable (caller falls back to next tier).
"""
import json
import logging
import math
import os
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level model cache
# ---------------------------------------------------------------------------
_hotspot_model = None
_type_model    = None
_int_to_type   = None
_models_loaded = False   # True once a load attempt has been made

_FLOOD_ENCODE = {"none": 0.0, "minor": 0.33, "moderate": 0.67, "major": 1.0}

# A candidate's hotspot probability must exceed this threshold to be surfaced
HOTSPOT_THRESHOLD = 0.35
MAX_HOTSPOTS      = 10


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def _try_load_models(model_dir: str) -> bool:
    global _hotspot_model, _type_model, _int_to_type

    try:
        import xgboost as xgb
    except ImportError:
        logger.debug("xgboost not installed — XGBoost inference unavailable")
        return False

    hotspot_path = os.path.join(model_dir, "hotspot_model.json")
    type_path    = os.path.join(model_dir, "incident_type_model.json")
    encoder_path = os.path.join(model_dir, "label_encoder.json")

    if not os.path.isfile(hotspot_path):
        logger.debug("XGBoost model not found at %s", hotspot_path)
        return False

    try:
        m = xgb.XGBClassifier()
        m.load_model(hotspot_path)
        _hotspot_model = m
        logger.info("Loaded XGBoost hotspot model from %s", hotspot_path)
    except Exception as exc:
        logger.warning("Failed to load hotspot model: %s", exc)
        return False

    if os.path.isfile(type_path):
        try:
            tm = xgb.XGBClassifier()
            tm.load_model(type_path)
            _type_model = tm
            logger.info("Loaded XGBoost incident-type model from %s", type_path)
        except Exception as exc:
            logger.warning("Incident type model unavailable: %s", exc)

    if os.path.isfile(encoder_path):
        with open(encoder_path, encoding="utf-8") as f:
            data = json.load(f)
        _int_to_type = {int(k): v for k, v in data.get("int_to_type", {}).items()}

    return True


def _ensure_models_loaded() -> bool:
    global _models_loaded
    if _models_loaded:
        return _hotspot_model is not None

    _models_loaded = True
    try:
        from django.conf import settings
        model_dir = getattr(settings, "XGBOOST_MODEL_DIR", "")
    except Exception:
        model_dir = os.getenv("XGBOOST_MODEL_DIR", "")

    if not model_dir:
        logger.debug("XGBOOST_MODEL_DIR not set — XGBoost inference disabled")
        return False

    return _try_load_models(str(model_dir))


# ---------------------------------------------------------------------------
# Feature engineering  (mirrors train_xgboost.build_features exactly)
# ---------------------------------------------------------------------------

def _build_feature_row(scored_pt: dict, snap_conditions: dict, bbox: dict,
                        month: int, hour_local: int) -> list[float]:
    weather = snap_conditions.get("weather") or {}
    fire    = snap_conditions.get("fire")    or {}
    hydro   = snap_conditions.get("hydro")   or {}
    roads   = snap_conditions.get("roads")   or {}

    cx = (bbox["west"]  + bbox["east"])  / 2
    cy = (bbox["south"] + bbox["north"]) / 2
    half_lat = max((bbox["north"] - bbox["south"]) / 2, 1e-6)
    half_lon = max((bbox["east"]  - bbox["west"])  / 2, 1e-6)
    lat_norm = (scored_pt["lat"] - cy) / half_lat
    lon_norm = (scored_pt["lon"] - cx) / half_lon

    month_sin = math.sin(2 * math.pi * month     / 12)
    month_cos = math.cos(2 * math.pi * month     / 12)
    hour_sin  = math.sin(2 * math.pi * hour_local / 24)
    hour_cos  = math.cos(2 * math.pi * hour_local / 24)

    weather_risk    = float(weather.get("weather_risk_score", 0.15))
    fire_danger     = float(fire.get("danger_score", 0.4))
    flood_encoded   = _FLOOD_ENCODE.get(hydro.get("flood_severity", "none"), 0.0)
    road_count_norm = min(1.0, int(roads.get("count", 0)) / 5.0)
    has_closure     = float(bool(roads.get("has_closure")))

    return [
        scored_pt.get("fire_score",      0.4),
        scored_pt.get("weather_score",   0.15),
        scored_pt.get("terrain_score",   0.35),
        scored_pt.get("water_score",     0.2),
        scored_pt.get("access_score",    0.2),
        scored_pt.get("composite_score", 0.3),
        lat_norm,
        lon_norm,
        scored_pt["lat"],
        scored_pt["lon"],
        month_sin,
        month_cos,
        hour_sin,
        hour_cos,
        weather_risk,
        fire_danger,
        flood_encoded,
        road_count_norm,
        has_closure,
    ]


# ---------------------------------------------------------------------------
# Risk level helpers
# ---------------------------------------------------------------------------

def _score_to_level(score: float) -> str:
    if score >= 0.75: return "extreme"
    if score >= 0.55: return "high"
    if score >= 0.35: return "moderate"
    return "low"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def predict(
    scored_candidates: list[dict],
    raw_conditions: dict,
    bbox: dict,
    month: int,
    hour_local: int,
) -> Optional[list[dict]]:
    """
    Run XGBoost inference over all scored candidate points.

    Args:
        scored_candidates: output of elevation_service.score_candidates (all 64 points)
        raw_conditions:    the 'raw' dict from hotspot_service._fetch_all_data
                           (keys: weather, fire, hydro, roads, wildfires, smoke_aqi)
        bbox:              {south, north, west, east}
        month:             1–12
        hour_local:        0–23

    Returns:
        List of hotspot dicts on success, or None if models are not available.
    """
    if not _ensure_models_loaded():
        return None

    if not scored_candidates:
        return []

    # Build feature matrix
    snap_conditions = {
        "weather": raw_conditions.get("weather") or {},
        "fire":    raw_conditions.get("fire")    or {},
        "hydro":   raw_conditions.get("hydro")   or {},
        "roads":   raw_conditions.get("roads")   or {},
    }
    X = np.array(
        [_build_feature_row(c, snap_conditions, bbox, month, hour_local)
         for c in scored_candidates],
        dtype=np.float32,
    )

    # Hotspot probabilities
    proba = _hotspot_model.predict_proba(X)[:, 1]   # P(hotspot)

    # Incident type predictions (fallback to composite-score heuristic if type model absent)
    if _type_model is not None:
        type_proba = _type_model.predict_proba(X)    # (N, n_classes)
        type_ints  = type_proba.argmax(axis=1)
    else:
        type_ints = None

    # Select top candidates above threshold, de-duplicated by proximity
    ranked = sorted(
        enumerate(scored_candidates),
        key=lambda t: proba[t[0]],
        reverse=True,
    )

    hotspots = []
    used_positions: list[tuple[float, float]] = []
    MIN_SEPARATION_M = 300   # don't emit two hotspots closer than this

    for idx, cand in ranked:
        if proba[idx] < HOTSPOT_THRESHOLD:
            break
        if len(hotspots) >= MAX_HOTSPOTS:
            break

        # Proximity deduplication
        too_close = any(
            _haversine_m(cand["lat"], cand["lon"], lat2, lon2) < MIN_SEPARATION_M
            for lat2, lon2 in used_positions
        )
        if too_close:
            continue

        used_positions.append((cand["lat"], cand["lon"]))

        risk_score = float(np.clip(proba[idx], 0.0, 1.0))
        risk_level = _score_to_level(risk_score)

        # Incident type
        if type_ints is not None and _int_to_type:
            incident_type = _int_to_type.get(int(type_ints[idx]), "unknown")
        else:
            # Heuristic fallback from factor scores
            incident_type = _type_from_scores(cand)

        hotspots.append({
            "id":           f"HOTSPOT-{len(hotspots)+1:03d}",
            "lat":          round(cand["lat"], 6),
            "lon":          round(cand["lon"], 6),
            "radiusMeters": 400,
            "riskScore":    round(risk_score, 3),
            "riskLevel":    risk_level,
            "incidentType": incident_type,
            "factors": {
                "fire":          round(cand.get("fire_score",    0.4),  3),
                "weather":       round(cand.get("weather_score", 0.15), 3),
                "terrain":       round(cand.get("terrain_score", 0.35), 3),
                "water":         round(cand.get("water_score",   0.2),  3),
                "accessibility": round(cand.get("access_score",  0.2),  3),
            },
            "description":     f"XGBoost-predicted risk zone ({risk_level.upper()}, p={risk_score:.2f}).",
            "recommendations": _recommendations(incident_type, risk_level),
        })

    return hotspots


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(min(1.0, a)))


def _type_from_scores(cand: dict) -> str:
    if cand.get("water_score",   0) >= 0.7: return "drowning"
    if cand.get("terrain_score", 0) >= 0.7: return "fall"
    if cand.get("fire_score",    0) >= 0.7: return "fire_related"
    if cand.get("access_score",  0) >= 0.5: return "vehicle"
    return "unknown"


_RECS = {
    "fall":         ["Increase patrol on exposed trail sections", "Post warning signs at trailhead"],
    "drowning":     ["Close river access at high-flow points", "Deploy swift-water rescue team"],
    "medical":      ["Pre-position first-aid at high-altitude trailheads", "Alert ranger station"],
    "vehicle":      ["Increase road patrol frequency", "Check for road closure conditions"],
    "rockfall":     ["Issue rockfall advisory for this zone", "Restrict camping below cliff faces"],
    "lightning":    ["Post afternoon storm warnings at summit trailheads", "Close exposed ridges by noon"],
    "search_rescue":["Brief SAR team on backcountry access routes", "Verify beacon coverage"],
    "fire_related": ["Confirm evacuation routes are clear", "Coordinate with fire suppression crews"],
    "unknown":      ["Increase patrol frequency in this zone", "Verify sensor coverage"],
}


def _recommendations(incident_type: str, risk_level: str) -> list[str]:
    recs = list(_RECS.get(incident_type, _RECS["unknown"]))
    if risk_level in ("high", "extreme"):
        recs.insert(0, f"PRIORITY: {risk_level.upper()} risk zone — pre-position SAR resources")
    return recs[:4]
