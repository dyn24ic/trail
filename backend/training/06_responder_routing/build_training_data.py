"""
Build chat-format JSONL training data for Nemotron 70B responder route optimization.

Reads conditions_snapshots.jsonl (produced by build_conditions_snapshot.py) and converts
each incident into a training sample where:
  - User message: trailhead coords, victim coords, triage assessment, weather conditions
  - Assistant message: detailed step-by-step responder route with hazards, ETAs, and notes

Triage synthesis (per incident_type):
  fall / rockfall   → Moderate/Severe, fracture or head trauma
  drowning          → Severe, hypothermia (always helicopter if possible)
  medical           → Moderate/Severe, cardiac or altitude sickness
  vehicle           → Moderate, laceration / fracture
  search_rescue     → Minor/Moderate, dehydration / exhaustion
  lightning         → Severe, cardiac event
  fire_related      → Moderate/Severe, burns / smoke inhalation
  unknown           → random Minor/Moderate/Severe

Trailhead pool: 8 real Yosemite trailheads used as origin points, assigned by proximity
to incident location.

Route step synthesis:
  - 3–5 steps built from distance, access type, weather, and terrain
  - Hazards drawn from a terrain-contextual pool (not random from a fixed list)
  - ETAs consistent with access type (helicopter ~150 km/h, ground ~4 km/h)

Usage:
    python 06_responder_routing/build_training_data.py \
        --snapshots 01_data/output/conditions_snapshots.jsonl \
        --out-dir   06_responder_routing/output
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

# Real Yosemite trailheads (name, lat, lng)
YOSEMITE_TRAILHEADS = [
    ("Yosemite Valley Trailhead",      37.7459, -119.5332),
    ("Half Dome Trailhead (Happy Isles)", 37.7329, -119.5578),
    ("Glacier Point Road Trailhead",   37.7272, -119.5738),
    ("Tuolumne Meadows Trailhead",     37.8739, -119.3637),
    ("Hetch Hetchy Trailhead",         37.9517, -119.7949),
    ("Tioga Pass Entrance Trailhead",  37.9098, -119.2561),
    ("Wawona Trailhead",               37.5358, -119.6523),
    ("El Capitan Meadow Trailhead",    37.7375, -119.6381),
]

# Injury profiles per incident type
_INJURY_PROFILES = {
    "fall": [
        ("Fractured limb", ["Minor", "Moderate", "Severe"], [0.20, 0.50, 0.30]),
        ("Head trauma",    ["Moderate", "Severe"],           [0.40, 0.60]),
        ("Sprained ankle", ["Minor"],                        [1.00]),
    ],
    "rockfall": [
        ("Head trauma",    ["Moderate", "Severe"],           [0.35, 0.65]),
        ("Fractured limb", ["Moderate", "Severe"],           [0.50, 0.50]),
    ],
    "drowning": [
        ("Hypothermia",    ["Severe"],                       [1.00]),
    ],
    "medical": [
        ("Cardiac event",    ["Severe"],                     [0.60]),
        ("Altitude sickness",["Moderate", "Severe"],         [0.60, 0.40]),
        ("Dehydration / heat exhaustion", ["Minor", "Moderate"], [0.50, 0.50]),
    ],
    "vehicle": [
        ("Laceration",      ["Minor", "Moderate"],           [0.40, 0.60]),
        ("Fractured limb",  ["Moderate"],                    [1.00]),
    ],
    "search_rescue": [
        ("Dehydration / heat exhaustion", ["Minor", "Moderate"], [0.60, 0.40]),
        ("Hypothermia",     ["Minor", "Moderate"],           [0.50, 0.50]),
    ],
    "lightning": [
        ("Cardiac event",   ["Severe"],                      [1.00]),
    ],
    "fire_related": [
        ("Burns",           ["Moderate", "Severe"],          [0.50, 0.50]),
        ("Smoke inhalation",["Moderate"],                    [1.00]),
    ],
    "unknown": [
        ("Unknown injury",  ["Minor", "Moderate", "Severe"], [0.40, 0.40, 0.20]),
    ],
}

# Terrain hazard pool (contextual)
_HAZARDS = {
    "steep_terrain": ["Steep slope (>30°)", "Loose scree", "Exposed ridge with drop"],
    "water":         ["River crossing (elevated flow)", "Slippery riverbank", "Waterfall spray zone"],
    "weather_fire":  ["Active smoke reducing visibility", "Ember shower risk", "Spot fire ahead"],
    "weather_storm": ["Lightning exposure on open ridge", "Flash flood drainage channel"],
    "weather_wind":  ["High wind exposure (>60 km/h)", "Unstable tree limbs overhead"],
    "weather_fog":   ["Zero-visibility fog", "Disorient risk in dense fog"],
    "night":         ["Limited lighting — headlamp required", "Night navigation on unmarked terrain"],
    "general":       ["Loose rock", "Dense vegetation slowing progress", "Uneven trail surface"],
}

URGENCY_MINUTES = {"Minor": 90, "Moderate": 45, "Severe": 15}
SPEED_KMH = {"helicopter": 150.0, "ground": 4.2, "boat": 25.0}


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _nearest_trailhead(lat: float, lng: float) -> tuple:
    return min(YOSEMITE_TRAILHEADS, key=lambda t: _haversine_km(lat, lng, t[1], t[2]))


# ---------------------------------------------------------------------------
# Triage synthesis
# ---------------------------------------------------------------------------

def _synthesize_triage(inc_type: str, rng: random.Random) -> dict:
    profiles = _INJURY_PROFILES.get(inc_type, _INJURY_PROFILES["unknown"])
    profile  = rng.choice(profiles)
    injury   = profile[0]
    sev_list, weights = profile[1], profile[2]
    severity = rng.choices(sev_list, weights=weights)[0]

    conscious = True
    if severity == "Severe":
        conscious = rng.random() > 0.35   # 65% conscious when severe

    resp_map = {
        "Minor":    "First aid on scene, walk-out capable",
        "Moderate": "Stretcher evacuation required, monitor vitals",
        "Severe":   "Immediate helicopter evacuation, paramedic response",
    }

    return {
        "severity":                     severity,
        "injuryType":                   injury,
        "consciousAndResponsive":       conscious,
        "recommendedResponse":          resp_map[severity],
        "estimatedMedicalUrgencyMinutes": URGENCY_MINUTES[severity],
    }


# ---------------------------------------------------------------------------
# Access type decision
# ---------------------------------------------------------------------------

def _access_type(severity: str, weather: dict, inc_type: str) -> str:
    if inc_type == "drowning":
        return "boat" if weather.get("weather_risk_score", 0) < 0.5 else "ground"
    if severity == "Severe":
        # Helicopter unless weather precludes it
        storm   = (weather.get("conditions") or {}).get("storm", False)
        wind_hi = float(weather.get("windspeed_kmh", 0)) > 70
        fog     = (weather.get("conditions") or {}).get("fog", False)
        if storm or wind_hi or fog:
            return "ground"
        return "helicopter"
    return "ground"


# ---------------------------------------------------------------------------
# Hazard selection (contextual)
# ---------------------------------------------------------------------------

def _select_hazards(weather: dict, terrain_slope: float, hour: int, rng: random.Random) -> list[str]:
    pool: list[str] = list(_HAZARDS["general"])
    if terrain_slope > 25:
        pool.extend(_HAZARDS["steep_terrain"])
    if float(weather.get("windspeed_kmh", 0)) > 50:
        pool.extend(_HAZARDS["weather_wind"])
    if (weather.get("conditions") or {}).get("storm"):
        pool.extend(_HAZARDS["weather_storm"])
    if (weather.get("conditions") or {}).get("fog"):
        pool.extend(_HAZARDS["weather_fog"])
    if hour < 6 or hour > 20:
        pool.extend(_HAZARDS["night"])
    return rng.sample(pool, min(2, len(pool)))


# ---------------------------------------------------------------------------
# Route step builder
# ---------------------------------------------------------------------------

_STEP_TEMPLATES = [
    "Depart {trailhead} staging area and join {trail_adj} trail",
    "Traverse {terrain_adj} terrain toward victim GPS coordinates",
    "Cross {water_feature} and ascend {slope_adj} approach",
    "Final approach — confirm GPS coordinates and establish communication with victim",
    "Stabilise patient, apply field treatment, prepare for evacuation",
]

_TRAIL_ADJS   = ["main access", "switchback", "service", "fire road", "backcountry"]
_TERRAIN_ADJS = ["open meadow", "rocky ridge", "forested valley", "talus field", "granite slab"]
_WATER_FEATS  = ["creek ford", "footbridge", "seasonal stream crossing", "Merced River ford"]
_SLOPE_ADJS   = ["gradual", "moderate", "steep", "exposed ridge"]


def _build_route_steps(
    trailhead_name: str,
    dist_km: float,
    eta_min: int,
    access_type: str,
    weather: dict,
    terrain_slope: float,
    hour: int,
    rng: random.Random,
) -> list[dict]:
    dist_m = dist_km * 1000

    if access_type == "helicopter":
        return [
            {
                "stepNumber":       1,
                "description":      f"Helicopter lifts off from {trailhead_name}",
                "distanceMeters":   round(dist_m * 0.10, 1),
                "estimatedMinutes": max(2, int(eta_min * 0.05)),
                "hazards":          ["Ensure LZ clear of personnel and debris"],
            },
            {
                "stepNumber":       2,
                "description":      "Aerial approach to victim coordinates — identify safe landing zone",
                "distanceMeters":   round(dist_m * 0.80, 1),
                "estimatedMinutes": max(3, int(eta_min * 0.60)),
                "hazards":          _select_hazards(weather, terrain_slope, hour, rng)[:1] + ["Identify flat LZ ≥15 m diameter"],
            },
            {
                "stepNumber":       3,
                "description":      "Land, paramedic deploys, initiate advanced life support",
                "distanceMeters":   round(dist_m * 0.05, 1),
                "estimatedMinutes": max(5, int(eta_min * 0.20)),
                "hazards":          [],
            },
            {
                "stepNumber":       4,
                "description":      "Secure patient for helicopter transport to medical facility",
                "distanceMeters":   round(dist_m * 0.05, 1),
                "estimatedMinutes": max(5, int(eta_min * 0.15)),
                "hazards":          [],
            },
        ]

    # Ground route: 4–5 steps
    n_steps = 4 if dist_km < 3 else 5
    dist_fracs = [0.10, 0.30, 0.35, 0.15] if n_steps == 4 else [0.08, 0.22, 0.30, 0.25, 0.15]
    eta_fracs  = [0.08, 0.30, 0.40, 0.22] if n_steps == 4 else [0.06, 0.22, 0.32, 0.25, 0.15]

    steps = []
    for i in range(n_steps):
        if i == 0:
            desc = f"Depart {trailhead_name} and join {rng.choice(_TRAIL_ADJS)} trail"
        elif i == n_steps - 1:
            desc = "Stabilise patient, apply field treatment, prepare for evacuation"
        elif i == n_steps - 2:
            desc = "Final approach — confirm GPS, establish communication with victim"
        else:
            desc = (
                f"Traverse {rng.choice(_TERRAIN_ADJS)} terrain"
                + (f", {rng.choice(_WATER_FEATS)}" if float(
                    (weather.get('hydro') or {}).get('max_flow_cfs', 0) or 0
                ) > 200 or rng.random() < 0.3 else "")
                + (f", ascend {rng.choice(_SLOPE_ADJS)} slope" if terrain_slope > 15 and rng.random() < 0.6 else "")
            )

        hazards = _select_hazards(weather, terrain_slope, hour, rng) if i < n_steps - 1 else []

        steps.append({
            "stepNumber":       i + 1,
            "description":      desc,
            "distanceMeters":   round(dist_m * dist_fracs[i], 1),
            "estimatedMinutes": max(1, int(eta_min * eta_fracs[i])),
            "hazards":          hazards,
        })

    return steps


# ---------------------------------------------------------------------------
# Sample builders
# ---------------------------------------------------------------------------

def _build_sample(snap: dict, rng: random.Random) -> Optional[dict]:
    inc_lat  = snap.get("incident_lat")
    inc_lon  = snap.get("incident_lon")
    inc_type = snap.get("incident_type", "unknown")
    if inc_lat is None or inc_lon is None:
        return None

    th_name, th_lat, th_lng = _nearest_trailhead(float(inc_lat), float(inc_lon))
    dist_km = _haversine_km(th_lat, th_lng, float(inc_lat), float(inc_lon))

    weather = snap.get("weather") or {}
    terrain = snap.get("terrain") or {}
    hour    = int(snap.get("hour_local", 14))
    month   = int(snap.get("month", 7))

    triage      = _synthesize_triage(inc_type, rng)
    access_type = _access_type(triage["severity"], weather, inc_type)
    speed_kmh   = SPEED_KMH[access_type]
    eta_min     = max(5, int(dist_km / speed_kmh * 60) + rng.randint(2, 15))

    terrain_slope = float(terrain.get("slope_deg", 15))
    steps = _build_route_steps(
        th_name, dist_km, eta_min, access_type, weather, terrain_slope, hour, rng,
    )

    access_label = {
        "helicopter": "Helicopter evacuation",
        "ground":     "Ground team with stretcher",
        "boat":       "Swift-water rescue boat",
    }[access_type]

    storm   = (weather.get("conditions") or {}).get("storm", False)
    weather_note = (" Storm warning in effect — monitor conditions." if storm else "")
    notes = (
        f"{access_label} recommended. "
        f"Straight-line distance: {dist_km:.1f} km from {th_name}. "
        f"ETA: {eta_min} min. "
        f"Urgency: {triage['estimatedMedicalUrgencyMinutes']} min ({triage['severity']}).{weather_note}"
    )

    assistant_payload = {
        "steps":                steps,
        "totalDistanceMeters":  round(dist_km * 1000, 1),
        "totalEtaMinutes":      eta_min,
        "accessType":           access_type,
        "notes":                notes,
    }

    user_payload = {
        "trailhead_name":  th_name,
        "trailhead_lat":   round(th_lat, 6),
        "trailhead_lng":   round(th_lng, 6),
        "victim_lat":      round(float(inc_lat), 6),
        "victim_lng":      round(float(inc_lon), 6),
        "distance_km":     round(dist_km, 3),
        "month":           month,
        "hour_local":      hour,
        "triage": triage,
        "weather": {
            "temperature_c":      weather.get("temperature_c", 15),
            "windspeed_kmh":      weather.get("windspeed_kmh", 10),
            "weather_risk_score": weather.get("weather_risk_score", 0.15),
            "conditions":         weather.get("conditions", {}),
        },
        "terrain": {
            "slope_deg":    terrain.get("slope_deg", 15),
            "elevation_m":  terrain.get("elevation_m", 1800),
        },
    }

    return {
        "messages": [
            {"role": "system",    "content": SYSTEM_PROMPT},
            {"role": "user",      "content": json.dumps(user_payload, separators=(",", ":"))},
            {"role": "assistant", "content": json.dumps(assistant_payload, separators=(",", ":"))},
        ]
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Build responder route training JSONL")
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
    parser.add_argument("--val-split", type=float, default=0.20)
    parser.add_argument("--seed",      type=int,   default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)

    snap_path = Path(args.snapshots)
    if not snap_path.exists():
        log.error("Snapshots file not found: %s", snap_path)
        return

    snapshots = []
    with open(snap_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                snapshots.append(json.loads(line))

    log.info("Loaded %d condition snapshots", len(snapshots))

    samples = [s for snap in snapshots if (s := _build_sample(snap, rng)) is not None]
    rng.shuffle(samples)

    n_val   = max(1, int(len(samples) * args.val_split))
    n_train = len(samples) - n_val

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    def write_jsonl(path: Path, items: list):
        with open(path, "w", encoding="utf-8") as f:
            for s in items:
                f.write(json.dumps(s) + "\n")
        log.info("Wrote %d samples → %s", len(items), path)

    write_jsonl(out_dir / "train.jsonl", samples[:n_train])
    write_jsonl(out_dir / "val.jsonl",   samples[n_train:])

    log.info("Dataset: %d total → %d train / %d val", len(samples), n_train, n_val)


if __name__ == "__main__":
    main()
