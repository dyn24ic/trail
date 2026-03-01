"""
Smoke-test client for the trAIl Nemotron responder route optimization server.

Usage:
    BREV_ROUTE_URL=http://localhost:8082 python 06_responder_routing/test_client.py

    # With auth:
    BREV_ROUTE_URL=http://<brev-host>:8082 BREV_API_KEY=<secret> \
        python 06_responder_routing/test_client.py

    # Single test:
    python 06_responder_routing/test_client.py --test health
    python 06_responder_routing/test_client.py --test severe_fall
    python 06_responder_routing/test_client.py --test helicopter_cardiac
    python 06_responder_routing/test_client.py --test ground_drowning
    python 06_responder_routing/test_client.py --test minor_sprain
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

BASE_URL     = os.getenv("BREV_ROUTE_URL", "http://localhost:8082")
BREV_API_KEY = os.getenv("BREV_API_KEY", "")

# Yosemite Happy Isles trailhead → Half Dome area victim
_TH_LAT, _TH_LNG  = 37.7329, -119.5578
_VIC_LAT, _VIC_LNG = 37.7460, -119.5020   # ~5 km away on Half Dome trail


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if BREV_API_KEY:
        h["Authorization"] = f"Bearer {BREV_API_KEY}"
    return h


def get_health() -> dict:
    resp = requests.get(f"{BASE_URL}/health", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def post_predict(payload: dict, timeout: int = 300) -> dict:
    resp = requests.post(
        f"{BASE_URL}/predict_route",
        headers=_headers(),
        json=payload,
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Test payloads
# ---------------------------------------------------------------------------

SCENARIOS = {
    "severe_fall": {
        "trailhead_name": "Happy Isles Trailhead",
        "trailhead_lat":  _TH_LAT,
        "trailhead_lng":  _TH_LNG,
        "victim_lat":     _VIC_LAT,
        "victim_lng":     _VIC_LNG,
        "distance_km":    5.1,
        "month":          8,
        "hour_local":     14,
        "triage": {
            "severity":                     "Severe",
            "injuryType":                   "Head trauma",
            "consciousAndResponsive":        False,
            "recommendedResponse":          "Immediate helicopter evacuation, paramedic response",
            "estimatedMedicalUrgencyMinutes": 15,
        },
        "weather": {
            "temperature_c":      30.0,
            "windspeed_kmh":      15.0,
            "weather_risk_score": 0.25,
            "conditions":         {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
        },
        "terrain": {"slope_deg": 35, "elevation_m": 2400},
    },
    "helicopter_cardiac": {
        "trailhead_name": "Yosemite Valley Trailhead",
        "trailhead_lat":  37.7459,
        "trailhead_lng": -119.5332,
        "victim_lat":    37.7600,
        "victim_lng":   -119.5100,
        "distance_km":   3.2,
        "month":          7,
        "hour_local":     11,
        "triage": {
            "severity":                      "Severe",
            "injuryType":                    "Cardiac event",
            "consciousAndResponsive":        False,
            "recommendedResponse":           "Immediate helicopter evacuation, paramedic response",
            "estimatedMedicalUrgencyMinutes": 15,
        },
        "weather": {
            "temperature_c":      28.0,
            "windspeed_kmh":      8.0,
            "weather_risk_score": 0.12,
            "conditions":         {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
        },
        "terrain": {"slope_deg": 10, "elevation_m": 1200},
    },
    "ground_drowning": {
        "trailhead_name": "Happy Isles Trailhead",
        "trailhead_lat":  _TH_LAT,
        "trailhead_lng":  _TH_LNG,
        "victim_lat":     37.7260,
        "victim_lng":    -119.5530,
        "distance_km":   0.8,
        "month":          5,
        "hour_local":     16,
        "triage": {
            "severity":                      "Severe",
            "injuryType":                    "Hypothermia",
            "consciousAndResponsive":        True,
            "recommendedResponse":           "Immediate helicopter evacuation, paramedic response",
            "estimatedMedicalUrgencyMinutes": 15,
        },
        "weather": {
            "temperature_c":      11.0,
            "windspeed_kmh":      22.0,
            "weather_risk_score": 0.55,
            "conditions":         {"fog": False, "storm": False, "heavy_rain": True, "snow": False},
        },
        "terrain": {"slope_deg": 5, "elevation_m": 1200},
    },
    "storm_ground_only": {
        "trailhead_name": "Tuolumne Meadows Trailhead",
        "trailhead_lat":  37.8739,
        "trailhead_lng": -119.3637,
        "victim_lat":    37.8850,
        "victim_lng":   -119.3500,
        "distance_km":   1.7,
        "month":          7,
        "hour_local":     15,
        "triage": {
            "severity":                      "Severe",
            "injuryType":                    "Cardiac event",
            "consciousAndResponsive":        True,
            "recommendedResponse":           "Immediate helicopter evacuation, paramedic response",
            "estimatedMedicalUrgencyMinutes": 15,
        },
        "weather": {
            "temperature_c":      10.0,
            "windspeed_kmh":      85.0,   # too high for helicopter
            "weather_risk_score": 0.80,
            "conditions":         {"fog": False, "storm": True, "heavy_rain": True, "snow": False},
        },
        "terrain": {"slope_deg": 8, "elevation_m": 2600},
    },
    "minor_sprain": {
        "trailhead_name": "Glacier Point Road Trailhead",
        "trailhead_lat":  37.7272,
        "trailhead_lng": -119.5738,
        "victim_lat":    37.7350,
        "victim_lng":   -119.5680,
        "distance_km":   1.1,
        "month":          9,
        "hour_local":     10,
        "triage": {
            "severity":                      "Minor",
            "injuryType":                    "Sprained ankle",
            "consciousAndResponsive":        True,
            "recommendedResponse":           "First aid on scene, walk-out capable",
            "estimatedMedicalUrgencyMinutes": 90,
        },
        "weather": {
            "temperature_c":      18.0,
            "windspeed_kmh":      10.0,
            "weather_risk_score": 0.08,
            "conditions":         {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
        },
        "terrain": {"slope_deg": 12, "elevation_m": 2100},
    },
}

VALID_ACCESS_TYPES = {"helicopter", "ground", "boat"}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_response(data: dict, scenario: str) -> bool:
    ok = True

    if data.get("accessType") not in VALID_ACCESS_TYPES:
        log.error("[%s] invalid accessType: %s", scenario, data.get("accessType"))
        ok = False

    if not (data.get("totalDistanceMeters", 0) > 0):
        log.error("[%s] totalDistanceMeters not positive: %s", scenario, data.get("totalDistanceMeters"))
        ok = False

    if not (data.get("totalEtaMinutes", 0) > 0):
        log.error("[%s] totalEtaMinutes not positive: %s", scenario, data.get("totalEtaMinutes"))
        ok = False

    steps = data.get("steps", [])
    if not steps:
        log.error("[%s] no steps returned", scenario)
        ok = False

    for i, step in enumerate(steps):
        tag = f"[{scenario}] step[{i}]"
        if step.get("stepNumber") != i + 1:
            log.warning("%s: stepNumber %s (expected %d)", tag, step.get("stepNumber"), i + 1)
        if not step.get("description"):
            log.error("%s: empty description", tag)
            ok = False
        if step.get("distanceMeters", -1) < 0:
            log.error("%s: distanceMeters negative: %s", tag, step.get("distanceMeters"))
            ok = False
        if step.get("estimatedMinutes", 0) <= 0:
            log.error("%s: estimatedMinutes not positive: %s", tag, step.get("estimatedMinutes"))
            ok = False

    # Storm scenario should not return helicopter
    if scenario == "storm_ground_only" and data.get("accessType") == "helicopter":
        log.warning("[%s] returned helicopter despite storm/high wind — model may not have learned weather constraints", scenario)

    return ok


# ---------------------------------------------------------------------------
# Test runners
# ---------------------------------------------------------------------------

def run_health_check():
    log.info("── Health check ──────────────────────────────────────")
    t0   = time.time()
    data = get_health()
    log.info("Response (%.1f s): %s", time.time() - t0, json.dumps(data))
    assert data.get("status") == "ok", f"Unexpected status: {data}"
    log.info("PASS")


def run_predict_scenario(name: str) -> bool:
    log.info("── Scenario: %-30s ──────────────", name)
    t0 = time.time()
    try:
        data = post_predict(SCENARIOS[name])
    except requests.HTTPError as exc:
        log.error("HTTP %s: %s", exc.response.status_code, exc.response.text[:500])
        return False

    elapsed = time.time() - t0
    steps   = data.get("steps", [])
    log.info(
        "%.1f s  |  access=%-12s  dist=%.0f m  eta=%d min  steps=%d  model=%s",
        elapsed,
        data.get("accessType", "?"),
        data.get("totalDistanceMeters", 0),
        data.get("totalEtaMinutes", 0),
        len(steps),
        data.get("model_version", "?"),
    )
    for s in steps:
        hazards = ", ".join(s.get("hazards", [])) or "—"
        log.info(
            "  [%d] %-55s  %3d min  hazards: %s",
            s.get("stepNumber", 0),
            s.get("description", "")[:55],
            s.get("estimatedMinutes", 0),
            hazards[:60],
        )
    log.info("  Notes: %s", data.get("notes", "")[:120])

    valid = validate_response(data, name)
    log.info("  Validation: %s", "PASS" if valid else "FAIL")
    return valid


def main():
    parser = argparse.ArgumentParser(description="Smoke-test the trAIl route optimizer server")
    parser.add_argument(
        "--test",
        default="all",
        choices=["all", "health"] + list(SCENARIOS.keys()),
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
            log.error("Scenario '%s' raised: %s", name, exc)
            failures.append(name)

    if failures:
        log.error("\nFAILED: %s", failures)
        sys.exit(1)
    else:
        log.info("\nAll tests PASSED")


if __name__ == "__main__":
    main()
