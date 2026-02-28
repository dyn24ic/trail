"""
Terrain Service – fetches DEM data via seamless-3dep and computes
slope/aspect/hazard grids used for routing.
"""
import math
import logging
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


def _bbox_from_coords(lat1: float, lon1: float, lat2: float, lon2: float, pad: float = 0.01):
    """Return (west, south, east, north) bounding box with padding."""
    west = min(lon1, lon2) - pad
    east = max(lon1, lon2) + pad
    south = min(lat1, lat2) - pad
    north = max(lat1, lat2) + pad
    return (west, south, east, north)


def get_terrain_data(lat1: float, lon1: float, lat2: float, lon2: float) -> dict:
    """
    Fetch DEM for the corridor between two coordinates.
    Returns a dict with:
      - elevation_grid: 2-D numpy array (row=lat desc, col=lon asc)
      - slope_grid:     degrees 0-90
      - aspect_grid:    degrees 0-360
      - hazard_grid:    0-1 normalised danger score
      - transform:      (west, south, east, north, rows, cols)
      - stats:          summary statistics
    """
    bbox = _bbox_from_coords(lat1, lon1, lat2, lon2, pad=0.02)

    try:
        import seamless_3dep as s3dep

        with tempfile.TemporaryDirectory() as tmpdir:
            tiff_files = s3dep.get_dem(bbox, tmpdir)
            if not tiff_files:
                raise RuntimeError("No DEM tiles returned for bbox")
            dem_da = s3dep.tiffs_to_da(tiff_files, bbox, crs=4326)
            elevation = np.array(dem_da.values, dtype=float)
            if elevation.ndim == 3:
                elevation = elevation[0]
            elevation = np.where(np.isnan(elevation), 0, elevation)

    except Exception as exc:
        logger.warning("seamless-3dep unavailable (%s) – using synthetic DEM", exc)
        elevation = _synthetic_dem(bbox)

    slope, aspect = _compute_slope_aspect(elevation, bbox)
    hazard = _compute_hazard(slope, elevation)

    rows, cols = elevation.shape
    return {
        "elevation_grid": elevation,
        "slope_grid": slope,
        "aspect_grid": aspect,
        "hazard_grid": hazard,
        "transform": {
            "west": bbox[0], "south": bbox[1],
            "east": bbox[2], "north": bbox[3],
            "rows": rows, "cols": cols,
        },
        "stats": {
            "min_elevation": float(np.nanmin(elevation)),
            "max_elevation": float(np.nanmax(elevation)),
            "mean_elevation": float(np.nanmean(elevation)),
            "max_slope_deg": float(np.nanmax(slope)),
            "mean_slope_deg": float(np.nanmean(slope)),
        },
    }


# ---------------------------------------------------------------------------
# Grid helpers
# ---------------------------------------------------------------------------

def _synthetic_dem(bbox: tuple) -> np.ndarray:
    """Generate a plausible synthetic DEM for demo/fallback purposes."""
    rows, cols = 100, 100
    west, south, east, north = bbox
    x = np.linspace(0, 4 * math.pi, cols)
    y = np.linspace(0, 4 * math.pi, rows)
    xx, yy = np.meshgrid(x, y)
    base_elevation = 1500.0
    elevation = (
        base_elevation
        + 300 * np.sin(xx * 0.5) * np.cos(yy * 0.5)
        + 150 * np.sin(xx * 1.2 + yy * 0.8)
        + 50 * np.random.default_rng(42).standard_normal((rows, cols))
    )
    return elevation.astype(float)


def _compute_slope_aspect(elevation: np.ndarray, bbox: tuple):
    """Compute slope (degrees) and aspect (degrees) from an elevation grid."""
    west, south, east, north = bbox
    rows, cols = elevation.shape
    if rows < 2 or cols < 2:
        return np.zeros_like(elevation), np.zeros_like(elevation)

    # Approximate cell size in metres
    lat_mid = (south + north) / 2
    dy = (north - south) / rows * 111_000
    dx = (east - west) / cols * 111_000 * math.cos(math.radians(lat_mid))
    cell_size = (dx + dy) / 2

    # Sobel-like gradient
    dz_dy, dz_dx = np.gradient(elevation, dy, dx)
    slope = np.degrees(np.arctan(np.sqrt(dz_dx ** 2 + dz_dy ** 2)))
    aspect = np.degrees(np.arctan2(-dz_dx, dz_dy)) % 360
    return slope.astype(float), aspect.astype(float)


def _compute_hazard(slope: np.ndarray, elevation: np.ndarray) -> np.ndarray:
    """
    Composite terrain hazard score [0, 1].
    Factors: steep slope (>30° critical), high elevation (>3500 m hypoxia risk),
    cliffs (>55°).
    """
    # Slope component: sigmoid-like, 0 at 0°, ~1 at 60°
    slope_hazard = np.clip(slope / 60.0, 0, 1)

    # Elevation component: risk increases above 2500 m
    elev_hazard = np.clip((elevation - 2500) / 1500, 0, 1)

    # Cliff flag: slopes > 55° are near-impassable for ground teams
    cliff_penalty = np.where(slope > 55, 1.0, 0.0)

    hazard = np.clip(0.6 * slope_hazard + 0.2 * elev_hazard + 0.2 * cliff_penalty, 0, 1)
    return hazard.astype(float)


def latlon_to_grid(lat: float, lon: float, transform: dict) -> tuple[int, int]:
    """Convert geographic coordinates to (row, col) grid indices."""
    west, south, east, north = (
        transform["west"], transform["south"],
        transform["east"], transform["north"],
    )
    rows, cols = transform["rows"], transform["cols"]
    col = int((lon - west) / (east - west) * cols)
    row = int((north - lat) / (north - south) * rows)
    col = max(0, min(cols - 1, col))
    row = max(0, min(rows - 1, row))
    return row, col


def grid_to_latlon(row: int, col: int, transform: dict) -> tuple[float, float]:
    """Convert (row, col) grid indices to (lat, lon)."""
    west, south, east, north = (
        transform["west"], transform["south"],
        transform["east"], transform["north"],
    )
    rows, cols = transform["rows"], transform["cols"]
    lon = west + (col + 0.5) / cols * (east - west)
    lat = north - (row + 0.5) / rows * (north - south)
    return lat, lon


def get_elevation_at(lat: float, lon: float, terrain_data: dict) -> float:
    row, col = latlon_to_grid(lat, lon, terrain_data["transform"])
    return float(terrain_data["elevation_grid"][row, col])


def get_slope_at(lat: float, lon: float, terrain_data: dict) -> float:
    row, col = latlon_to_grid(lat, lon, terrain_data["transform"])
    return float(terrain_data["slope_grid"][row, col])


def identify_danger_zones(terrain_data: dict, threshold: float = 0.65) -> list[dict]:
    """
    Return a list of danger zone polygons (as bounding boxes) where
    hazard > threshold.
    """
    hazard = terrain_data["hazard_grid"]
    transform = terrain_data["transform"]
    zones = []

    # Simple connected-components scan: find rectangular clusters
    mask = hazard > threshold
    if not mask.any():
        return zones

    rows, cols = mask.shape
    visited = np.zeros_like(mask, dtype=bool)

    for r in range(rows):
        for c in range(cols):
            if mask[r, c] and not visited[r, c]:
                # BFS flood-fill for this danger cluster
                cluster_rows, cluster_cols = [r], [c]
                queue = [(r, c)]
                visited[r, c] = True
                while queue:
                    cr, cc = queue.pop()
                    for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                        nr, nc = cr + dr, cc + dc
                        if 0 <= nr < rows and 0 <= nc < cols and mask[nr, nc] and not visited[nr, nc]:
                            visited[nr, nc] = True
                            queue.append((nr, nc))
                            cluster_rows.append(nr)
                            cluster_cols.append(nc)

                if len(cluster_rows) < 3:  # skip tiny single-cell artifacts
                    continue

                min_r, max_r = min(cluster_rows), max(cluster_rows)
                min_c, max_c = min(cluster_cols), max(cluster_cols)

                sw_lat, sw_lon = grid_to_latlon(max_r, min_c, transform)
                ne_lat, ne_lon = grid_to_latlon(min_r, max_c, transform)

                center_r = (min_r + max_r) // 2
                center_c = (min_c + max_c) // 2
                center_lat, center_lon = grid_to_latlon(center_r, center_c, transform)

                avg_hazard = float(hazard[min_r:max_r+1, min_c:max_c+1].mean())
                avg_slope = float(terrain_data["slope_grid"][min_r:max_r+1, min_c:max_c+1].mean())

                zones.append({
                    "center": {"lat": center_lat, "lon": center_lon},
                    "bounds": {
                        "sw": {"lat": sw_lat, "lon": sw_lon},
                        "ne": {"lat": ne_lat, "lon": ne_lon},
                    },
                    "hazard_score": round(avg_hazard, 3),
                    "avg_slope_deg": round(avg_slope, 1),
                    "type": _classify_zone(avg_hazard, avg_slope),
                })

    # Return top-10 most dangerous zones sorted by score
    zones.sort(key=lambda z: z["hazard_score"], reverse=True)
    return zones[:10]


def _classify_zone(hazard: float, slope: float) -> str:
    if slope > 55:
        return "cliff"
    if slope > 35:
        return "steep_terrain"
    if hazard > 0.8:
        return "extreme_hazard"
    if hazard > 0.65:
        return "high_hazard"
    return "moderate_hazard"
