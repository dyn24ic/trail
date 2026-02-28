"""
Hotspot prediction API view.

GET /api/hotspots/predict/?south=37.70&north=37.82&west=-119.62&east=-119.47

Returns a HotspotPredictionResponse JSON object — see weather/WEATHER.md for schema.
Frontend integration is intentionally deferred; this endpoint is backend-only for now.
"""
import logging

from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .services.hotspot_service import predict_hotspots

logger = logging.getLogger(__name__)

# Default bbox: Yosemite Valley (matches YOSEMITE_BBOX in app/src/data/trailBbox.ts)
DEFAULT_BBOX = {
    "south": 37.70,
    "north": 37.82,
    "west": -119.62,
    "east": -119.47,
}


@require_GET
def predict_hotspots_view(request):
    """
    Query params (all optional, default to Yosemite Valley bbox):
        south, north, west, east  — WGS84 decimal degrees
    """
    try:
        bbox = {
            "south": float(request.GET.get("south", DEFAULT_BBOX["south"])),
            "north": float(request.GET.get("north", DEFAULT_BBOX["north"])),
            "west":  float(request.GET.get("west",  DEFAULT_BBOX["west"])),
            "east":  float(request.GET.get("east",  DEFAULT_BBOX["east"])),
        }
    except ValueError:
        return JsonResponse({"error": "Invalid bbox parameters — expected decimal degree floats."}, status=400)

    if bbox["south"] >= bbox["north"] or bbox["west"] >= bbox["east"]:
        return JsonResponse({"error": "Invalid bbox: south must be < north, west must be < east."}, status=400)

    try:
        result = predict_hotspots(bbox)
        return JsonResponse(result, safe=False)
    except Exception as exc:
        logger.exception("Hotspot prediction failed: %s", exc)
        return JsonResponse({"error": "Hotspot prediction failed.", "detail": str(exc)}, status=500)


# Alias used in urls.py
predict_hotspots = predict_hotspots_view
