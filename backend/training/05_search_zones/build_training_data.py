"""
Build chat-format JSONL training data for Nemotron 70B search zone prediction.

Reads conditions_snapshots.jsonl (produced by build_conditions_snapshot.py) and converts
each snapshot into a training sample where:
  - User message: trigger event context + weather/fire/hydro conditions
  - Assistant message: 3 prioritised search zones centred on the actual incident location

Trigger type mapping (incident_type → TriggerEvent subtype):
  fall, rockfall, lightning   → SensorAnomaly  (motion/audio sensor most likely)
  drowning                    → SensorAnomaly  (river sensor or overdue swimmer)
  search_rescue, medical      → OverdueHiker   (person didn't return from trail)
  vehicle                     → CallBox        (road call box press)
  fire_related, unknown       → Emergency911   (called 911)

Zone construction:
  Zone 1 (200 m)  — centred on actual incident lat/lon; confidence 0.80–0.95
  Zone 2 (350 m)  — offset ~300–500 m along dominant terrain direction; confidence 0.55–0.75
  Zone 3 (500 m)  — offset ~500–800 m in secondary direction; confidence 0.35–0.55

Negative samples (~20% of output): low-risk snapshots (composite_score < 0.20) that
produce {"search_zones": []} — teaching the model to suppress false alarms.

Usage:
    python 05_search_zones/build_training_data.py \
        --snapshots 01_data/output/conditions_snapshots.jsonl \
        --out-dir   05_search_zones/output
"""
import argparse
import json
import logging
import math
import random
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

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

# Map incident_type → TriggerEvent subtype name (matches Scala domain model)
_TYPE_TO_TRIGGER = {
    "fall":          "SensorAnomaly",
    "rockfall":      "SensorAnomaly",
    "lightning":     "SensorAnomaly",
    "drowning":      "SensorAnomaly",
    "medical":       "OverdueHiker",
    "search_rescue": "OverdueHiker",
    "vehicle":       "CallBox",
    "fire_related":  "Emergency911",
    "unknown":       "Emergency911",
}

# Extra fields per trigger type (realistic but synthetic)
_TRIGGER_EXTRA = {
    "SensorAnomaly": lambda snap: {
        "sensorId":    f"SENSOR-{abs(hash(str(snap.get('incident_lat', 0))))% 9000 + 1000}",
        "anomalyType": "motion_audio",
    },
    "OverdueHiker": lambda snap: {
        "hikerId":         f"HIKER-{abs(hash(str(snap.get('incident_lat', 0)))) % 9000 + 1000}",
        "trailId":         "yosemite-backcountry",
        "overdueMinutes":  random.randint(60, 360),
        "lastKnownLat":    snap.get("incident_lat", 0),
        "lastKnownLng":    snap.get("incident_lon", 0),
    },
    "CallBox": lambda snap: {
        "deviceId": f"BOX-{abs(hash(str(snap.get('incident_lat', 0)))) % 900 + 100}",
    },
    "Emergency911": lambda snap: {
        "callId":             f"E911-{abs(hash(str(snap.get('incident_lat', 0)))) % 9000 + 1000}",
        "callerDescription":  "Caller reported seeing an injured hiker near the trail.",
    },
}

# Confidence ranges per zone priority
_CONF_RANGES = [
    (0.80, 0.95),   # zone 1 — primary
    (0.55, 0.75),   # zone 2 — secondary
    (0.35, 0.55),   # zone 3 — tertiary
]

# Zone radii (metres)
_RADII = [200.0, 350.0, 500.0]

# Negative sample threshold: snapshots with overall composite score below this
# value are considered low-risk and produce an empty search zone response
NEGATIVE_COMPOSITE_THRESHOLD = 0.20

# Fraction of low-risk snapshots to include as negatives (rest are discarded)
NEGATIVE_SAMPLE_RATE = 0.25


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _offset_coords(lat: float, lng: float, dist_m: float, bearing_deg: float):
    """Return (lat, lng) offset from origin by dist_m metres at bearing_deg."""
    R = 6_371_000.0
    bearing = math.radians(bearing_deg)
    lat_r = math.radians(lat)
    lng_r = math.radians(lng)
    new_lat_r = math.asin(
        math.sin(lat_r) * math.cos(dist_m / R)
        + math.cos(lat_r) * math.sin(dist_m / R) * math.cos(bearing)
    )
    new_lng_r = lng_r + math.atan2(
        math.sin(bearing) * math.sin(dist_m / R) * math.cos(lat_r),
        math.cos(dist_m / R) - math.sin(lat_r) * math.sin(new_lat_r),
    )
    return round(math.degrees(new_lat_r), 6), round(math.degrees(new_lng_r), 6)


def _terrain_bearing(snap: dict, idx: int) -> float:
    """
    Derive a plausible bearing for offset zone idx based on terrain/incident hints.
    Zone 1 is always at origin (incident location).
    Zone 2: head slightly uphill / along ridge (45–135° from north in high-terrain).
    Zone 3: perpendicular to zone 2 or toward nearest water body.
    """
    terrain = snap.get("terrain") or {}
    hydro   = snap.get("hydro")   or {}

    base = 45.0 * (idx + 1)   # distribute zones around compass

    # Lean toward water if drowning likely
    if hydro.get("flood_severity", "none") not in ("none",):
        base = (base + 180.0) % 360.0   # flip toward water

    # Small random perturbation so zones don't cluster on a fixed line
    return (base + random.uniform(-30, 30)) % 360.0


def _composite_score(snap: dict) -> float:
    """Return overall composite risk score from snapshot (weighted average of factor scores)."""
    fire    = (snap.get("fire")    or {}).get("danger_score",       0.4)
    weather = (snap.get("weather") or {}).get("weather_risk_score", 0.15)
    return float(fire) * 0.5 + float(weather) * 0.5


# ---------------------------------------------------------------------------
# Sample builders
# ---------------------------------------------------------------------------

def _build_user_content(snap: dict, trigger_type: str) -> str:
    inc_lat = snap.get("incident_lat", 0.0)
    inc_lon = snap.get("incident_lon", 0.0)
    weather = snap.get("weather") or {}
    fire    = snap.get("fire")    or {}
    hydro   = snap.get("hydro")   or {}

    extra_fn = _TRIGGER_EXTRA.get(trigger_type, _TRIGGER_EXTRA["Emergency911"])
    extra    = extra_fn(snap)

    payload = {
        "trigger_type":       trigger_type,
        "lat":                round(inc_lat, 6),
        "lng":                round(inc_lon, 6),
        "trigger_payload":    extra,
        "month":              int(snap.get("month", 7)),
        "hour_local":         int(snap.get("hour_local", 14)),
        "weather": {
            "temperature_c":      weather.get("temperature_c", 20),
            "windspeed_kmh":      weather.get("windspeed_kmh", 10),
            "weather_risk_score": weather.get("weather_risk_score", 0.15),
            "conditions":         weather.get("conditions", {}),
        },
        "fire": {
            "danger_rating": fire.get("danger_rating", "MODERATE"),
            "danger_score":  fire.get("danger_score", 0.4),
        },
        "hydro": {
            "flood_severity": (hydro.get("flood_severity") or "none"),
        },
        "incident_type_context": snap.get("incident_type", "unknown"),
    }
    return json.dumps(payload, separators=(",", ":"))


def _zone_reasoning(idx: int, inc_type: str, snap: dict) -> str:
    fire_high = float((snap.get("fire") or {}).get("danger_score", 0.4)) >= 0.65
    flood     = (snap.get("hydro") or {}).get("flood_severity", "none") not in ("none",)

    if idx == 0:
        return (
            f"Primary zone centred on trigger location; "
            f"{'high fire danger increases urgency' if fire_high else 'conditions consistent with reported ' + inc_type}."
        )
    if idx == 1:
        return (
            "Secondary zone along likely travel corridor; "
            + ("elevated water levels suggest proximity to river crossing." if flood
               else "terrain slope indicates possible direction of movement.")
        )
    return (
        "Extended search zone; covers alternative shelter locations "
        + ("and upstream water areas." if flood else "and approach trails.")
    )


def _build_positive_sample(snap: dict) -> Optional[dict]:
    inc_lat  = snap.get("incident_lat")
    inc_lon  = snap.get("incident_lon")
    inc_type = snap.get("incident_type", "unknown")
    if inc_lat is None or inc_lon is None:
        return None

    trigger_type = _TYPE_TO_TRIGGER.get(inc_type, "Emergency911")

    zones = []
    for i, (radius, (conf_lo, conf_hi)) in enumerate(zip(_RADII, _CONF_RANGES)):
        if i == 0:
            lat, lng = round(float(inc_lat), 6), round(float(inc_lon), 6)
        else:
            dist_m  = random.uniform(300, 500) if i == 1 else random.uniform(500, 800)
            bearing = _terrain_bearing(snap, i)
            lat, lng = _offset_coords(float(inc_lat), float(inc_lon), dist_m, bearing)

        zones.append({
            "lat":          lat,
            "lng":          lng,
            "radiusMeters": radius,
            "confidence":   round(random.uniform(conf_lo, conf_hi), 2),
            "reasoning":    _zone_reasoning(i, inc_type, snap),
        })

    # Sort by confidence descending (zone 1 should already be highest)
    zones.sort(key=lambda z: -z["confidence"])

    return {
        "messages": [
            {"role": "system",    "content": SYSTEM_PROMPT},
            {"role": "user",      "content": _build_user_content(snap, trigger_type)},
            {"role": "assistant", "content": json.dumps({"search_zones": zones}, separators=(",", ":"))},
        ]
    }


def _build_negative_sample(snap: dict) -> dict:
    """Low-risk snapshot → empty search zones (suppress false alarms)."""
    inc_type     = snap.get("incident_type", "unknown")
    trigger_type = _TYPE_TO_TRIGGER.get(inc_type, "Emergency911")
    # Use bbox centre as trigger location
    bbox = snap.get("bbox") or {}
    lat  = round((bbox.get("south", 37.7) + bbox.get("north", 37.8)) / 2, 6)
    lng  = round((bbox.get("west", -119.6) + bbox.get("east", -119.5)) / 2, 6)

    # Patch coordinates into snap so user content uses bbox centre
    patched = dict(snap)
    patched["incident_lat"] = lat
    patched["incident_lon"] = lng

    return {
        "messages": [
            {"role": "system",    "content": SYSTEM_PROMPT},
            {"role": "user",      "content": _build_user_content(patched, trigger_type)},
            {"role": "assistant", "content": json.dumps({"search_zones": []}, separators=(",", ":"))},
        ]
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Build search zone prediction training JSONL")
    parser.add_argument(
        "--snapshots",
        default="01_data/output/conditions_snapshots.jsonl",
        help="Path to conditions_snapshots.jsonl",
    )
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).parent / "output"),
        help="Output directory for train.jsonl and val.jsonl",
    )
    parser.add_argument("--val-split", type=float, default=0.20, help="Fraction for validation set")
    parser.add_argument("--seed",      type=int,   default=42)
    args = parser.parse_args()

    random.seed(args.seed)

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

    log.info("Loaded %d condition snapshots", len(snapshots))

    positive_samples = []
    negative_candidates = []

    for snap in snapshots:
        composite = _composite_score(snap)
        if snap.get("incident_lat") is not None and composite >= NEGATIVE_COMPOSITE_THRESHOLD:
            sample = _build_positive_sample(snap)
            if sample:
                positive_samples.append(sample)
        elif composite < NEGATIVE_COMPOSITE_THRESHOLD:
            negative_candidates.append(snap)

    # Subsample negatives
    n_negatives = max(len(positive_samples) // 4, 1)
    neg_snaps   = random.sample(negative_candidates, min(n_negatives, len(negative_candidates)))
    negative_samples = [_build_negative_sample(s) for s in neg_snaps]

    all_samples = positive_samples + negative_samples
    random.shuffle(all_samples)

    n_val  = max(1, int(len(all_samples) * args.val_split))
    n_train = len(all_samples) - n_val
    train_samples = all_samples[:n_train]
    val_samples   = all_samples[n_train:]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    def write_jsonl(path: Path, samples: list):
        with open(path, "w", encoding="utf-8") as f:
            for s in samples:
                f.write(json.dumps(s) + "\n")
        log.info("Wrote %d samples → %s", len(samples), path)

    write_jsonl(out_dir / "train.jsonl", train_samples)
    write_jsonl(out_dir / "val.jsonl",   val_samples)

    log.info(
        "Dataset: %d total  (%d positive, %d negative)  →  %d train / %d val",
        len(all_samples), len(positive_samples), len(negative_samples), n_train, n_val,
    )


if __name__ == "__main__":
    main()
