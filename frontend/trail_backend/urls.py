from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse


def api_index(request):
    return JsonResponse({
        "service": "trAIl – Backend API",
        "endpoints": {
            "POST /api/route/calculate/":   "Calculate safest/fastest route with LLM analysis",
            "POST /api/route/compare/":     "Compare ground vs helicopter routes",
            "GET  /api/terrain/":           "Terrain stats + danger zones for a bounding box",
            "GET  /api/weather/":           "Current weather at a coordinate",
            "GET  /api/health/":            "Service health check",
            "GET  /api/hotspots/predict/":  "AI-predicted accident hotspots (weather + terrain + fire)",
        },
        "docs": "See backend/README.md and backend/weather/WEATHER.md for full schemas",
    })


urlpatterns = [
    path("", api_index),
    path("admin/", admin.site.urls),
    path("api/", include("routing.urls")),
    path("api/hotspots/", include("weather.urls")),
]
