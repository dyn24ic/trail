"""
Smoke-test client for the trAIl Nemotron inference server.

Usage:
    # Against a running local or Brev instance:
    INFERENCE_URL=http://localhost:8080 python 03_inference/test_client.py

    # With bearer-token auth (if BREV_API_KEY is set on the server):
    INFERENCE_URL=http://<brev-host>:8080 BREV_API_KEY=<secret> python 03_inference/test_client.py

    # Run a single named test:
    python 03_inference/test_client.py --test health
    python 03_inference/test_client.py --test yosemite_summer
    python 03_inference/test_client.py --test fire_scenario
    python 03_inference/test_client.py --test flood_scenario
    python 03_inference/test_client.py --test empty_conditions
"""
import argparse
import json
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

BASE_URL    = os.getenv("INFERENCE_URL", "http://localhost:8080")
BREV_API_KEY = os.getenv("BREV_API_KEY", "")

YOSEMITE_BBOX = {"south": 37.70, "north": 37.82, "west": -119.62, "east": -119.47}

# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------

def _headers() -> dict:
    if BREV_API_KEY:
        return {"Authorization": f"Bearer {BREV_API_KEY}", "Content-Type": "application/json"}
    return {"Content-Type": "application/json"}


def get_health() -> dict:
    resp = requests.get(f"{BASE_URL}/health", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def post_predict(payload: dict, timeout: int = 300) -> dict:
    resp = requests.post(
        f"{BASE_URL}/predict",
        headers=_headers(),
        json=payload,
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Test payloads
# ---------------------------------------------------------------------------

def _base_payload(conditions: dict | None = None, month: int = 7, hour: int = 14) -> dict:
    return {
        "bbox": YOSEMITE_BBOX,
        "month": month,
        "hour_local": hour,
        "conditions": conditions or {},
        "candidates": [],   # server uses empty list → model reasons from conditions alone
    }


SCENARIOS = {
    "yosemite_summer": _base_payload(
        month=7,
        conditions={
            "weather": {
                "temperature_c": 32.0,
                "windspeed_kmh": 18.0,
                "precipitation_mmhr": 0.0,
                "humidity_pct": 22.0,
                "weathercode": 0,
                "conditions": {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
                "weather_risk_score": 0.28,
            },
            "fire": {
                "danger_rating": "VERY HIGH",
                "danger_score": 0.78,
                "dispatch_level": "High",
                "dispatch_score": 0.6,
                "no_campfire_active": True,
            },
            "hydro": {"flood_severity": "minor", "max_flow_cfs": 350, "flood_alert": False},
            "roads": {"count": 1, "has_closure": False, "types": ["minor_collision"]},
        },
    ),
    "fire_scenario": _base_payload(
        month=8,
        conditions={
            "weather": {
                "temperature_c": 38.0,
                "windspeed_kmh": 45.0,
                "precipitation_mmhr": 0.0,
                "humidity_pct": 12.0,
                "weathercode": 0,
                "conditions": {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
                "weather_risk_score": 0.72,
            },
            "fire": {
                "danger_rating": "EXTREME",
                "danger_score": 0.95,
                "dispatch_level": "Full",
                "dispatch_score": 0.9,
                "no_campfire_active": True,
            },
            "hydro": {"flood_severity": "none", "max_flow_cfs": 80, "flood_alert": False},
            "roads": {"count": 3, "has_closure": True, "types": ["road_closure", "fire_evacuation"]},
            "wildfires_active": [
                {"lat": 37.75, "lon": -119.55, "name": "Test Fire", "acres": 850},
            ],
            "smoke_aqi": 185,
        },
    ),
    "flood_scenario": _base_payload(
        month=5,
        conditions={
            "weather": {
                "temperature_c": 12.0,
                "windspeed_kmh": 25.0,
                "precipitation_mmhr": 8.5,
                "humidity_pct": 90.0,
                "weathercode": 65,
                "conditions": {"fog": False, "storm": False, "heavy_rain": True, "snow": False},
                "weather_risk_score": 0.60,
            },
            "fire": {
                "danger_rating": "LOW",
                "danger_score": 0.12,
                "dispatch_level": "Low",
                "dispatch_score": 0.05,
                "no_campfire_active": False,
            },
            "hydro": {"flood_severity": "major", "max_flow_cfs": 2800, "flood_alert": True},
            "roads": {"count": 2, "has_closure": True, "types": ["road_flood"]},
        },
    ),
    "empty_conditions": _base_payload(
        month=11,
        conditions={},
    ),
}


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

VALID_RISK_LEVELS   = {"low", "moderate", "high", "extreme"}
VALID_INCIDENT_TYPES = {
    "fall", "drowning", "medical", "vehicle", "rockfall",
    "lightning", "search_rescue", "fire_related", "unknown",
}


def validate_response(data: dict, scenario_name: str) -> bool:
    ok = True
    hotspots = data.get("hotspots", [])

    if not isinstance(hotspots, list):
        log.error("[%s] 'hotspots' is not a list", scenario_name)
        return False

    for i, h in enumerate(hotspots):
        tag = f"[{scenario_name}] hotspot[{i}]"

        if not (-90 <= h.get("lat", 0) <= 90):
            log.error("%s: lat out of range: %s", tag, h.get("lat"))
            ok = False
        if not (-180 <= h.get("lon", 0) <= 180):
            log.error("%s: lon out of range: %s", tag, h.get("lon"))
            ok = False
        if not (0.0 <= h.get("riskScore", -1) <= 1.0):
            log.error("%s: riskScore out of [0,1]: %s", tag, h.get("riskScore"))
            ok = False
        if h.get("riskLevel") not in VALID_RISK_LEVELS:
            log.error("%s: invalid riskLevel: %s", tag, h.get("riskLevel"))
            ok = False
        if h.get("incidentType") not in VALID_INCIDENT_TYPES:
            log.error("%s: unknown incidentType: %s", tag, h.get("incidentType"))
            ok = False
        factors = h.get("factors", {})
        for key in ("fire", "weather", "terrain", "water", "accessibility"):
            v = factors.get(key, -1)
            if not (0.0 <= v <= 1.0):
                log.error("%s: factor[%s] out of [0,1]: %s", tag, key, v)
                ok = False

    return ok


# ---------------------------------------------------------------------------
# Test runner
# ---------------------------------------------------------------------------

def run_health_check():
    log.info("── Health check ──────────────────────────────────────")
    t0 = time.time()
    data = get_health()
    log.info("Response (%.1f s): %s", time.time() - t0, json.dumps(data))
    assert data.get("status") == "ok", f"Unexpected health status: {data}"
    log.info("PASS")


def run_predict_scenario(name: str):
    log.info("── Scenario: %-30s ──────────────", name)
    payload = SCENARIOS[name]
    t0 = time.time()
    try:
        data = post_predict(payload)
    except requests.HTTPError as exc:
        log.error("HTTP %s: %s", exc.response.status_code, exc.response.text[:500])
        return False

    elapsed = time.time() - t0
    hotspots = data.get("hotspots", [])
    log.info(
        "%.1f s  |  hotspots: %d  |  model: %s",
        elapsed, len(hotspots), data.get("modelVersion", "?"),
    )

    if hotspots:
        for h in hotspots[:3]:
            log.info(
                "  → %-12s  lat=%.4f  lon=%.4f  score=%.2f  level=%-8s  type=%s",
                h.get("id", "?"), h.get("lat", 0), h.get("lon", 0),
                h.get("riskScore", 0), h.get("riskLevel", "?"),
                h.get("incidentType", "?"),
            )
    else:
        log.info("  (no hotspots predicted)")

    valid = validate_response(data, name)
    log.info("  Validation: %s", "PASS" if valid else "FAIL")
    return valid


def main():
    parser = argparse.ArgumentParser(description="Smoke-test the trAIl inference server")
    parser.add_argument(
        "--test",
        default="all",
        choices=["all", "health"] + list(SCENARIOS.keys()),
        help="Which test to run (default: all)",
    )
    args = parser.parse_args()

    log.info("Target: %s", BASE_URL)

    failures = []

    if args.test in ("all", "health"):
        try:
            run_health_check()
        except Exception as exc:
            log.error("Health check FAILED: %s", exc)
            failures.append("health")
            if args.test == "health":
                sys.exit(1)

    tests_to_run = list(SCENARIOS.keys()) if args.test == "all" else (
        [] if args.test == "health" else [args.test]
    )

    for name in tests_to_run:
        try:
            ok = run_predict_scenario(name)
            if not ok:
                failures.append(name)
        except Exception as exc:
            log.error("Scenario '%s' raised exception: %s", name, exc)
            failures.append(name)

    if failures:
        log.error("\nFAILED tests: %s", failures)
        sys.exit(1)
    else:
        log.info("\nAll tests PASSED")


if __name__ == "__main__":
    main()
