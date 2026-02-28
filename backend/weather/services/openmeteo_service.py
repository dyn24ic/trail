"""
Open-Meteo HRRR / GFS weather service.

Fetches current hourly weather conditions for a coordinate using the Open-Meteo
GFS API with the HRRR model overlay (3 km resolution, 1-hour update cycle).

API: https://api.open-meteo.com/v1/gfs
Auth: None (free, 600 req/min)
Docs: https://open-meteo.com/en/docs/gfs-api

No openmeteo_requests library needed — plain HTTP via `requests`.
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import requests

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/gfs"
TIMEOUT_SEC = 10
PACIFIC = ZoneInfo("America/Los_Angeles")

HOURLY_VARS = [
    "temperature_2m",
    "windspeed_10m",
    "precipitation",
    "relativehumidity_2m",
    "weathercode",
]

# WMO weather code descriptions (subset relevant to hiking safety)
_WMO_DESCRIPTION = {
    0: "clear sky",
    1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "icy fog",
    51: "drizzle (light)", 53: "drizzle (moderate)", 55: "drizzle (heavy)",
    61: "rain (light)", 63: "rain (moderate)", 65: "rain (heavy)",
    71: "snow (light)", 73: "snow (moderate)", 75: "snow (heavy)",
    77: "snow grains",
    80: "showers (light)", 81: "showers (moderate)", 82: "showers (violent)",
    85: "snow showers (light)", 86: "snow showers (heavy)",
    95: "thunderstorm",
    96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
}


def get_weather(lat: float, lon: float) -> dict:
    """
    Fetch current hourly conditions from Open-Meteo GFS/HRRR for a coordinate.

    Returns a dict with keys matching the existing routing weather_service.py
    convention where possible, plus hotspot-specific risk scores:
        temperature_c       float
        windspeed_kmh       float
        precipitation_mmhr  float
        humidity_pct        float
        weathercode         int
        description         str
        conditions          dict  { fog, storm, heavy_rain, snow }
        weather_risk_score  float  0–1 (used by riskAggregator in hotspot_service)
        fetchedAt           str   ISO8601 UTC
    """
    try:
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": ",".join(HOURLY_VARS),
            "models": "gfs_hrrr",
            "forecast_days": 1,
            "timezone": "America/Los_Angeles",
        }
        resp = requests.get(OPEN_METEO_URL, params=params, timeout=TIMEOUT_SEC)
        resp.raise_for_status()
        data = resp.json()
        return _parse_response(data)

    except Exception as exc:
        logger.warning("Open-Meteo call failed: %s – returning safe defaults", exc)
        return _default_weather(lat, lon)


def _parse_response(data: dict) -> dict:
    """Extract the reading closest to the current Pacific-time hour."""
    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    if not times:
        return _default_weather(0, 0)

    # Find the index whose timestamp is closest to now
    now_local = datetime.now(tz=PACIFIC)
    now_str = now_local.strftime("%Y-%m-%dT%H:00")
    idx = next((i for i, t in enumerate(times) if t == now_str), 0)

    def _val(key: str, default=0):
        vals = hourly.get(key, [])
        raw = vals[idx] if idx < len(vals) else default
        return raw if raw is not None else default

    temp_c        = float(_val("temperature_2m", 12.0))
    wind_kmh      = float(_val("windspeed_10m", 0.0))
    precip_mmhr   = float(_val("precipitation", 0.0))
    humidity_pct  = float(_val("relativehumidity_2m", 55.0))
    wcode         = int(_val("weathercode", 0))

    # Derived boolean conditions
    fog        = wcode in (45, 48)
    storm      = wcode in (95, 96, 99)
    heavy_rain = wcode in (65, 82) or precip_mmhr > 10
    snow       = 71 <= wcode <= 86

    # Weather risk score for hotspot weighting [0, 1]
    wind_score  = min(1.0, wind_kmh / 80.0)         # 80 km/h → saturates at 1.0
    rain_score  = min(1.0, precip_mmhr / 20.0)       # 20 mm/hr → saturates at 1.0
    temp_score  = 0.8 if temp_c < 0 else (0.9 if temp_c > 38 else 0.1)
    cond_bonus  = 0.3 if storm else (0.2 if fog or snow else 0.0)
    weather_risk = min(1.0, wind_score * 0.35 + rain_score * 0.30 + temp_score * 0.20 + cond_bonus * 0.15)

    return {
        "temperature_c":       round(temp_c, 1),
        "windspeed_kmh":       round(wind_kmh, 1),
        "precipitation_mmhr":  round(precip_mmhr, 2),
        "humidity_pct":        round(humidity_pct, 1),
        "weathercode":         wcode,
        "description":         _WMO_DESCRIPTION.get(wcode, f"code {wcode}"),
        "conditions": {
            "fog":        fog,
            "storm":      storm,
            "heavy_rain": heavy_rain,
            "snow":       snow,
        },
        "weather_risk_score":  round(weather_risk, 3),
        "fetchedAt":           datetime.now(tz=timezone.utc).isoformat(),
    }


def _default_weather(lat: float, lon: float) -> dict:
    """Safe-default response when Open-Meteo is unreachable."""
    return {
        "temperature_c":       12.0,
        "windspeed_kmh":       5.0,
        "precipitation_mmhr":  0.0,
        "humidity_pct":        55.0,
        "weathercode":         0,
        "description":         "clear sky (default – API unavailable)",
        "conditions":          {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
        "weather_risk_score":  0.15,
        "fetchedAt":           datetime.now(tz=timezone.utc).isoformat(),
    }


def weather_summary_string(weather: dict) -> str:
    """Human-readable one-liner for use in GPT prompts and API responses."""
    return (
        f"{weather['temperature_c']}°C, "
        f"wind {weather['windspeed_kmh']} km/h, "
        f"precip {weather['precipitation_mmhr']} mm/hr, "
        f"{weather['description']}"
    )
