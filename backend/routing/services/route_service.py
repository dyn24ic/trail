"""
Route Service – A* pathfinding on a DEM terrain grid.

Supports:
  - Ground (foot/vehicle) routing with terrain + weather penalties
  - Helicopter routing (near-straight-line with weather ceiling checks)
  - Severity-based speed profiles
  - ETA calculation
  - Coloured elevation / danger encoding for frontend
"""
import math
import heapq
import logging
from typing import Optional

import numpy as np

from .terrain_service import (
    latlon_to_grid,
    grid_to_latlon,
    identify_danger_zones,
)

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Speed profiles
# ─────────────────────────────────────────────────────────────────────────────

# severity: 1 (minor) … 5 (critical/life-threatening)
# base speeds in km/h for ground and helicopter
SEVERITY_GROUND_SPEED = {
    1: 4.0,   # minor – cautious walk
    2: 5.5,
    3: 7.0,   # moderate injury
    4: 9.0,
    5: 12.0,  # critical – maximum safe speed
}
SEVERITY_HELI_SPEED = {
    1: 150,
    2: 175,
    3: 200,
    4: 220,
    5: 240,
}

HELICOPTER_SAFETY_THRESHOLD = 0.75  # above this combined score → heli recommended


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def calculate_route(
    responder_lat: float,
    responder_lon: float,
    victim_lat: float,
    victim_lon: float,
    terrain_data: dict,
    weather_data: dict,
    severity: int = 3,
    route_type: str = "ground",   # "ground" | "helicopter"
) -> dict:
    """
    Calculate the optimal route and return a rich result dict.
    """
    severity = max(1, min(5, severity))

    if route_type == "helicopter":
        return _helicopter_route(
            responder_lat, responder_lon,
            victim_lat, victim_lon,
            terrain_data, weather_data, severity,
        )
    return _ground_route(
        responder_lat, responder_lon,
        victim_lat, victim_lon,
        terrain_data, weather_data, severity,
    )


def compute_safety_score(terrain_data: dict, weather_data: dict, path_cells: list) -> float:
    """
    Compute a combined 0-1 safety score along a path.
    Higher = more dangerous.
    """
    if not path_cells:
        return 0.0

    hazard_grid = terrain_data["hazard_grid"]
    weather_hazard = weather_data["routing_factors"]["weather_hazard"]

    path_hazards = [float(hazard_grid[r, c]) for r, c in path_cells]
    terrain_hazard = float(np.mean(path_hazards))

    combined = 0.65 * terrain_hazard + 0.35 * weather_hazard
    return round(min(combined, 1.0), 3)


def recommend_helicopter(safety_score: float, weather_data: dict) -> dict:
    """Return whether helicopter is recommended and the reason."""
    heli_ok = weather_data["routing_factors"]["helicopter_flight_ok"]
    recommend = safety_score > HELICOPTER_SAFETY_THRESHOLD and heli_ok
    reasons = []
    if safety_score > HELICOPTER_SAFETY_THRESHOLD:
        reasons.append(f"terrain/weather danger score {safety_score:.2f} exceeds threshold {HELICOPTER_SAFETY_THRESHOLD}")
    if not heli_ok:
        reasons.append("helicopter flight conditions not met (wind/visibility/storm)")
    return {
        "recommended": recommend,
        "safety_score": safety_score,
        "threshold": HELICOPTER_SAFETY_THRESHOLD,
        "helicopter_flight_ok": heli_ok,
        "reasons": reasons,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Ground routing (A* on DEM grid)
# ─────────────────────────────────────────────────────────────────────────────

def _ground_route(
    r_lat, r_lon, v_lat, v_lon,
    terrain_data, weather_data, severity,
) -> dict:
    transform = terrain_data["transform"]
    hazard_grid = terrain_data["hazard_grid"]
    slope_grid = terrain_data["slope_grid"]
    elevation_grid = terrain_data["elevation_grid"]

    start = latlon_to_grid(r_lat, r_lon, transform)
    goal = latlon_to_grid(v_lat, v_lon, transform)

    path_cells = _astar(start, goal, hazard_grid, slope_grid, transform)

    if not path_cells:
        # Fallback: straight-line interpolation
        path_cells = _straight_line_cells(start, goal)

    waypoints = _cells_to_waypoints(path_cells, terrain_data)
    total_dist_m = _path_distance_m(waypoints)

    ground_speed_factor = weather_data["routing_factors"]["ground_speed_factor"]
    base_speed_kmh = SEVERITY_GROUND_SPEED[severity]
    effective_speed_kmh = base_speed_kmh * ground_speed_factor

    # Slope penalty on effective speed
    avg_slope = float(np.mean([slope_grid[r, c] for r, c in path_cells]))
    slope_speed_factor = max(0.3, 1 - avg_slope / 90)
    effective_speed_kmh *= slope_speed_factor

    eta_hours = (total_dist_m / 1000) / max(effective_speed_kmh, 0.5)
    eta_minutes = eta_hours * 60

    safety_score = compute_safety_score(terrain_data, weather_data, path_cells)
    heli_rec = recommend_helicopter(safety_score, weather_data)

    danger_zones = identify_danger_zones(terrain_data)

    return {
        "route_type": "ground",
        "severity": severity,
        "waypoints": waypoints,
        "total_distance_m": round(total_dist_m, 1),
        "eta_minutes": round(eta_minutes, 1),
        "effective_speed_kmh": round(effective_speed_kmh, 1),
        "elevation_profile": _elevation_profile(path_cells, elevation_grid, transform),
        "danger_zones": danger_zones,
        "safety_score": safety_score,
        "helicopter_recommendation": heli_rec,
        "route_colour": _route_colour(safety_score),
        "stats": {
            "avg_slope_deg": round(avg_slope, 1),
            "max_elevation_m": round(float(np.max([elevation_grid[r, c] for r, c in path_cells])), 1),
            "min_elevation_m": round(float(np.min([elevation_grid[r, c] for r, c in path_cells])), 1),
            "elevation_gain_m": round(_elevation_gain(path_cells, elevation_grid), 1),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Helicopter routing (great-circle + weather ceiling)
# ─────────────────────────────────────────────────────────────────────────────

def _helicopter_route(
    r_lat, r_lon, v_lat, v_lon,
    terrain_data, weather_data, severity,
) -> dict:
    transform = terrain_data["transform"]
    elevation_grid = terrain_data["elevation_grid"]

    # Helicopter flies mostly straight; sample the terrain beneath
    n_samples = 50
    lats = np.linspace(r_lat, v_lat, n_samples)
    lons = np.linspace(r_lon, v_lon, n_samples)

    path_cells = [latlon_to_grid(lat, lon, transform) for lat, lon in zip(lats, lons)]
    # Remove duplicates while preserving order
    seen = set()
    path_cells_unique = []
    for cell in path_cells:
        if cell not in seen:
            seen.add(cell)
            path_cells_unique.append(cell)

    waypoints = [
        {
            "lat": lat, "lon": lon,
            "elevation_m": float(elevation_grid[r, c]),
            "index": i,
        }
        for i, (lat, lon, (r, c)) in enumerate(zip(lats, lons, path_cells))
    ]

    total_dist_m = _haversine_m(r_lat, r_lon, v_lat, v_lon)

    heli_speed_factor = weather_data["routing_factors"]["helicopter_speed_factor"]
    base_speed_kmh = SEVERITY_HELI_SPEED[severity]
    effective_speed_kmh = base_speed_kmh * max(heli_speed_factor, 0.3)

    eta_hours = (total_dist_m / 1000) / max(effective_speed_kmh, 10)
    eta_minutes = eta_hours * 60

    safety_score = compute_safety_score(terrain_data, weather_data, path_cells_unique)
    heli_ok = weather_data["routing_factors"]["helicopter_flight_ok"]

    danger_zones = identify_danger_zones(terrain_data)

    return {
        "route_type": "helicopter",
        "severity": severity,
        "waypoints": waypoints,
        "total_distance_m": round(total_dist_m, 1),
        "eta_minutes": round(eta_minutes, 1),
        "effective_speed_kmh": round(effective_speed_kmh, 1),
        "elevation_profile": _elevation_profile(path_cells_unique, elevation_grid, transform),
        "danger_zones": danger_zones,
        "safety_score": safety_score,
        "helicopter_recommendation": {
            "recommended": True,
            "safety_score": safety_score,
            "threshold": HELICOPTER_SAFETY_THRESHOLD,
            "helicopter_flight_ok": heli_ok,
            "reasons": ["helicopter route explicitly requested"],
        },
        "route_colour": _route_colour(safety_score),
        "flight_conditions": {
            "ok": heli_ok,
            "wind_speed_ms": weather_data["wind_speed_ms"],
            "visibility_m": weather_data["visibility_m"],
            "storm": weather_data["conditions"]["storm"],
        },
        "stats": {
            "max_elevation_m": round(float(np.max([elevation_grid[r, c] for r, c in path_cells_unique])), 1),
            "min_elevation_m": round(float(np.min([elevation_grid[r, c] for r, c in path_cells_unique])), 1),
            "clearance_required_m": round(float(np.max([elevation_grid[r, c] for r, c in path_cells_unique])) + 60, 1),
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# A* implementation
# ─────────────────────────────────────────────────────────────────────────────

def _astar(
    start: tuple, goal: tuple,
    hazard_grid: np.ndarray,
    slope_grid: np.ndarray,
    transform: dict,
) -> list[tuple]:
    """
    A* on the DEM grid.
    Cost = distance_metres * (1 + slope_penalty + hazard_penalty).
    Returns list of (row, col) cells.
    """
    rows, cols = hazard_grid.shape

    # Grid cell dimensions (metres)
    west, south, east, north = (
        transform["west"], transform["south"],
        transform["east"], transform["north"],
    )
    lat_mid = (south + north) / 2
    dy = (north - south) / rows * 111_000
    dx = (east - west) / cols * 111_000 * math.cos(math.radians(lat_mid))

    def h(r, c):
        dr = abs(goal[0] - r) * dy
        dc = abs(goal[1] - c) * dx
        return math.sqrt(dr ** 2 + dc ** 2)

    def move_cost(r1, c1, r2, c2):
        diag = r1 != r2 and c1 != c2
        dist = math.sqrt(dx ** 2 + dy ** 2) if diag else (dy if r1 != r2 else dx)
        h_val = float(hazard_grid[r2, c2])
        s_val = float(slope_grid[r2, c2])
        # Near-impassable if slope > 55° for ground
        if s_val > 55:
            terrain_mult = 10.0
        else:
            terrain_mult = 1 + s_val / 30 + h_val * 3
        return dist * terrain_mult

    open_heap = []
    heapq.heappush(open_heap, (h(*start), 0.0, start))
    came_from = {}
    g_score = {start: 0.0}

    # Limit grid search to avoid O(n²) on very large grids
    max_nodes = rows * cols
    visited = 0

    while open_heap:
        _, g, current = heapq.heappop(open_heap)
        if current == goal:
            return _reconstruct(came_from, current)

        visited += 1
        if visited > max_nodes:
            break

        r, c = current
        for dr, dc in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
            nr, nc = r + dr, c + dc
            if not (0 <= nr < rows and 0 <= nc < cols):
                continue
            ng = g + move_cost(r, c, nr, nc)
            nbr = (nr, nc)
            if ng < g_score.get(nbr, float("inf")):
                g_score[nbr] = ng
                came_from[nbr] = current
                heapq.heappush(open_heap, (ng + h(nr, nc), ng, nbr))

    # A* exhausted without reaching goal – fall back
    if goal in came_from or goal == start:
        return _reconstruct(came_from, goal)
    return _straight_line_cells(start, goal)


def _reconstruct(came_from: dict, current: tuple) -> list[tuple]:
    path = [current]
    while current in came_from:
        current = came_from[current]
        path.append(current)
    path.reverse()
    return path


def _straight_line_cells(start: tuple, end: tuple) -> list[tuple]:
    """Bresenham line between two grid cells."""
    r0, c0 = start
    r1, c1 = end
    cells = []
    dr = abs(r1 - r0)
    dc = abs(c1 - c0)
    sr = 1 if r0 < r1 else -1
    sc = 1 if c0 < c1 else -1
    err = dr - dc
    while True:
        cells.append((r0, c0))
        if r0 == r1 and c0 == c1:
            break
        e2 = 2 * err
        if e2 > -dc:
            err -= dc
            r0 += sr
        if e2 < dr:
            err += dr
            c0 += sc
    return cells


# ─────────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────────

def _cells_to_waypoints(cells: list, terrain_data: dict) -> list[dict]:
    transform = terrain_data["transform"]
    elevation_grid = terrain_data["elevation_grid"]
    hazard_grid = terrain_data["hazard_grid"]
    slope_grid = terrain_data["slope_grid"]

    waypoints = []
    for i, (r, c) in enumerate(cells):
        lat, lon = grid_to_latlon(r, c, transform)
        waypoints.append({
            "lat": lat,
            "lon": lon,
            "elevation_m": round(float(elevation_grid[r, c]), 1),
            "slope_deg": round(float(slope_grid[r, c]), 1),
            "hazard": round(float(hazard_grid[r, c]), 3),
            "colour": _route_colour(float(hazard_grid[r, c])),
            "index": i,
        })
    return waypoints


def _elevation_profile(cells: list, elevation_grid: np.ndarray, transform: dict) -> list[dict]:
    """Downsample the path to ≤100 points for the elevation profile chart."""
    if not cells:
        return []
    step = max(1, len(cells) // 100)
    sampled = cells[::step]
    profile = []
    dist = 0.0
    prev_lat, prev_lon = None, None
    for r, c in sampled:
        lat, lon = grid_to_latlon(r, c, transform)
        if prev_lat is not None:
            dist += _haversine_m(prev_lat, prev_lon, lat, lon)
        profile.append({
            "distance_m": round(dist, 1),
            "elevation_m": round(float(elevation_grid[r, c]), 1),
            "lat": lat,
            "lon": lon,
        })
        prev_lat, prev_lon = lat, lon
    return profile


def _path_distance_m(waypoints: list) -> float:
    total = 0.0
    for i in range(1, len(waypoints)):
        total += _haversine_m(
            waypoints[i-1]["lat"], waypoints[i-1]["lon"],
            waypoints[i]["lat"], waypoints[i]["lon"],
        )
    return total


def _elevation_gain(cells: list, elevation_grid: np.ndarray) -> float:
    gain = 0.0
    for i in range(1, len(cells)):
        r0, c0 = cells[i-1]
        r1, c1 = cells[i]
        diff = float(elevation_grid[r1, c1]) - float(elevation_grid[r0, c0])
        if diff > 0:
            gain += diff
    return gain


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))


def _route_colour(hazard: float) -> str:
    """Map a hazard score [0,1] to a hex colour for frontend display."""
    if hazard < 0.25:
        return "#22c55e"   # green  – safe
    if hazard < 0.5:
        return "#eab308"   # yellow – caution
    if hazard < 0.75:
        return "#f97316"   # orange – danger
    return "#ef4444"       # red    – extreme
