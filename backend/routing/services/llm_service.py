"""
LLM Service – uses GPT-4o to produce a human-readable route analysis,
hazard summary, and actionable recommendations for the responder.
"""
import json
import logging
from typing import Optional

from django.conf import settings

logger = logging.getLogger(__name__)


def analyze_route(
    route_data: dict,
    weather_data: dict,
    terrain_stats: dict,
    severity: int,
    route_type: str,
    responder_location: dict,
    victim_location: dict,
) -> dict:
    """
    Send route + context to GPT-4o and return structured analysis.
    Falls back to a rules-based summary if OpenAI is unavailable.
    """
    api_key = getattr(settings, "OPENAI_API_KEY", "")
    if not api_key or api_key in ("sk-placeholder", ""):
        logger.warning("No OpenAI key – using fallback LLM analysis")
        return _fallback_analysis(route_data, weather_data, severity, route_type)

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        prompt = _build_prompt(
            route_data, weather_data, terrain_stats,
            severity, route_type, responder_location, victim_location,
        )
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert Search & Rescue route planner. "
                        "Analyse the provided route data and return a JSON object "
                        "with keys: summary, hazards (list of strings), "
                        "recommendations (list of strings), "
                        "helicopter_advice (string), safety_assessment (string), "
                        "turn_by_turn (list of strings). "
                        "Be concise and practical. Focus on actionable guidance."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=1500,
        )
        content = response.choices[0].message.content
        result = json.loads(content)
        result["model"] = "gpt-4o"
        result["llm_used"] = True
        return result

    except Exception as exc:
        logger.warning("OpenAI call failed: %s – using fallback", exc)
        result = _fallback_analysis(route_data, weather_data, severity, route_type)
        result["llm_error"] = str(exc)
        return result


def _build_prompt(
    route_data: dict,
    weather_data: dict,
    terrain_stats: dict,
    severity: int,
    route_type: str,
    responder_location: dict,
    victim_location: dict,
) -> str:
    danger_zones_summary = []
    for z in route_data.get("danger_zones", [])[:5]:
        danger_zones_summary.append(
            f"  - {z['type']} at ({z['center']['lat']:.4f}, {z['center']['lon']:.4f}), "
            f"hazard={z['hazard_score']}, slope={z['avg_slope_deg']}°"
        )

    waypoint_count = len(route_data.get("waypoints", []))
    stats = route_data.get("stats", {})

    heli_rec = route_data.get("helicopter_recommendation", {})

    prompt = f"""
Search & Rescue Route Analysis Request
=======================================

SITUATION
---------
Injury severity: {severity}/5  (1=minor, 5=critical/life-threatening)
Route type requested: {route_type}
Responder start: lat={responder_location['lat']:.5f}, lon={responder_location['lon']:.5f}
Victim location:  lat={victim_location['lat']:.5f}, lon={victim_location['lon']:.5f}

CALCULATED ROUTE
----------------
Total distance: {route_data['total_distance_m']:.0f} m
ETA: {route_data['eta_minutes']:.1f} minutes
Effective speed: {route_data['effective_speed_kmh']:.1f} km/h
Safety score: {route_data['safety_score']:.3f}  (0=safe, 1=extreme danger)
Route colour coding: {route_data['route_colour']}

TERRAIN STATISTICS
------------------
Min elevation: {stats.get('min_elevation_m', terrain_stats.get('min_elevation', 'N/A'))} m
Max elevation: {stats.get('max_elevation_m', terrain_stats.get('max_elevation', 'N/A'))} m
Average slope: {stats.get('avg_slope_deg', 'N/A')}°
Elevation gain: {stats.get('elevation_gain_m', 'N/A')} m

IDENTIFIED DANGER ZONES ALONG ROUTE ({len(route_data.get('danger_zones', []))} total)
--------------------------------------------------
{chr(10).join(danger_zones_summary) if danger_zones_summary else '  None identified'}

CURRENT WEATHER CONDITIONS
--------------------------
Temperature: {weather_data['temperature_c']}°C (feels like {weather_data['feels_like_c']}°C)
Wind: {weather_data['wind_speed_ms']} m/s from {weather_data['wind_direction_deg']}°
Visibility: {weather_data['visibility_m']} m
Precipitation: {weather_data['precipitation_mm_1h']} mm/h
Conditions: {weather_data['description']}
Storm: {weather_data['conditions']['storm']}, Fog: {weather_data['conditions']['fog']}, Snow: {weather_data['conditions']['snow']}
Ground speed factor: {weather_data['routing_factors']['ground_speed_factor']}
Helicopter flight OK: {weather_data['routing_factors']['helicopter_flight_ok']}

HELICOPTER RECOMMENDATION
-------------------------
Recommended: {heli_rec.get('recommended', False)}
Reasons: {', '.join(heli_rec.get('reasons', [])) or 'N/A'}

WAYPOINTS sampled ({min(waypoint_count, 5)} of {waypoint_count})
-------------------
{_format_waypoints_sample(route_data.get('waypoints', []))}

Please provide your expert route analysis in the specified JSON format.
"""
    return prompt.strip()


def _format_waypoints_sample(waypoints: list) -> str:
    if not waypoints:
        return "No waypoints"
    sample = waypoints[::max(1, len(waypoints)//5)][:5]
    lines = []
    for wp in sample:
        lines.append(
            f"  ({wp['lat']:.4f}, {wp['lon']:.4f}) "
            f"elev={wp.get('elevation_m', '?')}m "
            f"slope={wp.get('slope_deg', '?')}° "
            f"hazard={wp.get('hazard', '?')}"
        )
    return "\n".join(lines)


def _fallback_analysis(
    route_data: dict,
    weather_data: dict,
    severity: int,
    route_type: str,
) -> dict:
    """Rules-based fallback when OpenAI is unavailable."""
    safety = route_data.get("safety_score", 0)
    eta = route_data.get("eta_minutes", 0)
    dist = route_data.get("total_distance_m", 0)
    heli_ok = weather_data["routing_factors"]["helicopter_flight_ok"]
    heli_rec = route_data.get("helicopter_recommendation", {}).get("recommended", False)

    hazards = []
    recommendations = []

    # Weather hazards
    if weather_data["conditions"]["storm"]:
        hazards.append("Active thunderstorm – extreme hazard for both ground and air operations")
        recommendations.append("Shelter in place until storm passes if safety allows")
    if weather_data["conditions"]["fog"]:
        hazards.append("Reduced visibility due to fog")
        recommendations.append("Use GPS navigation, avoid cliff edges")
    if weather_data["conditions"]["snow"]:
        hazards.append("Snow conditions – slippery terrain likely")
        recommendations.append("Carry crampons / traction devices")
    if weather_data["wind_speed_ms"] > 15:
        hazards.append(f"Strong winds {weather_data['wind_speed_ms']:.0f} m/s")

    # Terrain hazards
    danger_zones = route_data.get("danger_zones", [])
    for z in danger_zones[:3]:
        hazards.append(f"{z['type'].replace('_',' ').title()} – hazard {z['hazard_score']:.2f}, slope {z['avg_slope_deg']}°")
        if z["type"] == "cliff":
            recommendations.append(f"Cliff zone near ({z['center']['lat']:.3f}, {z['center']['lon']:.3f}) – use extreme caution or detour")

    if safety > 0.75:
        recommendations.append("HIGH DANGER: Consider helicopter if conditions permit")
    elif safety > 0.5:
        recommendations.append("Use caution – multiple hazard zones on route")

    if not hazards:
        hazards.append("No critical hazards identified")

    # Turn-by-turn (high level)
    waypoints = route_data.get("waypoints", [])
    turn_by_turn = _generate_turn_by_turn(waypoints, danger_zones)

    severity_labels = {1: "minor", 2: "moderate-minor", 3: "moderate", 4: "serious", 5: "critical"}
    summary = (
        f"{route_type.title()} route to victim ({severity_labels.get(severity, severity)}/5 severity). "
        f"Distance: {dist/1000:.2f} km. ETA: {eta:.0f} min. "
        f"Safety score: {safety:.2f}/1.0 ({'safe' if safety < 0.4 else 'caution' if safety < 0.65 else 'dangerous'}). "
        f"{'Helicopter recommended.' if heli_rec else 'Ground route is viable.'}"
    )

    heli_advice = (
        "Helicopter not suitable – flight conditions not met." if not heli_ok
        else ("Helicopter strongly recommended – terrain/weather danger high." if heli_rec
              else "Ground route is appropriate for this mission profile.")
    )

    return {
        "summary": summary,
        "hazards": hazards,
        "recommendations": recommendations,
        "helicopter_advice": heli_advice,
        "safety_assessment": _safety_assessment_text(safety),
        "turn_by_turn": turn_by_turn,
        "model": "rules-based-fallback",
        "llm_used": False,
    }


def _safety_assessment_text(score: float) -> str:
    if score < 0.25:
        return "LOW risk – proceed at normal operational pace"
    if score < 0.5:
        return "MODERATE risk – maintain caution, monitor conditions"
    if score < 0.75:
        return "HIGH risk – take precautions, consider helicopter"
    return "EXTREME risk – helicopter strongly recommended, ground approach only if helicopter unavailable"


def _generate_turn_by_turn(waypoints: list, danger_zones: list) -> list[str]:
    if not waypoints:
        return ["Proceed directly to victim location"]

    instructions = [f"Depart from ({waypoints[0]['lat']:.4f}, {waypoints[0]['lon']:.4f})"]

    danger_zone_set = {
        (round(z["center"]["lat"], 2), round(z["center"]["lon"], 2))
        for z in danger_zones
    }

    step = max(1, len(waypoints) // 8)
    for i in range(step, len(waypoints) - 1, step):
        wp = waypoints[i]
        lat_r = round(wp["lat"], 2)
        lon_r = round(wp["lon"], 2)
        danger_note = " ⚠ DANGER ZONE NEARBY" if (lat_r, lon_r) in danger_zone_set else ""
        instructions.append(
            f"Continue to ({wp['lat']:.4f}, {wp['lon']:.4f}) "
            f"elev {wp.get('elevation_m', '?')}m{danger_note}"
        )

    last = waypoints[-1]
    instructions.append(f"Arrive at victim location ({last['lat']:.4f}, {last['lon']:.4f})")
    return instructions
