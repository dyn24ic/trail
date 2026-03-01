"""
For each historical incident, reconstruct approximate environmental conditions
at the time and location of the incident.

Sources:
- Weather: Open-Meteo ERA5 reanalysis (free, hourly back to 1940)
  https://api.open-meteo.com/v1/era5
- Terrain: routing.services.terrain_service (DEM fetch, cached)
- Fire/Hydro: seasonal defaults (historical ArcGIS not available)

Input:  01_data/output/nps_incidents.csv       (from scrape_nps_incidents.py)
        01_data/output/wfigs_fires.csv         (from fetch_wfigs_fires.py)
        01_data/output/road_incidents.csv      (from fetch_road_incidents.py)
        01_data/deaths_by_location.json        (randsinjurylaw article data)
Output: 01_data/output/conditions_snapshots.jsonl
        — one JSON object per line, includes all condition fields needed by
          build_training_jsonl.py

Run (from backend/ root with Django configured):
    DJANGO_SETTINGS_MODULE=trail_backend.settings python 01_data/build_conditions_snapshot.py

Or standalone (skips terrain — uses synthetic values):
    python 01_data/build_conditions_snapshot.py --no-terrain
"""
import argparse
import csv
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

HERE = Path(__file__).parent
OUTPUT_DIR = HERE / "output"
INPUT_NPS    = OUTPUT_DIR / "nps_incidents.csv"
INPUT_WFIGS  = OUTPUT_DIR / "wfigs_fires.csv"
INPUT_ROADS  = OUTPUT_DIR / "road_incidents.csv"
INPUT_DEATHS = HERE / "deaths_by_location.json"
OUTPUT_FILE  = OUTPUT_DIR / "conditions_snapshots.jsonl"

ERA5_URL = "https://api.open-meteo.com/v1/era5"
TIMEOUT = 20

# Seasonal fire danger defaults (no historical ArcGIS available)
_FIRE_DEFAULTS = {
    1:  {"danger_rating": "LOW",      "danger_score": 0.10},
    2:  {"danger_rating": "LOW",      "danger_score": 0.12},
    3:  {"danger_rating": "LOW",      "danger_score": 0.18},
    4:  {"danger_rating": "MODERATE", "danger_score": 0.28},
    5:  {"danger_rating": "MODERATE", "danger_score": 0.38},
    6:  {"danger_rating": "HIGH",     "danger_score": 0.60},
    7:  {"danger_rating": "VERY HIGH","danger_score": 0.78},
    8:  {"danger_rating": "VERY HIGH","danger_score": 0.80},
    9:  {"danger_rating": "HIGH",     "danger_score": 0.65},
    10: {"danger_rating": "MODERATE", "danger_score": 0.40},
    11: {"danger_rating": "LOW",      "danger_score": 0.20},
    12: {"danger_rating": "LOW",      "danger_score": 0.10},
}

_HYDRO_DEFAULTS = {
    1:  {"flood_severity": "none",     "max_flow_cfs": 80},
    2:  {"flood_severity": "none",     "max_flow_cfs": 100},
    3:  {"flood_severity": "minor",    "max_flow_cfs": 200},
    4:  {"flood_severity": "moderate", "max_flow_cfs": 900},
    5:  {"flood_severity": "major",    "max_flow_cfs": 2400},
    6:  {"flood_severity": "moderate", "max_flow_cfs": 1100},
    7:  {"flood_severity": "minor",    "max_flow_cfs": 350},
    8:  {"flood_severity": "none",     "max_flow_cfs": 120},
    9:  {"flood_severity": "none",     "max_flow_cfs": 90},
    10: {"flood_severity": "none",     "max_flow_cfs": 85},
    11: {"flood_severity": "none",     "max_flow_cfs": 95},
    12: {"flood_severity": "none",     "max_flow_cfs": 110},
}


def fetch_era5_weather(lat: float, lon: float, date_str: str) -> Optional[dict]:
    """
    Fetch ERA5 reanalysis for a date (YYYY-MM-DD) and coordinate.
    Returns a weather dict matching the openmeteo_service output schema, or None.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": date_str,
        "end_date": date_str,
        "hourly": "temperature_2m,windspeed_10m,precipitation,relativehumidity_2m,weathercode",
        "timezone": "America/Los_Angeles",
    }
    try:
        resp = requests.get(ERA5_URL, params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        if not times:
            return None

        # Use noon (index 12) as representative daytime reading
        idx = 12 if len(times) > 12 else len(times) // 2

        def _v(key, default=0):
            vals = hourly.get(key, [])
            raw = vals[idx] if idx < len(vals) else default
            return raw if raw is not None else default

        temp_c       = float(_v("temperature_2m", 15.0))
        wind_kmh     = float(_v("windspeed_10m", 10.0))
        precip_mmhr  = float(_v("precipitation", 0.0))
        humidity_pct = float(_v("relativehumidity_2m", 50.0))
        wcode        = int(_v("weathercode", 0))

        fog        = wcode in (45, 48)
        storm      = wcode in (95, 96, 99)
        heavy_rain = wcode in (65, 82) or precip_mmhr > 10
        snow       = 71 <= wcode <= 86

        wind_score  = min(1.0, wind_kmh / 80.0)
        rain_score  = min(1.0, precip_mmhr / 20.0)
        temp_score  = 0.8 if temp_c < 0 else (0.9 if temp_c > 38 else 0.1)
        cond_bonus  = 0.3 if storm else (0.2 if fog or snow else 0.0)
        weather_risk = min(1.0, wind_score*0.35 + rain_score*0.30 + temp_score*0.20 + cond_bonus*0.15)

        return {
            "temperature_c":      round(temp_c, 1),
            "windspeed_kmh":      round(wind_kmh, 1),
            "precipitation_mmhr": round(precip_mmhr, 2),
            "humidity_pct":       round(humidity_pct, 1),
            "weathercode":        wcode,
            "conditions": {"fog": fog, "storm": storm, "heavy_rain": heavy_rain, "snow": snow},
            "weather_risk_score": round(weather_risk, 3),
            "source": "era5",
        }
    except Exception as exc:
        log.debug("ERA5 fetch failed for %s @ %s: %s", date_str, (lat, lon), exc)
        return None


def fetch_terrain(lat: float, lon: float, use_terrain: bool) -> dict:
    """Fetch terrain data via routing.services.terrain_service or return synthetic values."""
    if not use_terrain:
        return {"slope_deg": 15.0, "elevation_m": 1800.0, "hazard_score": 0.35, "source": "synthetic"}

    try:
        delta = 0.02  # ~2.2 km bbox around point
        from routing.services.terrain_service import (
            get_terrain_data, get_elevation_at, get_slope_at,
        )
        td = get_terrain_data(lat - delta, lon - delta, lat + delta, lon + delta)
        slope = get_slope_at(lat, lon, td)
        elev  = get_elevation_at(lat, lon, td)
        stats = td.get("stats", {})
        hazard_grid = td.get("hazard_grid")
        hazard = float(hazard_grid.mean()) if hazard_grid is not None else 0.4
        return {
            "slope_deg": round(slope, 1),
            "elevation_m": round(elev, 0),
            "hazard_score": round(hazard, 3),
            "source": "3dep",
        }
    except Exception as exc:
        log.debug("Terrain fetch failed for (%s, %s): %s", lat, lon, exc)
        return {"slope_deg": 15.0, "elevation_m": 1800.0, "hazard_score": 0.35, "source": "synthetic"}


def build_bbox(lat: float, lon: float, delta: float = 0.06) -> dict:
    return {"south": lat - delta, "north": lat + delta,
            "west":  lon - delta, "east":  lon + delta}


def load_csv(path: Path) -> list[dict]:
    if not path.exists():
        log.warning("File not found: %s", path)
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def process_nps_incident(row: dict, use_terrain: bool) -> Optional[dict]:
    """Convert a single NPS incident CSV row into a conditions snapshot."""
    try:
        lat = float(row["lat"]) if row["lat"] else None
        lon = float(row["lon"]) if row["lon"] else None
    except (ValueError, TypeError):
        return None
    if lat is None or lon is None:
        return None

    date_str = row["date"]
    month = int(row["month"])

    weather = fetch_era5_weather(lat, lon, date_str)
    if weather is None:
        # Safe defaults for missing ERA5 data
        weather = {
            "temperature_c": 15.0, "windspeed_kmh": 10.0,
            "precipitation_mmhr": 0.0, "humidity_pct": 50.0,
            "weathercode": 0,
            "conditions": {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
            "weather_risk_score": 0.15, "source": "default",
        }

    terrain = fetch_terrain(lat, lon, use_terrain)
    fire = dict(_FIRE_DEFAULTS[month])
    fire["dispatch_level"] = "Low"
    fire["dispatch_score"] = 0.1
    fire["no_campfire_active"] = month in (6, 7, 8, 9)

    hydro = dict(_HYDRO_DEFAULTS[month])
    hydro["flood_alert"] = hydro["flood_severity"] in ("moderate", "major")

    return {
        "source": "nps_incident",
        "date": date_str,
        "year": int(row["year"]),
        "month": month,
        "incident_lat": lat,
        "incident_lon": lon,
        "incident_type": row["incident_type"],
        "location_raw": row.get("location_raw", ""),
        "description": row.get("description", ""),
        "bbox": build_bbox(lat, lon),
        "weather": weather,
        "fire": fire,
        "hydro": hydro,
        "roads": {"count": 0, "has_closure": False, "types": []},
        "terrain": terrain,
    }


def process_wfigs_fire(row: dict, use_terrain: bool) -> Optional[dict]:
    """Convert a WFIGS fire row into a conditions snapshot (fire-as-hazard context)."""
    try:
        lat, lon = float(row["lat"]), float(row["lon"])
    except (ValueError, TypeError):
        return None

    date_str = row.get("discovered_dt", "")
    if not date_str or len(date_str) < 7:
        return None
    try:
        month = int(date_str[5:7])
    except ValueError:
        return None

    weather = fetch_era5_weather(lat, lon, date_str) or {
        "temperature_c": 28.0, "windspeed_kmh": 25.0,
        "precipitation_mmhr": 0.0, "humidity_pct": 20.0,
        "weathercode": 0,
        "conditions": {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
        "weather_risk_score": 0.65, "source": "default",
    }

    terrain = fetch_terrain(lat, lon, use_terrain)
    acres = float(row.get("final_acres") or 0)

    fire = {
        "danger_rating": "VERY HIGH" if acres > 100 else "HIGH",
        "danger_score": min(1.0, 0.6 + acres / 5000),
        "dispatch_level": "High" if acres > 500 else "Medium",
        "dispatch_score": 0.6 if acres > 500 else 0.3,
        "no_campfire_active": True,
    }
    hydro = dict(_HYDRO_DEFAULTS[month])
    hydro["flood_alert"] = False

    return {
        "source": "wfigs_fire",
        "date": date_str,
        "year": int(date_str[:4]),
        "month": month,
        "incident_lat": lat,
        "incident_lon": lon,
        "incident_type": "fire_related",
        "location_raw": row.get("name", ""),
        "description": f"Wildfire: {row.get('name','')} — {acres:.0f} acres, cause: {row.get('fire_cause','')}",
        "bbox": build_bbox(lat, lon),
        "weather": weather,
        "fire": fire,
        "hydro": hydro,
        "roads": {"count": 0, "has_closure": True, "types": ["road_closure"]},
        "terrain": terrain,
    }


def process_road_incident(row: dict, use_terrain: bool) -> Optional[dict]:
    """
    Convert a road incident CSV row (from fetch_road_incidents.py) into a snapshot.

    Road incidents elevate the roads risk factor and default to 'vehicle' unless
    the type field indicates otherwise.
    """
    try:
        lat = float(row["lat"]) if row.get("lat") else None
        lon = float(row["lon"]) if row.get("lon") else None
    except (ValueError, TypeError):
        return None
    if lat is None or lon is None:
        return None

    date_str = row.get("date", "")
    if not date_str or len(date_str) < 7:
        return None
    try:
        month = int(date_str[5:7])
        year  = int(date_str[:4])
    except ValueError:
        return None

    weather = fetch_era5_weather(lat, lon, date_str) or {
        "temperature_c": 15.0, "windspeed_kmh": 15.0,
        "precipitation_mmhr": 0.0, "humidity_pct": 50.0,
        "weathercode": 0,
        "conditions": {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
        "weather_risk_score": 0.15, "source": "default",
    }

    terrain = fetch_terrain(lat, lon, use_terrain)
    fire = dict(_FIRE_DEFAULTS[month])
    fire["dispatch_level"] = "Low"
    fire["dispatch_score"] = 0.1
    fire["no_campfire_active"] = month in (6, 7, 8, 9)

    hydro = dict(_HYDRO_DEFAULTS[month])
    hydro["flood_alert"] = hydro["flood_severity"] in ("moderate", "major")

    # Road incidents get elevated road count and possibly a closure flag
    severity = row.get("severity", "").lower()
    has_closure = any(w in severity for w in ("fatal", "serious", "major", "closure"))
    road_count = 3 if has_closure else 1

    description = row.get("description") or ""
    if not description:
        road_name = row.get("road_name") or ""
        description = f"Road incident on {road_name}" if road_name else "Road incident"

    return {
        "source": "road_incident",
        "date":   date_str,
        "year":   year,
        "month":  month,
        "incident_lat":  lat,
        "incident_lon":  lon,
        "incident_type": row.get("incident_type", "vehicle"),
        "location_raw":  row.get("road_name", ""),
        "description":   description,
        "bbox":    build_bbox(lat, lon),
        "weather": weather,
        "fire":    fire,
        "hydro":   hydro,
        "roads": {
            "count":       road_count,
            "has_closure": has_closure,
            "types":       [row.get("raw_type", "vehicle_incident")],
        },
        "terrain": terrain,
    }


def process_deaths_location(entry: dict, month: int, use_terrain: bool) -> Optional[dict]:
    """
    Produce one seasonal snapshot for a deaths_by_location.json entry.

    These are synthetic (archetypal) samples: no specific date, but they encode
    the known high-risk character of the location across a given month.
    Uses a synthetic year 2010 so they are always placed in the training split.
    """
    try:
        lat = float(entry["lat"])
        lon = float(entry["lon"])
    except (KeyError, TypeError, ValueError):
        return None

    # Synthetic date: use 15th of the given month in 2010
    date_str = f"2010-{month:02d}-15"

    weather = fetch_era5_weather(lat, lon, date_str) or {
        "temperature_c": 15.0 + (month - 6) * 1.5 if 4 <= month <= 9 else 5.0,
        "windspeed_kmh": 20.0 if month in (7, 8) else 10.0,
        "precipitation_mmhr": 0.0,
        "humidity_pct": 40.0,
        "weathercode": 0,
        "conditions": {
            "fog": False,
            "storm": month in (7, 8),
            "heavy_rain": False,
            "snow": month in (1, 2, 3, 11, 12),
        },
        "weather_risk_score": 0.45 if month in (7, 8) else 0.15,
        "source": "default",
    }

    # Adjust storm flag for lightning-prone locations in summer
    primary_type = entry.get("primary_type", "fall")
    if primary_type == "lightning" and month in (7, 8):
        weather["conditions"]["storm"] = True
        weather["weather_risk_score"] = max(weather.get("weather_risk_score", 0.45), 0.55)

    terrain = fetch_terrain(lat, lon, use_terrain)
    fire = dict(_FIRE_DEFAULTS[month])
    fire["dispatch_level"] = "Low"
    fire["dispatch_score"] = 0.1
    fire["no_campfire_active"] = month in (6, 7, 8, 9)

    hydro = dict(_HYDRO_DEFAULTS[month])
    hydro["flood_alert"] = hydro["flood_severity"] in ("moderate", "major")

    # Road count elevated for vehicle-type locations
    road_count = 2 if primary_type == "vehicle" else 0

    return {
        "source":        "deaths_location",
        "date":          date_str,
        "year":          2010,
        "month":         month,
        "incident_lat":  lat,
        "incident_lon":  lon,
        "incident_type": primary_type,
        "location_raw":  entry.get("name", ""),
        "description":   f"{entry.get('name','')}: {'; '.join(entry.get('risk_factors', [])[:2])}",
        "bbox":          build_bbox(lat, lon),
        "weather":       weather,
        "fire":          fire,
        "hydro":         hydro,
        "roads": {
            "count":       road_count,
            "has_closure": False,
            "types":       [],
        },
        "terrain": terrain,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-terrain", action="store_true",
                        help="Skip Django terrain fetch (use synthetic values)")
    args = parser.parse_args()
    use_terrain = not args.no_terrain

    if use_terrain:
        import django, os
        os.environ.setdefault("DJANGO_SETTINGS_MODULE", "trail_backend.settings")
        try:
            django.setup()
        except Exception as exc:
            log.warning("Django setup failed (%s) — falling back to synthetic terrain", exc)
            use_terrain = False

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    nps_rows   = load_csv(INPUT_NPS)
    wfigs_rows = load_csv(INPUT_WFIGS)
    road_rows  = load_csv(INPUT_ROADS)

    # Load deaths_by_location.json
    deaths_entries: list[dict] = []
    if INPUT_DEATHS.exists():
        with open(INPUT_DEATHS, encoding="utf-8") as f:
            deaths_data = json.load(f)
        deaths_entries = deaths_data.get("high_risk_locations", [])
        log.info("Loaded %d deaths_by_location entries", len(deaths_entries))
    else:
        log.warning("deaths_by_location.json not found — skipping archetypal samples")

    log.info(
        "Processing %d NPS + %d WFIGS + %d road + %d deaths-location sources",
        len(nps_rows), len(wfigs_rows), len(road_rows), len(deaths_entries),
    )

    written = 0
    with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
        # NPS incidents
        for i, row in enumerate(nps_rows):
            snap = process_nps_incident(row, use_terrain)
            if snap:
                out.write(json.dumps(snap) + "\n")
                written += 1
            if (i + 1) % 20 == 0:
                log.info("  NPS: %d / %d processed", i + 1, len(nps_rows))
            time.sleep(0.15)  # ERA5 rate limit courtesy

        # WFIGS fires
        for i, row in enumerate(wfigs_rows):
            snap = process_wfigs_fire(row, use_terrain)
            if snap:
                out.write(json.dumps(snap) + "\n")
                written += 1
            if (i + 1) % 50 == 0:
                log.info("  WFIGS: %d / %d processed", i + 1, len(wfigs_rows))
            time.sleep(0.15)

        # Road incidents (NPS YOSE FeatureServer)
        for i, row in enumerate(road_rows):
            snap = process_road_incident(row, use_terrain)
            if snap:
                out.write(json.dumps(snap) + "\n")
                written += 1
            if (i + 1) % 20 == 0:
                log.info("  Roads: %d / %d processed", i + 1, len(road_rows))
            time.sleep(0.10)

        # Deaths-by-location archetypal samples (seasonal — one per peak month per location)
        deaths_written = 0
        for entry in deaths_entries:
            peak_months = entry.get("peak_months", [7])
            for month in peak_months:
                snap = process_deaths_location(entry, month, use_terrain)
                if snap:
                    out.write(json.dumps(snap) + "\n")
                    written += 1
                    deaths_written += 1
                time.sleep(0.10)
        log.info("  Deaths-location: %d seasonal snapshots written", deaths_written)

    log.info("Written %d snapshots total to %s", written, OUTPUT_FILE)


if __name__ == "__main__":
    main()
