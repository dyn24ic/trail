"""
Train XGBoost hotspot prediction models from conditions_snapshots.jsonl.

Two models are trained:

  1. hotspot_model.json
     Binary classifier: given a candidate grid point and its pre-scored features,
     predict whether this location will produce an incident.
     Trained on all 64 candidate points per snapshot; labels derived by comparing
     each candidate to the actual incident lat/lon (threshold: 1 000 m).

  2. incident_type_model.json
     Multi-class classifier: given the same features, predict the incident type
     (fall, drowning, vehicle, …).
     Trained only on the positive (hotspot) candidates.

Features (19 total — see FEATURE_NAMES):
  Per-candidate scores from elevation_service.score_candidates:
    fire_score, weather_score, terrain_score, water_score, access_score, composite_score
  Position within bbox (normalised –1 to +1):
    lat_norm, lon_norm
  Absolute coordinates:
    lat_abs, lon_abs
  Cyclical time encoding:
    month_sin, month_cos, hour_sin, hour_cos
  Global bbox-level conditions:
    weather_risk, fire_danger, flood_encoded, road_count_norm, has_closure

Output (written to --out-dir):
  hotspot_model.json
  incident_type_model.json
  label_encoder.json     (int ↔ incident_type string mapping)
  feature_names.json     (ordered list for documentation)

Usage:
  # Standalone (no Django required):
  pip install xgboost scikit-learn numpy
  python 04_xgboost/train_xgboost.py --snapshots 01_data/output/conditions_snapshots.jsonl

  # With output to custom directory:
  python 04_xgboost/train_xgboost.py \\
      --snapshots 01_data/output/conditions_snapshots.jsonl \\
      --out-dir   04_xgboost/models
"""
import argparse
import json
import logging
import math
from pathlib import Path

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GRID_SIZE   = 8          # matches elevation_service.seed_candidate_points
LABEL_RADIUS_M = 1_000   # candidates within this distance of incident → positive

INCIDENT_TYPES = [
    "fall", "drowning", "medical", "vehicle",
    "rockfall", "lightning", "search_rescue", "fire_related", "unknown",
]
TYPE_TO_INT = {t: i for i, t in enumerate(INCIDENT_TYPES)}
INT_TO_TYPE = {i: t for i, t in enumerate(INCIDENT_TYPES)}

FEATURE_NAMES = [
    "fire_score",
    "weather_score",
    "terrain_score",
    "water_score",
    "access_score",
    "composite_score",
    "lat_norm",
    "lon_norm",
    "lat_abs",
    "lon_abs",
    "month_sin",
    "month_cos",
    "hour_sin",
    "hour_cos",
    "weather_risk",
    "fire_danger",
    "flood_encoded",
    "road_count_norm",
    "has_closure",
]

_FLOOD_ENCODE = {"none": 0.0, "minor": 0.33, "moderate": 0.67, "major": 1.0}
_HOUR_DEFAULT = 14


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(min(1.0, a)))


# ---------------------------------------------------------------------------
# Candidate grid (mirrors elevation_service.seed_candidate_points)
# ---------------------------------------------------------------------------

def seed_candidates(bbox: dict) -> list[dict]:
    points = []
    lat_span = bbox["north"] - bbox["south"]
    lon_span = bbox["east"]  - bbox["west"]
    for row in range(GRID_SIZE):
        for col in range(GRID_SIZE):
            lat = bbox["south"] + ((row + 0.5) / GRID_SIZE) * lat_span
            lon = bbox["west"]  + ((col + 0.5) / GRID_SIZE) * lon_span
            points.append({"lat": lat, "lon": lon, "row": row, "col": col})
    return points


# ---------------------------------------------------------------------------
# Per-candidate scoring (mirrors build_training_jsonl.score_candidate)
# ---------------------------------------------------------------------------

def score_candidate(pt: dict, snap: dict) -> dict:
    fire    = snap.get("fire")    or {}
    weather = snap.get("weather") or {}
    hydro   = snap.get("hydro")   or {}
    roads   = snap.get("roads")   or {}
    terrain = snap.get("terrain") or {}

    fire_s  = float(fire.get("danger_score", 0.4))
    w_risk  = float(weather.get("weather_risk_score", 0.15))
    t_score = min(1.0, float(terrain.get("slope_deg", 15)) / 60 * 0.45
                  + min(1.0, (float(terrain.get("elevation_m", 1800)) - 600) / 3400) * 0.35
                  + 0.5 * 0.20)
    w_score  = _FLOOD_ENCODE.get(hydro.get("flood_severity", "none"), 0.2)
    n_road   = int(roads.get("count", 0))
    closure  = 0.3 if roads.get("has_closure") else 0.0
    acc      = min(1.0, n_road / 5.0 + closure)
    comp     = fire_s * 0.25 + w_risk * 0.30 + t_score * 0.25 + w_score * 0.10 + acc * 0.10

    return {
        **pt,
        "fire_score":      round(fire_s, 3),
        "weather_score":   round(w_risk, 3),
        "terrain_score":   round(t_score, 3),
        "water_score":     round(w_score, 3),
        "access_score":    round(acc, 3),
        "composite_score": round(float(np.clip(comp, 0.0, 1.0)), 3),
    }


# ---------------------------------------------------------------------------
# Feature vector
# ---------------------------------------------------------------------------

def build_features(scored_pt: dict, snap: dict, bbox: dict) -> list[float]:
    """Build a 19-element feature vector for a single candidate point."""
    weather = snap.get("weather") or {}
    fire    = snap.get("fire")    or {}
    hydro   = snap.get("hydro")   or {}
    roads   = snap.get("roads")   or {}

    # Bbox-normalised position (–1 to +1)
    cx = (bbox["west"]  + bbox["east"])  / 2
    cy = (bbox["south"] + bbox["north"]) / 2
    half_lat = max((bbox["north"] - bbox["south"]) / 2, 1e-6)
    half_lon = max((bbox["east"]  - bbox["west"])  / 2, 1e-6)
    lat_norm = (scored_pt["lat"] - cy) / half_lat
    lon_norm = (scored_pt["lon"] - cx) / half_lon

    # Cyclical time
    month = int(snap.get("month", 7))
    hour  = int(snap.get("hour_local", _HOUR_DEFAULT))
    month_sin = math.sin(2 * math.pi * month / 12)
    month_cos = math.cos(2 * math.pi * month / 12)
    hour_sin  = math.sin(2 * math.pi * hour  / 24)
    hour_cos  = math.cos(2 * math.pi * hour  / 24)

    # Global conditions
    weather_risk   = float(weather.get("weather_risk_score", 0.15))
    fire_danger    = float(fire.get("danger_score", 0.4))
    flood_encoded  = _FLOOD_ENCODE.get(hydro.get("flood_severity", "none"), 0.0)
    road_count_norm = min(1.0, int(roads.get("count", 0)) / 5.0)
    has_closure    = float(bool(roads.get("has_closure")))

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
# Dataset builder
# ---------------------------------------------------------------------------

def build_dataset(snapshots: list[dict]) -> tuple:
    """
    Returns:
        X_hotspot   (N_candidates, 19) — all candidate rows
        y_hotspot   (N_candidates,)    — 1 if within LABEL_RADIUS_M of incident
        X_type      (N_positive, 19)   — positive candidates only
        y_type      (N_positive,)      — incident type int
    """
    X_hotspot, y_hotspot = [], []
    X_type,    y_type    = [], []

    skipped = 0
    for snap in snapshots:
        inc_lat = snap.get("incident_lat")
        inc_lon = snap.get("incident_lon")
        if inc_lat is None or inc_lon is None:
            skipped += 1
            continue

        bbox       = snap["bbox"]
        inc_type   = TYPE_TO_INT.get(snap.get("incident_type", "unknown"),
                                     TYPE_TO_INT["unknown"])
        candidates = seed_candidates(bbox)
        scored     = [score_candidate(pt, snap) for pt in candidates]

        # Ensure at least the nearest candidate is labelled positive
        dists      = [haversine_m(s["lat"], s["lon"], inc_lat, inc_lon) for s in scored]
        min_dist   = min(dists)
        threshold  = max(LABEL_RADIUS_M, min_dist + 1)  # always ≥ 1 positive

        for s, d in zip(scored, dists):
            feat  = build_features(s, snap, bbox)
            label = 1 if d <= threshold else 0
            X_hotspot.append(feat)
            y_hotspot.append(label)
            if label == 1:
                X_type.append(feat)
                y_type.append(inc_type)

    log.info("Dataset: %d candidate rows (%d positive, %d negative) from %d snapshots, %d skipped",
             len(y_hotspot),
             sum(y_hotspot),
             len(y_hotspot) - sum(y_hotspot),
             len(snapshots) - skipped,
             skipped)

    return (
        np.array(X_hotspot, dtype=np.float32),
        np.array(y_hotspot, dtype=np.int32),
        np.array(X_type,    dtype=np.float32),
        np.array(y_type,    dtype=np.int32),
    )


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train(snapshots: list[dict], out_dir: Path):
    try:
        import xgboost as xgb
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import classification_report
    except ImportError as e:
        log.error("Missing dependency: %s  |  pip install xgboost scikit-learn", e)
        raise

    out_dir.mkdir(parents=True, exist_ok=True)

    X_h, y_h, X_t, y_t = build_dataset(snapshots)

    # ── Model 1: Hotspot detection ─────────────────────────────────────────
    log.info("Training hotspot detector (XGBClassifier) …")
    pos = int(y_h.sum())
    neg = len(y_h) - pos
    scale_pos = neg / max(pos, 1)  # handle class imbalance

    Xh_tr, Xh_val, yh_tr, yh_val = train_test_split(
        X_h, y_h, test_size=0.15, random_state=42, stratify=y_h,
    )

    hotspot_model = xgb.XGBClassifier(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos,
        use_label_encoder=False,
        eval_metric="logloss",
        tree_method="hist",
        random_state=42,
        n_jobs=-1,
    )
    hotspot_model.fit(
        Xh_tr, yh_tr,
        eval_set=[(Xh_val, yh_val)],
        verbose=50,
    )

    yh_pred = hotspot_model.predict(Xh_val)
    log.info("Hotspot detector validation:\n%s", classification_report(yh_val, yh_pred,
             target_names=["no_hotspot", "hotspot"]))

    hotspot_path = out_dir / "hotspot_model.json"
    hotspot_model.save_model(str(hotspot_path))
    log.info("Saved hotspot model → %s", hotspot_path)

    # ── Model 2: Incident type classifier ─────────────────────────────────
    if len(X_t) < 20:
        log.warning("Only %d positive samples — skipping incident type classifier", len(X_t))
    else:
        log.info("Training incident type classifier (XGBClassifier, %d samples) …", len(X_t))
        Xt_tr, Xt_val, yt_tr, yt_val = train_test_split(
            X_t, y_t, test_size=0.15, random_state=42,
            stratify=y_t if len(np.unique(y_t)) > 1 else None,
        )

        type_model = xgb.XGBClassifier(
            n_estimators=300,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            num_class=len(INCIDENT_TYPES),
            objective="multi:softprob",
            use_label_encoder=False,
            eval_metric="mlogloss",
            tree_method="hist",
            random_state=42,
            n_jobs=-1,
        )
        type_model.fit(
            Xt_tr, yt_tr,
            eval_set=[(Xt_val, yt_val)],
            verbose=50,
        )

        yt_pred = type_model.predict(Xt_val)
        present = sorted(np.unique(np.concatenate([yt_val, yt_pred])))
        log.info("Type classifier validation:\n%s",
                 classification_report(yt_val, yt_pred,
                                       labels=present,
                                       target_names=[INCIDENT_TYPES[i] for i in present]))

        type_path = out_dir / "incident_type_model.json"
        type_model.save_model(str(type_path))
        log.info("Saved type model → %s", type_path)

    # ── Metadata ──────────────────────────────────────────────────────────
    label_encoder = {"int_to_type": INT_TO_TYPE, "type_to_int": TYPE_TO_INT}
    with open(out_dir / "label_encoder.json", "w") as f:
        json.dump(label_encoder, f, indent=2)

    with open(out_dir / "feature_names.json", "w") as f:
        json.dump(FEATURE_NAMES, f, indent=2)

    log.info("Training complete. Artifacts in %s", out_dir)
    log.info("Copy those files to the path set by XGBOOST_MODEL_DIR in Django settings.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Train XGBoost hotspot models")
    parser.add_argument(
        "--snapshots",
        default="01_data/output/conditions_snapshots.jsonl",
        help="Path to conditions_snapshots.jsonl",
    )
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).parent / "models"),
        help="Directory to write trained model files",
    )
    args = parser.parse_args()

    snap_path = Path(args.snapshots)
    if not snap_path.exists():
        log.error("Snapshots file not found: %s — run build_conditions_snapshot.py first", snap_path)
        return

    snapshots = []
    with open(snap_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                snapshots.append(json.loads(line))

    log.info("Loaded %d condition snapshots from %s", len(snapshots), snap_path)
    train(snapshots, Path(args.out_dir))


if __name__ == "__main__":
    main()
