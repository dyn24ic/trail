"""
Hotspot prediction service — main orchestrator.

Fuses NPS ArcGIS data, Open-Meteo HRRR weather, and terrain/DEM data, then
calls GPT to produce ranked accident hotspot zones for the next 24 hours.

Model:
    Currently: gpt-4o
    TODO: Upgrade to gpt-5.2 when available via the OpenAI API.
    Long-term: Replace with NVIDIA Nemotron after fine-tuning on Yosemite SAR incident data.

Public API:
    predict_hotspots(bbox: dict) -> dict   (HotspotPredictionResponse)

Output format: see WEATHER.md § Output Format
"""
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

from django.conf import settings

from .arcgis_service import (
    get_fire_conditions,
    get_hydro_conditions,
    get_road_incidents,
    get_smoke_aqi,
)
from .elevation_service import (
    get_terrain_for_bbox,
    score_candidates,
    seed_candidate_points,
)
from .openmeteo_service import get_weather, weather_summary_string

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# AI model configuration
# ---------------------------------------------------------------------------
# TODO: Update to "gpt-5.2" once that model is available in the OpenAI API.
# Long-term plan: swap endpoint to NVIDIA Nemotron after fine-tuning on YOSE SAR data.
AI_MODEL = "gpt-4o"
MODEL_VERSION = f"trAIl-weather-v1.0+{AI_MODEL}"

# Number of candidate points to evaluate across the bbox (grid_size² total)
CANDIDATE_GRID_SIZE = 8
# Top-N candidates (by composite score) sent to the GPT prompt
TOP_CANDIDATES_FOR_GPT = 20
# Maximum hotspots returned by GPT
MAX_HOTSPOTS = 10

# ---------------------------------------------------------------------------
# Yosemite-specific context (injected into GPT system prompt)
# ---------------------------------------------------------------------------
YOSEMITE_CONTEXT = """
Yosemite National Park, CA (bbox: 37.70–37.82°N, 119.47–119.62°W).
Elevation range: ~1200 m (valley floor) to ~2700 m (high country).

Known high-risk landmarks:
- Half Dome cable route (37.7456°N, 119.5330°W) — fall risk, lightning exposure, crowding
- Mist Trail / Nevada Falls approach (37.7320°N, 119.5455°W) — slippery granite, high water
- El Capitan base (37.7340°N, 119.6375°W) — rockfall zone
- Yosemite Falls upper (37.7530°N, 119.5955°W) — exposed ridgeline, water crossing
- Clouds Rest ridge (37.7609°N, 119.4887°W) — lightning-exposed, steep descent
- Tuolumne Meadows (37.8769°N, 119.3591°W) — snow late/early season, altitude

Risk level thresholds:
  riskScore < 0.35  → low
  riskScore 0.35–0.55 → moderate
  riskScore 0.55–0.75 → high
  riskScore > 0.75  → extreme
"""

# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def predict_hotspots(bbox: dict) -> dict:
    """
    Run the full hotspot prediction pipeline for a bounding box.

    Args:
        bbox: { "south": float, "north": float, "west": float, "east": float }

    Returns:
        HotspotPredictionResponse dict (see WEATHER.md § Output Format)
    """
    logger.info("Starting hotspot prediction for bbox: %s", bbox)

    # ── Phase 1: Parallel data fetch ──────────────────────────────────────
    raw = _fetch_all_data(bbox)

    # ── Phase 2: Terrain data (sequential — DEM fetch is already cached) ──
    logger.info("Fetching terrain data...")
    terrain = get_terrain_for_bbox(bbox)
    if terrain is None:
        logger.warning("Terrain data unavailable — terrain scores will default to 0.5")

    # ── Phase 3: Candidate grid + numeric scoring ──────────────────────────
    logger.info("Seeding and scoring %d candidate points...", CANDIDATE_GRID_SIZE ** 2)
    candidates = seed_candidate_points(bbox, CANDIDATE_GRID_SIZE)
    scored = score_candidates(
        candidates,
        terrain_data=terrain,
        fire=raw["fire"],
        weather=raw["weather"],
        hydro=raw["hydro"],
        road_incidents=raw["roads"],
    )
    top_candidates = scored[:TOP_CANDIDATES_FOR_GPT]

    # ── Phase 4: GPT prediction ────────────────────────────────────────────
    logger.info("Calling %s for hotspot analysis...", AI_MODEL)
    hotspots = _run_gpt_prediction(bbox, raw, top_candidates)

    # ── Phase 5: Assemble response ─────────────────────────────────────────
    weather = raw["weather"] or {}
    fire = raw["fire"] or {}

    return {
        "hotspots": hotspots,
        "bbox": bbox,
        "generatedAt": datetime.now(tz=timezone.utc).isoformat(),
        "modelVersion": MODEL_VERSION,
        "conditions": {
            "fireDangerRating": fire.get("danger_rating", "UNKNOWN"),
            "weatherSummary": weather_summary_string(weather) if weather else "unavailable",
            "activeFires": 0,           # no active fire polygon layer in current spec
            "smokeAqi": raw["smoke_aqi"],
        },
    }


# ---------------------------------------------------------------------------
# Parallel data fetch
# ---------------------------------------------------------------------------

def _fetch_all_data(bbox: dict) -> dict:
    """
    Fetch all external data sources in parallel using a thread pool.
    Each source fails independently — partial results are acceptable.
    """
    center_lat = (bbox["south"] + bbox["north"]) / 2
    center_lon = (bbox["west"]  + bbox["east"])  / 2

    tasks = {
        "fire":      (get_fire_conditions, (bbox,)),
        "smoke_aqi": (get_smoke_aqi,       (bbox,)),
        "hydro":     (get_hydro_conditions,(bbox,)),
        "roads":     (get_road_incidents,  (bbox,)),
        "weather":   (get_weather,         (center_lat, center_lon)),
    }

    results = {k: None for k in tasks}

    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_key = {
            executor.submit(fn, *args): key
            for key, (fn, args) in tasks.items()
        }
        for future in as_completed(future_to_key):
            key = future_to_key[future]
            try:
                results[key] = future.result()
            except Exception as exc:
                logger.warning("Data fetch '%s' failed: %s", key, exc)

    return results


# ---------------------------------------------------------------------------
# GPT prediction
# ---------------------------------------------------------------------------

def _run_gpt_prediction(bbox: dict, raw: dict, top_candidates: list) -> list:
    """
    Send pre-scored candidates and current conditions to GPT.
    Falls back to a rules-based hotspot list if OpenAI is unavailable.

    Uses response_format={"type": "json_object"} — same pattern as
    routing/services/llm_service.py for consistency across the backend.
    """
    api_key = getattr(settings, "OPENAI_API_KEY", "")
    if not api_key or api_key in ("sk-placeholder", ""):
        logger.warning("No OpenAI key — using fallback hotspot analysis")
        return _fallback_hotspots(top_candidates)

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)

        system_prompt = _build_system_prompt()
        user_prompt   = _build_user_prompt(bbox, raw, top_candidates)

        response = client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,   # low temperature for deterministic safety predictions
            max_tokens=4096,
        )

        content = response.choices[0].message.content
        parsed = json.loads(content)
        hotspots = parsed.get("hotspots", [])

        # Validate and clamp all numeric fields
        return [_validate_hotspot(h, i) for i, h in enumerate(hotspots[:MAX_HOTSPOTS])]

    except Exception as exc:
        logger.warning("OpenAI call failed: %s — using fallback hotspots", exc)
        return _fallback_hotspots(top_candidates)


def _build_system_prompt() -> str:
    return f"""You are the trAIl (Trail Guardian) hotspot prediction AI.

Your task: Analyse multi-source environmental data and identify the geographic zones most
likely to produce hiker accidents in the next 24 hours.

{YOSEMITE_CONTEXT}

Guidelines:
- Prioritise compound risk: overlapping fire + weather + terrain factors are more dangerous
  than any single high score in isolation.
- Adjust lat/lon slightly from the provided grid points to align with named trail features.
- Provide specific, actionable recommendations for SAR teams and trail rangers.
- Output exactly one JSON object with a single key "hotspots" containing an array.

Output schema for each hotspot:
{{
  "id": "HOTSPOT-001",          // sequential, zero-padded
  "lat": 37.7421,               // WGS84 decimal degrees
  "lon": -119.5320,
  "radiusMeters": 500,          // 50–2000 depending on zone size
  "riskScore": 0.82,            // 0.0 (safe) to 1.0 (extreme danger)
  "riskLevel": "high",          // "low" | "moderate" | "high" | "extreme"
  "factors": {{
    "fire": 0.70,
    "weather": 0.55,
    "terrain": 0.90,
    "water": 0.30,
    "accessibility": 0.45
  }},
  "description": "...",         // 1–2 sentence risk explanation
  "recommendations": ["..."]    // 2–4 actionable items for rangers / SAR
}}"""


def _build_user_prompt(bbox: dict, raw: dict, top_candidates: list) -> str:
    weather = raw.get("weather") or {}
    fire    = raw.get("fire")    or {}
    hydro   = raw.get("hydro")   or {}
    roads   = raw.get("roads")   or {}

    # Compact candidate table (top 20 by composite score)
    table_rows = []
    for c in top_candidates:
        table_rows.append(
            f"  ({c['lat']:.4f}, {c['lon']:.4f}) | "
            f"composite={c['composite_score']:.2f} | "
            f"fire={c['fire_score']:.2f} "
            f"weather={c['weather_score']:.2f} "
            f"terrain={c['terrain_score']:.2f} "
            f"water={c['water_score']:.2f} "
            f"access={c['access_score']:.2f}"
        )
    candidate_table = "\n".join(table_rows) or "  No candidates available"

    return f"""## Current Conditions — {datetime.now(tz=timezone.utc).strftime('%Y-%m-%dT%H:%MZ')}

### Weather (Open-Meteo GFS/HRRR)
{weather_summary_string(weather) if weather else "UNAVAILABLE — assume moderate weather risk"}
Conditions: {weather.get('conditions', {})}

### Fire Conditions (NPS ArcGIS)
Danger Rating: {fire.get('danger_rating', 'UNKNOWN')}
Dispatch Level: {fire.get('dispatch_level', 'UNKNOWN')}
No-campfire zone active: {fire.get('no_campfire_active', 'unknown')}

### Hydrology (Stream Gages)
Flood alert: {hydro.get('flood_alert', 'unknown')}
Severity: {hydro.get('flood_severity', 'unknown')}
Max flow: {hydro.get('max_flow_cfs', 'N/A')} CFS

### Air Quality
Smoke AQI (24h): {raw.get('smoke_aqi', 'UNAVAILABLE')}

### Road Incidents
Active incidents: {roads.get('count', 0)}  |  Has closure: {roads.get('has_closure', False)}
Types: {', '.join(roads.get('types', [])) or 'none'}

## Candidate Hotspot Points — pre-scored, sorted by composite risk
Format: (lat, lon) | composite | fire weather terrain water access
{candidate_table}

## Task
Identify the top accident hotspots (up to {MAX_HOTSPOTS}).
Return a single JSON object: {{ "hotspots": [...] }}
Select the most dangerous candidates and refine coordinates to align with real trail features.
Apply the risk thresholds: low<0.35, moderate 0.35–0.55, high 0.55–0.75, extreme>0.75."""


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_hotspot(h: dict, idx: int) -> dict:
    """Ensure all required fields are present and numeric values are clamped."""
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

    return {
        "id":           h.get("id", f"HOTSPOT-{idx+1:03d}"),
        "lat":          float(h.get("lat", 37.76)),
        "lon":          float(h.get("lon", -119.54)),
        "radiusMeters": max(50, min(2000, int(h.get("radiusMeters", 400)))),
        "riskScore":    risk_score,
        "riskLevel":    risk_level,
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
    if score >= 0.75:
        return "extreme"
    if score >= 0.55:
        return "high"
    if score >= 0.35:
        return "moderate"
    return "low"


# ---------------------------------------------------------------------------
# Rules-based fallback (no GPT)
# ---------------------------------------------------------------------------

def _fallback_hotspots(top_candidates: list) -> list:
    """
    Generate simple hotspot objects from the top pre-scored candidates when
    GPT is unavailable.  Produces up to 5 hotspots from the highest-scoring grid points.
    """
    hotspots = []
    for i, c in enumerate(top_candidates[:5]):
        score = c["composite_score"]
        level = _score_to_level(score)
        hotspots.append({
            "id":           f"HOTSPOT-{i+1:03d}",
            "lat":          round(c["lat"], 6),
            "lon":          round(c["lon"], 6),
            "radiusMeters": 400,
            "riskScore":    score,
            "riskLevel":    level,
            "factors": {
                "fire":          c["fire_score"],
                "weather":       c["weather_score"],
                "terrain":       c["terrain_score"],
                "water":         c["water_score"],
                "accessibility": c["access_score"],
            },
            "description": (
                f"Elevated composite risk zone ({level.upper()}, score {score:.2f}). "
                "Generated by rules-based fallback (GPT unavailable)."
            ),
            "recommendations": [
                "Increase patrol frequency in this zone",
                "Verify sensor coverage and alert thresholds",
            ],
        })
    return hotspots
