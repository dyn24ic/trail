"""
Weather Service – fetches current conditions from OpenWeatherMap and
translates them into routing-relevant hazard factors.
"""
import logging
from typing import Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"


def get_weather(lat: float, lon: float) -> dict:
    """
    Fetch current weather for a coordinate.
    Falls back to a safe-default response if the API key is missing / call fails.
    """
    api_key = getattr(settings, "OPENWEATHER_API_KEY", "")
    if not api_key or api_key == "placeholder":
        logger.warning("No OpenWeatherMap API key – returning default weather")
        return _default_weather(lat, lon)

    try:
        resp = requests.get(
            OPENWEATHER_URL,
            params={"lat": lat, "lon": lon, "appid": api_key, "units": "metric"},
            timeout=8,
        )
        resp.raise_for_status()
        raw = resp.json()
        return _parse_weather(raw)
    except Exception as exc:
        logger.warning("Weather API call failed: %s – using default", exc)
        return _default_weather(lat, lon)


def _parse_weather(raw: dict) -> dict:
    wind_speed = raw.get("wind", {}).get("speed", 0)          # m/s
    wind_deg = raw.get("wind", {}).get("deg", 0)
    visibility = raw.get("visibility", 10000)                  # metres
    temp = raw.get("main", {}).get("temp", 15)
    feels_like = raw.get("main", {}).get("feels_like", 15)
    humidity = raw.get("main", {}).get("humidity", 50)
    pressure = raw.get("main", {}).get("pressure", 1013)
    weather_code = raw.get("weather", [{}])[0].get("id", 800)
    description = raw.get("weather", [{}])[0].get("description", "clear")

    # Derived routing factors
    precipitation_mm = (
        raw.get("rain", {}).get("1h", 0) + raw.get("snow", {}).get("1h", 0)
    )
    fog = visibility < 1000
    storm = weather_code < 300          # thunderstorm codes 2xx
    heavy_rain = 500 <= weather_code <= 531
    snow = 600 <= weather_code <= 622

    # Ground vehicle speed penalty [0, 1]  (1 = no penalty)
    ground_speed_factor = _ground_speed_factor(
        wind_speed, precipitation_mm, fog, storm, snow
    )
    # Helicopter fly penalty [0, 1]  (1 = no penalty)
    helicopter_speed_factor = _helicopter_speed_factor(
        wind_speed, visibility, storm, fog
    )
    # Overall hazard [0, 1]
    weather_hazard = round(1 - min(ground_speed_factor, helicopter_speed_factor), 3)

    # Helicopter flight recommendation
    helicopter_ok = (
        wind_speed < 15          # < ~30 kt
        and visibility >= 1500   # VFR minimum
        and not storm
        and not (snow and precipitation_mm > 5)
    )

    return {
        "temperature_c": round(temp, 1),
        "feels_like_c": round(feels_like, 1),
        "humidity_pct": humidity,
        "pressure_hpa": pressure,
        "wind_speed_ms": round(wind_speed, 1),
        "wind_direction_deg": wind_deg,
        "visibility_m": visibility,
        "precipitation_mm_1h": round(precipitation_mm, 2),
        "description": description,
        "conditions": {
            "fog": fog,
            "storm": storm,
            "heavy_rain": heavy_rain,
            "snow": snow,
        },
        "routing_factors": {
            "ground_speed_factor": round(ground_speed_factor, 3),
            "helicopter_speed_factor": round(helicopter_speed_factor, 3),
            "weather_hazard": weather_hazard,
            "helicopter_flight_ok": helicopter_ok,
        },
    }


def _ground_speed_factor(
    wind_speed: float, precip: float, fog: bool, storm: bool, snow: bool
) -> float:
    factor = 1.0
    if storm:
        factor *= 0.4
    if snow and precip > 3:
        factor *= 0.5
    elif precip > 20:
        factor *= 0.6
    elif precip > 5:
        factor *= 0.8
    if fog:
        factor *= 0.7
    if wind_speed > 20:
        factor *= 0.85
    return max(0.1, factor)


def _helicopter_speed_factor(
    wind_speed: float, visibility: int, storm: bool, fog: bool
) -> float:
    factor = 1.0
    if storm:
        return 0.0   # no-fly
    if wind_speed >= 20:
        factor *= max(0.0, 1 - (wind_speed - 20) / 15)
    if visibility < 1500:
        factor *= 0.5
    if fog:
        factor *= 0.4
    return max(0.0, factor)


def _default_weather(lat: float, lon: float) -> dict:
    """Safe-default weather (clear, calm) used when API is unavailable."""
    return {
        "temperature_c": 12.0,
        "feels_like_c": 10.0,
        "humidity_pct": 55,
        "pressure_hpa": 1013,
        "wind_speed_ms": 3.0,
        "wind_direction_deg": 180,
        "visibility_m": 10000,
        "precipitation_mm_1h": 0.0,
        "description": "clear sky (default – no API key)",
        "conditions": {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
        "routing_factors": {
            "ground_speed_factor": 1.0,
            "helicopter_speed_factor": 1.0,
            "weather_hazard": 0.0,
            "helicopter_flight_ok": True,
        },
    }
