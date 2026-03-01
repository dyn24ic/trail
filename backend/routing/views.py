"""
Django REST Framework views for Stage 2b – Responder Route Optimisation.

Endpoints:
  POST /api/route/calculate/   – full route with LLM analysis
  POST /api/route/compare/     – compare ground vs helicopter
  GET  /api/terrain/            – raw terrain stats for a bounding box
  GET  /api/weather/            – current weather for a point
  GET  /api/health/             – service health check
"""
import logging

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .serializers import (
    RouteRequestSerializer,
    TerrainRequestSerializer,
    WeatherRequestSerializer,
)
from .services.terrain_service import get_terrain_data, identify_danger_zones
from .services.weather_service import get_weather
from .services.route_service import calculate_route, recommend_helicopter
from .services.llm_service import analyze_route
from .models import RouteRequest

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/route/calculate/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["POST"])
def calculate_route_view(request):
    """
    Calculate the optimal route for SAR responders.

    Request body:
      {
        "responder_lat": 40.1,  "responder_lon": -105.3,
        "victim_lat":    40.05, "victim_lon":    -105.25,
        "severity": 3,          // 1-5
        "route_type": "ground"  // "ground" | "helicopter"
      }

    Response: full route with waypoints, elevation profile, danger zones,
              ETA, safety score, LLM analysis.
    """
    serializer = RouteRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    responder = {"lat": d["responder_lat"], "lon": d["responder_lon"]}
    victim = {"lat": d["victim_lat"], "lon": d["victim_lon"]}
    severity = d["severity"]
    route_type = d["route_type"]

    try:
        # 1. Terrain
        terrain = get_terrain_data(
            d["responder_lat"], d["responder_lon"],
            d["victim_lat"], d["victim_lon"],
        )

        # 2. Weather (use midpoint for representative reading)
        mid_lat = (d["responder_lat"] + d["victim_lat"]) / 2
        mid_lon = (d["responder_lon"] + d["victim_lon"]) / 2
        weather = get_weather(mid_lat, mid_lon)

        # 3. Route calculation
        route = calculate_route(
            d["responder_lat"], d["responder_lon"],
            d["victim_lat"], d["victim_lon"],
            terrain, weather, severity, route_type,
        )

        # 4. LLM analysis
        llm = analyze_route(
            route_data=route,
            weather_data=weather,
            terrain_stats=terrain["stats"],
            severity=severity,
            route_type=route_type,
            responder_location=responder,
            victim_location=victim,
        )

        # 5. Audit log
        RouteRequest.objects.create(
            responder_lat=d["responder_lat"],
            responder_lon=d["responder_lon"],
            victim_lat=d["victim_lat"],
            victim_lon=d["victim_lon"],
            severity=severity,
            route_type=route_type,
            eta_minutes=route.get("eta_minutes"),
            safety_score=route.get("safety_score"),
            distance_m=route.get("total_distance_m"),
            helicopter_recommended=route.get("helicopter_recommendation", {}).get("recommended", False),
        )

        return Response({
            "status": "ok",
            "request": {
                "responder": responder,
                "victim": victim,
                "severity": severity,
                "route_type": route_type,
            },
            "route": route,
            "weather": weather,
            "terrain_stats": terrain["stats"],
            "analysis": llm,
        })

    except Exception as exc:
        logger.exception(
            "Route calculation failed | responder=(%.5f,%.5f) victim=(%.5f,%.5f) severity=%s type=%s",
            d["responder_lat"], d["responder_lon"],
            d["victim_lat"], d["victim_lon"],
            severity, route_type,
        )
        return Response(
            {"error": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/route/compare/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["POST"])
def compare_routes_view(request):
    """
    Calculate BOTH ground and helicopter routes and let the LLM pick the best.

    Same request body as /api/route/calculate/ (route_type is ignored here).
    """
    serializer = RouteRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    responder = {"lat": d["responder_lat"], "lon": d["responder_lon"]}
    victim = {"lat": d["victim_lat"], "lon": d["victim_lon"]}
    severity = d["severity"]

    try:
        terrain = get_terrain_data(
            d["responder_lat"], d["responder_lon"],
            d["victim_lat"], d["victim_lon"],
        )
        mid_lat = (d["responder_lat"] + d["victim_lat"]) / 2
        mid_lon = (d["responder_lon"] + d["victim_lon"]) / 2
        weather = get_weather(mid_lat, mid_lon)

        ground_route = calculate_route(
            d["responder_lat"], d["responder_lon"],
            d["victim_lat"], d["victim_lon"],
            terrain, weather, severity, "ground",
        )
        heli_route = calculate_route(
            d["responder_lat"], d["responder_lon"],
            d["victim_lat"], d["victim_lon"],
            terrain, weather, severity, "helicopter",
        )

        # Determine recommendation
        heli_rec = ground_route["helicopter_recommendation"]
        recommended_type = (
            "helicopter"
            if heli_rec["recommended"] and weather["routing_factors"]["helicopter_flight_ok"]
            else "ground"
        )

        ground_analysis = analyze_route(
            ground_route, weather, terrain["stats"], severity, "ground", responder, victim
        )
        heli_analysis = analyze_route(
            heli_route, weather, terrain["stats"], severity, "helicopter", responder, victim
        )

        return Response({
            "status": "ok",
            "request": {"responder": responder, "victim": victim, "severity": severity},
            "recommended_type": recommended_type,
            "ground": {"route": ground_route, "analysis": ground_analysis},
            "helicopter": {"route": heli_route, "analysis": heli_analysis},
            "weather": weather,
            "terrain_stats": terrain["stats"],
            "helicopter_recommendation": heli_rec,
        })

    except Exception as exc:
        logger.exception(
            "Route comparison failed | responder=(%.5f,%.5f) victim=(%.5f,%.5f) severity=%s",
            d["responder_lat"], d["responder_lon"],
            d["victim_lat"], d["victim_lon"],
            severity,
        )
        return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/terrain/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["GET"])
def terrain_view(request):
    """
    Fetch terrain stats and danger zones for a bounding box.

    Query params: west, south, east, north
    """
    serializer = TerrainRequestSerializer(data=request.query_params)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    try:
        terrain = get_terrain_data(d["south"], d["west"], d["north"], d["east"])
        danger_zones = identify_danger_zones(terrain)

        rows, cols = terrain["elevation_grid"].shape
        sample_step = max(1, rows // 30)
        elevation_sample = terrain["elevation_grid"][::sample_step, ::sample_step].tolist()

        return Response({
            "status": "ok",
            "bbox": {"west": d["west"], "south": d["south"], "east": d["east"], "north": d["north"]},
            "stats": terrain["stats"],
            "danger_zones": danger_zones,
            "elevation_grid_sample": elevation_sample,
            "grid_size": {"rows": rows, "cols": cols},
        })
    except Exception as exc:
        logger.exception(
            "Terrain fetch failed | bbox=W%.5f S%.5f E%.5f N%.5f",
            d["west"], d["south"], d["east"], d["north"],
        )
        return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/weather/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["GET"])
def weather_view(request):
    """
    Get current weather for a coordinate.

    Query params: lat, lon
    """
    serializer = WeatherRequestSerializer(data=request.query_params)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data
    try:
        weather = get_weather(d["lat"], d["lon"])
        return Response({"status": "ok", "weather": weather, "location": d})
    except Exception as exc:
        logger.exception(
            "Weather fetch failed | lat=%.5f lon=%.5f",
            d["lat"], d["lon"],
        )
        return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/health/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["GET"])
def health_view(request):
    from django.conf import settings

    return Response({
        "status": "ok",
        "service": "trAIl – Stage 2b Route Optimisation Backend",
        "openai_configured": bool(
            getattr(settings, "OPENAI_API_KEY", "") not in ("", "sk-placeholder")
        ),
        "openweather_configured": bool(
            getattr(settings, "OPENWEATHER_API_KEY", "") not in ("", "placeholder")
        ),
    })
