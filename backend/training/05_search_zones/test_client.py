"""
Smoke-test client for the trAIl Nemotron search zone prediction server.

Usage:
    # Against a running local or Brev instance:
    BREV_SEARCH_ZONE_URL=http://localhost:8081 python 05_search_zones/test_client.py

    # With bearer-token auth:
    BREV_SEARCH_ZONE_URL=http://<brev-host>:8081 BREV_API_KEY=<secret> \
        python 05_search_zones/test_client.py

    # Run a single named test:
    python 05_search_zones/test_client.py --test health
    python 05_search_zones/test_client.py --test sensor_anomaly_fire
    python 05_search_zones/test_client.py --test overdue_hiker
    python 05_search_zones/test_client.py --test call_box_vehicle
    python 05_search_zones/test_client.py --test low_risk_empty
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

BASE_URL     = os.getenv("BREV_SEARCH_ZONE_URL", "http://localhost:8081")
BREV_API_KEY = os.getenv("BREV_API_KEY", "")

# Yosemite area coordinates
_YOSE_LAT = 37.745
_YOSE_LNG = -119.523


# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------

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
        f"{BASE_URL}/predict_zones",
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
    "sensor_anomaly_fire": {
        "trigger_type":   "SensorAnomaly",
        "lat":            _YOSE_LAT,
        "lng":            _YOSE_LNG,
        "trigger_payload": {"sensorId": "SENSOR-1042", "anomalyType": "motion_audio"},
        "month":          8,
        "hour_local":     14,
        "weather": {
            "temperature_c":      38.0,
            "windspeed_kmh":      45.0,
            "weather_risk_score": 0.72,
            "conditions":         {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
        },
        "fire": {
            "danger_rating": "EXTREME",
            "danger_score":  0.95,
        },
        "hydro": {"flood_severity": "none"},
        "incident_type_context": "fall",
    },
    "overdue_hiker": {
        "trigger_type":   "OverdueHiker",
        "lat":            37.730,
        "lng":            -119.540,
        "trigger_payload": {
            "hikerId":        "HIKER-3312",
            "trailId":        "half-dome-cables",
            "overdueMinutes": 240,
            "lastKnownLat":   37.730,
            "lastKnownLng":   -119.540,
        },
        "month":          7,
        "hour_local":     18,
        "weather": {
            "temperature_c":      22.0,
            "windspeed_kmh":      15.0,
            "weather_risk_score": 0.35,
            "conditions":         {"fog": False, "storm": True, "heavy_rain": False, "snow": False},
        },
        "fire": {"danger_rating": "HIGH", "danger_score": 0.62},
        "hydro": {"flood_severity": "none"},
        "incident_type_context": "search_rescue",
    },
    "call_box_vehicle": {
        "trigger_type":   "CallBox",
        "lat":            37.760,
        "lng":            -119.500,
        "trigger_payload": {"deviceId": "BOX-042"},
        "month":          10,
        "hour_local":     21,
        "weather": {
            "temperature_c":      10.0,
            "windspeed_kmh":      30.0,
            "weather_risk_score": 0.50,
            "conditions":         {"fog": True, "storm": False, "heavy_rain": False, "snow": False},
        },
        "fire": {"danger_rating": "LOW", "danger_score": 0.12},
        "hydro": {"flood_severity": "none"},
        "incident_type_context": "vehicle",
    },
    "flood_drowning": {
        "trigger_type":   "SensorAnomaly",
        "lat":            37.738,
        "lng":            -119.560,
        "trigger_payload": {"sensorId": "SENSOR-0088", "anomalyType": "audio"},
        "month":          5,
        "hour_local":     11,
        "weather": {
            "temperature_c":      14.0,
            "windspeed_kmh":      20.0,
            "weather_risk_score": 0.58,
            "conditions":         {"fog": False, "storm": False, "heavy_rain": True, "snow": False},
        },
        "fire": {"danger_rating": "LOW", "danger_score": 0.10},
        "hydro": {"flood_severity": "major"},
        "incident_type_context": "drowning",
    },
    "low_risk_empty": {
        "trigger_type":   "Emergency911",
        "lat":            _YOSE_LAT,
        "lng":            _YOSE_LNG,
        "trigger_payload": {"callId": "E911-9999", "callerDescription": "Pocket dial, all clear."},
        "month":          11,
        "hour_local":     10,
        "weather": {
            "temperature_c":      8.0,
            "windspeed_kmh":      5.0,
            "weather_risk_score": 0.05,
            "conditions":         {"fog": False, "storm": False, "heavy_rain": False, "snow": False},
        },
        "fire": {"danger_rating": "LOW", "danger_score": 0.05},
        "hydro": {"flood_severity": "none"},
        "incident_type_context": "unknown",
    },
}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_response(data: dict, scenario: str) -> bool:
    ok = True
    zones = data.get("search_zones", [])

    if not isinstance(zones, list):
        log.error("[%s] 'search_zones' is not a list", scenario)
        return False

    for i, z in enumerate(zones):
        tag = f"[{scenario}] zone[{i}]"
        if not (-90 <= z.get("lat", 0) <= 90):
            log.error("%s: lat out of range: %s", tag, z.get("lat"))
            ok = False
        if not (-180 <= z.get("lng", 0) <= 180):
            log.error("%s: lng out of range: %s", tag, z.get("lng"))
            ok = False
        if not (0.0 <= z.get("confidence", -1) <= 1.0):
            log.error("%s: confidence out of [0,1]: %s", tag, z.get("confidence"))
            ok = False
        if not (50 <= z.get("radiusMeters", 0) <= 2000):
            log.error("%s: radiusMeters out of [50, 2000]: %s", tag, z.get("radiusMeters"))
            ok = False

    # Zones should be ordered by confidence descending
    confs = [z.get("confidence", 0) for z in zones]
    if confs != sorted(confs, reverse=True):
        log.warning("[%s] zones not sorted by confidence descending: %s", scenario, confs)

    return ok


# ---------------------------------------------------------------------------
# Test runners
# ---------------------------------------------------------------------------

def run_health_check():
    log.info("── Health check ──────────────────────────────────────")
    t0 = time.time()
    data = get_health()
    log.info("Response (%.1f s): %s", time.time() - t0, json.dumps(data))
    assert data.get("status") == "ok", f"Unexpected health status: {data}"
    log.info("PASS")


def run_predict_scenario(name: str) -> bool:
    log.info("── Scenario: %-30s ──────────────", name)
    payload = SCENARIOS[name]
    t0 = time.time()
    try:
        data = post_predict(payload)
    except requests.HTTPError as exc:
        log.error("HTTP %s: %s", exc.response.status_code, exc.response.text[:500])
        return False

    elapsed = time.time() - t0
    zones   = data.get("search_zones", [])
    log.info(
        "%.1f s  |  zones: %d  |  model: %s",
        elapsed, len(zones), data.get("model_version", "?"),
    )

    for z in zones[:3]:
        log.info(
            "  → lat=%.4f  lng=%.4f  r=%.0f m  conf=%.2f  %s",
            z.get("lat", 0), z.get("lng", 0),
            z.get("radiusMeters", 0), z.get("confidence", 0),
            z.get("reasoning", "")[:60],
        )

    if not zones:
        log.info("  (no search zones predicted — expected for low-risk scenario)")

    valid = validate_response(data, name)
    log.info("  Validation: %s", "PASS" if valid else "FAIL")
    return valid


def main():
    parser = argparse.ArgumentParser(description="Smoke-test the trAIl search zone server")
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
