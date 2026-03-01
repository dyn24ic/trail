"""
Hotspot model interface and built-in implementations.

Swap ACTIVE_MODEL to change which model generates hotzones.

To plug in a real inference model:
    1. Implement a class with `needs_context = True` and `predict(bbox, context) -> list[dict]`
    2. Replace the ACTIVE_MODEL line at the bottom of this file.

The HotspotContext dataclass carries all environmental inputs the full pipeline fetches
(weather, terrain, fire, hydro, roads, smoke_aqi) — no other files need to change.
"""
import random
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

_INCIDENT_TYPES = [
    "fall", "drowning", "medical", "vehicle", "rockfall",
    "lightning", "search_rescue", "fire_related", "unknown",
]

# ---------------------------------------------------------------------------
# Context passed to models that need environmental data
# ---------------------------------------------------------------------------

@dataclass
class HotspotContext:
    """All environmental data the full pipeline can supply to an inference model."""
    fire:      dict | None = field(default=None)
    weather:   dict | None = field(default=None)
    hydro:     dict | None = field(default=None)
    roads:     dict | None = field(default=None)
    smoke_aqi: float | None = field(default=None)
    terrain:   dict | None = field(default=None)


# ---------------------------------------------------------------------------
# Protocol — the interface every model must satisfy
# ---------------------------------------------------------------------------

@runtime_checkable
class HotspotModel(Protocol):
    """
    Interface for hotspot prediction models.

    needs_context: if False, the service skips all expensive data fetching and
                   passes context=None to predict().  Set to True for any model
                   that actually reads weather/terrain/fire data.
    version:       appears in the response 'modelVersion' field.
    """
    needs_context: bool
    version: str

    def predict(self, bbox: dict, context: HotspotContext | None) -> list[dict]:
        """Return a list of validated hotspot dicts (HotspotZone schema)."""
        ...


# ---------------------------------------------------------------------------
# Random hotspot model — fast, no network calls, good for dev/demo
# ---------------------------------------------------------------------------

_RISK_LEVELS = [
    (0.75, "extreme"),
    (0.55, "high"),
    (0.35, "moderate"),
    (0.00, "low"),
]


def _score_to_level(score: float) -> str:
    for threshold, level in _RISK_LEVELS:
        if score >= threshold:
            return level
    return "low"


class RandomHotspotModel:
    """
    Generates 3–7 random hotspots uniformly within the supplied bbox.
    Produces valid HotspotZone dicts without any external calls.
    """
    needs_context: bool = False
    version: str = "trAIl-random-v1.0"

    def predict(self, bbox: dict, context: HotspotContext | None) -> list[dict]:
        count = random.randint(3, 7)
        hotspots = []
        for i in range(count):
            lat = random.uniform(bbox["south"], bbox["north"])
            lon = random.uniform(bbox["west"],  bbox["east"])
            risk_score = round(random.uniform(0.2, 0.9), 3)
            risk_level = _score_to_level(risk_score)
            hotspots.append({
                "id":           f"RANDOM-{i + 1:03d}",
                "lat":          round(lat, 6),
                "lon":          round(lon, 6),
                "radiusMeters": random.randint(100, 800),
                "riskScore":    risk_score,
                "riskLevel":    risk_level,
                "incidentType": random.choice(_INCIDENT_TYPES),
                "factors": {
                    "fire":          round(random.uniform(0.1, 0.9), 3),
                    "weather":       round(random.uniform(0.1, 0.9), 3),
                    "terrain":       round(random.uniform(0.1, 0.9), 3),
                    "water":         round(random.uniform(0.1, 0.9), 3),
                    "accessibility": round(random.uniform(0.1, 0.9), 3),
                },
                "description": (
                    f"Randomly generated {risk_level} risk zone for development/demo purposes. "
                    "Replace ACTIVE_MODEL in hotspot_models.py to use a real inference model."
                ),
                "recommendations": [
                    "Increase patrol frequency in this zone",
                    "Verify sensor coverage and alert thresholds",
                ],
            })
        return hotspots


# ---------------------------------------------------------------------------
# Active model — change this one line to swap models
# ---------------------------------------------------------------------------

ACTIVE_MODEL: HotspotModel = RandomHotspotModel()
