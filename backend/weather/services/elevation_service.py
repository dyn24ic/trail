"""
Elevation / terrain service for hotspot prediction.

Thin wrapper around `routing.services.terrain_service` (already used by Stage 2b).
Adds hotspot-specific helpers:
  - bbox-based DEM fetch (vs the point-to-point interface in routing)
  - per-point terrain risk score [0, 1] combining slope, elevation, and remoteness
  - candidate grid scoring across an 8×8 point lattice

Reused from routing/services/terrain_service.py:
    get_terrain_data(lat1, lon1, lat2, lon2)
    latlon_to_grid(lat, lon, transform)
    get_elevation_at(lat, lon, terrain_data)
    get_slope_at(lat, lon, terrain_data)
"""
import logging
import math
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# DEM fetch (bbox version)
# ---------------------------------------------------------------------------

def get_terrain_for_bbox(bbox: dict) -> Optional[dict]:
    """
    Fetch DEM data for the full bbox.  Delegates to routing.services.terrain_service
    which handles seamless-3dep tiles + synthetic fallback.

    Returns the terrain_data dict (elevation_grid, slope_grid, hazard_grid, transform, stats)
    or None if terrain fetch fails completely.
    """
    try:
        from routing.services.terrain_service import get_terrain_data
        return get_terrain_data(
            lat1=bbox["south"],
            lon1=bbox["west"],
            lat2=bbox["north"],
            lon2=bbox["east"],
        )
    except Exception as exc:
        logger.warning("Terrain fetch failed for bbox %s: %s", bbox, exc)
        return None


# ---------------------------------------------------------------------------
# Per-point terrain risk score
# ---------------------------------------------------------------------------

def terrain_risk_at_point(lat: float, lon: float, terrain_data: dict) -> float:
    """
    Composite terrain risk score [0, 1] for a lat/lon coordinate.

    Components:
      - slope_score      (0.45 weight): steeper = more dangerous
      - elev_score       (0.35 weight): higher = more exposed / harder to rescue
      - remoteness_score (0.20 weight): farther from bbox centre = slower rescue access
    """
    try:
        from routing.services.terrain_service import (
            latlon_to_grid,
            get_elevation_at,
            get_slope_at,
        )
    except ImportError:
        logger.warning("routing.services.terrain_service not importable — terrain risk defaulting to 0.5")
        return 0.5

    transform = terrain_data.get("transform", {})
    if not transform:
        return 0.5

    try:
        # Slope: degrees → [0, 1], saturates at 60°
        slope_deg = get_slope_at(lat, lon, terrain_data)
        slope_score = min(1.0, slope_deg / 60.0)

        # Elevation: percentile within the bbox range
        elev_m = get_elevation_at(lat, lon, terrain_data)
        stats = terrain_data.get("stats", {})
        elev_min = stats.get("min_elevation", 600.0)
        elev_max = stats.get("max_elevation", 4000.0)
        elev_range = max(1.0, elev_max - elev_min)
        elev_score = (elev_m - elev_min) / elev_range

        # Remoteness: normalised distance from bbox centre
        cx = (transform["west"] + transform["east"]) / 2
        cy = (transform["south"] + transform["north"]) / 2
        max_dist = math.sqrt(
            ((transform["north"] - transform["south"]) / 2) ** 2
            + ((transform["east"] - transform["west"]) / 2) ** 2
        )
        dist = math.sqrt((lat - cy) ** 2 + (lon - cx) ** 2)
        remoteness_score = min(1.0, dist / max(max_dist, 1e-6))

        score = slope_score * 0.45 + elev_score * 0.35 + remoteness_score * 0.20
        return round(float(np.clip(score, 0.0, 1.0)), 3)

    except Exception as exc:
        logger.debug("terrain_risk_at_point failed for (%s, %s): %s", lat, lon, exc)
        return 0.5


# ---------------------------------------------------------------------------
# Candidate grid
# ---------------------------------------------------------------------------

def seed_candidate_points(bbox: dict, grid_size: int = 8) -> list[dict]:
    """
    Generate grid_size × grid_size evenly-spaced candidate points inside the bbox.
    Points are centred in each cell (offset by 0.5 cell width from edges).

    Returns a list of {"lat": float, "lon": float, "row": int, "col": int}.
    """
    points = []
    for row in range(grid_size):
        for col in range(grid_size):
            lat = bbox["south"] + ((row + 0.5) / grid_size) * (bbox["north"] - bbox["south"])
            lon = bbox["west"]  + ((col + 0.5) / grid_size) * (bbox["east"]  - bbox["west"])
            points.append({"lat": lat, "lon": lon, "row": row, "col": col})
    return points


def score_candidates(
    candidates: list[dict],
    terrain_data: Optional[dict],
    fire: Optional[dict],
    weather: Optional[dict],
    hydro: Optional[dict],
    road_incidents: Optional[dict],
) -> list[dict]:
    """
    Pre-score every candidate point across five risk dimensions.
    All scores are [0, 1]. Composite uses fixed weights.

    Returns candidates sorted by composite_score descending, each augmented with
    { fire_score, weather_score, terrain_score, water_score, access_score, composite_score }.
    """
    # ---- Scalar inputs (same for all points within bbox) ----
    fire_score   = _fire_score(fire)
    weather_risk = weather.get("weather_risk_score", 0.15) if weather else 0.15
    water_score  = _water_score(hydro)
    access_score = _access_score(road_incidents)

    scored = []
    for pt in candidates:
        terrain_score = terrain_risk_at_point(pt["lat"], pt["lon"], terrain_data) if terrain_data else 0.5

        composite = (
            fire_score    * 0.25
            + weather_risk * 0.30
            + terrain_score * 0.25
            + water_score   * 0.10
            + access_score  * 0.10
        )
        scored.append({
            **pt,
            "fire_score":    round(fire_score, 3),
            "weather_score": round(weather_risk, 3),
            "terrain_score": round(terrain_score, 3),
            "water_score":   round(water_score, 3),
            "access_score":  round(access_score, 3),
            "composite_score": round(float(np.clip(composite, 0.0, 1.0)), 3),
        })

    scored.sort(key=lambda p: p["composite_score"], reverse=True)
    return scored


# ---------------------------------------------------------------------------
# Factor helpers
# ---------------------------------------------------------------------------

def _fire_score(fire: Optional[dict]) -> float:
    if not fire:
        return 0.4
    danger = fire.get("danger_score", 0.4)
    dispatch = fire.get("dispatch_score", 0.0)
    campfire_bonus = 0.05 if fire.get("no_campfire_active") else 0.0
    return float(np.clip(danger + dispatch * 0.3 + campfire_bonus, 0.0, 1.0))


def _water_score(hydro: Optional[dict]) -> float:
    if not hydro:
        return 0.2
    severity = hydro.get("flood_severity", "none")
    return {"none": 0.15, "minor": 0.55, "moderate": 0.80, "major": 1.0}.get(severity, 0.2)


def _access_score(road_incidents: Optional[dict]) -> float:
    if not road_incidents:
        return 0.2
    count = road_incidents.get("count", 0)
    closure_bonus = 0.3 if road_incidents.get("has_closure") else 0.0
    return float(np.clip(count / 5.0 + closure_bonus, 0.0, 1.0))
