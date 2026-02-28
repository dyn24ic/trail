"""
Management command: predict_hotspots

CLI wrapper around the hotspot prediction pipeline for testing and debugging.

Usage:
    python manage.py predict_hotspots
    python manage.py predict_hotspots --south 37.70 --north 37.82 --west -119.62 --east -119.47
    python manage.py predict_hotspots --pretty   # pretty-print JSON (default)
    python manage.py predict_hotspots --compact  # minified JSON for piping
"""
import json
import sys

from django.core.management.base import BaseCommand

from weather.services.hotspot_service import predict_hotspots

# Default: Yosemite Valley bbox (matches app/src/data/trailBbox.ts)
DEFAULT_BBOX = {
    "south": 37.70,
    "north": 37.82,
    "west": -119.62,
    "east": -119.47,
}


class Command(BaseCommand):
    help = "Run the trAIl hotspot prediction pipeline and output HotspotPredictionResponse JSON"

    def add_arguments(self, parser):
        parser.add_argument("--south", type=float, default=DEFAULT_BBOX["south"],
                            help="Bbox south latitude (default: Yosemite)")
        parser.add_argument("--north", type=float, default=DEFAULT_BBOX["north"],
                            help="Bbox north latitude (default: Yosemite)")
        parser.add_argument("--west",  type=float, default=DEFAULT_BBOX["west"],
                            help="Bbox west longitude (default: Yosemite)")
        parser.add_argument("--east",  type=float, default=DEFAULT_BBOX["east"],
                            help="Bbox east longitude (default: Yosemite)")
        parser.add_argument("--compact", action="store_true",
                            help="Output minified JSON instead of pretty-printed")

    def handle(self, *args, **options):
        bbox = {
            "south": options["south"],
            "north": options["north"],
            "west":  options["west"],
            "east":  options["east"],
        }

        self.stderr.write(self.style.NOTICE(
            f"[trAIl] Starting hotspot prediction for bbox: "
            f"S={bbox['south']} N={bbox['north']} W={bbox['west']} E={bbox['east']}"
        ))

        try:
            result = predict_hotspots(bbox)
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"[trAIl] Prediction failed: {exc}"))
            sys.exit(1)

        indent = None if options["compact"] else 2
        output = json.dumps(result, indent=indent, ensure_ascii=False)
        self.stdout.write(output)

        n = len(result.get("hotspots", []))
        self.stderr.write(self.style.SUCCESS(
            f"[trAIl] Done — {n} hotspot(s) predicted."
        ))
