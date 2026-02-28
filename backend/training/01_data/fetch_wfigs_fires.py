"""
Fetch historical wildfire incident locations from the NIFC WFIGS ArcGIS service.

Service: WFIGS_Incident_Locations_Current (also contains historical data)
URL: https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0

Filters: California state + geographic bbox expanded around Yosemite / Sierra Nevada.
Since we want training data for generalisation, we use a broader bbox (not just Yosemite)
but include a park_region column for downstream filtering.

Output: 01_data/output/wfigs_fires.csv
Columns: name, lat, lon, incident_type_category, final_acres, fire_cause,
         fire_cause_general, discovered_dt, percent_contained, park_region

Run:
    python 01_data/fetch_wfigs_fires.py
"""
import csv
import json
import logging
import time
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

WFIGS_URL = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services"
    "/WFIGS_Incident_Locations_Current/FeatureServer/0/query"
)

# Expanded Sierra Nevada / Yosemite region for richer training data
SIERRA_BBOX = {
    "xmin": -120.5,
    "ymin": 36.5,
    "xmax": -118.5,
    "ymax": 38.5,
}

# Tight Yosemite bbox for park_region labelling
YOSE_BBOX = {
    "south": 37.49, "north": 38.19,
    "west": -119.89, "east": -119.19,
}

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_FILE = OUTPUT_DIR / "wfigs_fires.csv"

FIELDS = [
    "IncidentName",
    "InitialLatitude", "InitialLongitude",
    "IncidentTypeCategory", "IncidentTypeKind",
    "FinalAcres", "DiscoveryAcres",
    "FireCause", "FireCauseGeneral",
    "FireDiscoveryDateTime",
    "PercentContained",
    "POOState", "POOCounty", "POOLandownerCategory",
]

PAGE_SIZE = 1000  # ArcGIS default max


def in_yosemite(lat: float, lon: float) -> bool:
    return (
        YOSE_BBOX["south"] <= lat <= YOSE_BBOX["north"]
        and YOSE_BBOX["west"] <= lon <= YOSE_BBOX["east"]
    )


def fetch_page(offset: int, session: requests.Session) -> list[dict]:
    geometry = json.dumps({
        "xmin": SIERRA_BBOX["xmin"], "ymin": SIERRA_BBOX["ymin"],
        "xmax": SIERRA_BBOX["xmax"], "ymax": SIERRA_BBOX["ymax"],
        "spatialReference": {"wkid": 4326},
    })
    params = {
        "where": "1=1",
        "geometry": geometry,
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": ",".join(FIELDS),
        "returnGeometry": "false",
        "resultOffset": offset,
        "resultRecordCount": PAGE_SIZE,
        "orderByFields": "FireDiscoveryDateTime DESC",
        "f": "json",
    }
    resp = session.get(WFIGS_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"ArcGIS error: {data['error']}")
    return data.get("features", [])


def parse_feature(feat: dict) -> dict | None:
    attrs = feat.get("attributes", {})
    lat = attrs.get("InitialLatitude")
    lon = attrs.get("InitialLongitude")
    if lat is None or lon is None:
        return None
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None

    # Convert epoch ms to ISO date string if present
    disc_raw = attrs.get("FireDiscoveryDateTime")
    discovered_dt = ""
    if disc_raw is not None:
        try:
            from datetime import datetime, timezone
            discovered_dt = datetime.fromtimestamp(disc_raw / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            discovered_dt = str(disc_raw)

    return {
        "name": attrs.get("IncidentName", ""),
        "lat": lat,
        "lon": lon,
        "incident_type_category": attrs.get("IncidentTypeCategory", ""),
        "incident_type_kind": attrs.get("IncidentTypeKind", ""),
        "final_acres": attrs.get("FinalAcres") or attrs.get("DiscoveryAcres") or 0,
        "fire_cause": attrs.get("FireCause", ""),
        "fire_cause_general": attrs.get("FireCauseGeneral", ""),
        "discovered_dt": discovered_dt,
        "percent_contained": attrs.get("PercentContained") or 0,
        "poo_state": attrs.get("POOState", ""),
        "poo_county": attrs.get("POOCounty", ""),
        "landowner_category": attrs.get("POOLandownerCategory", ""),
        "park_region": "yosemite" if in_yosemite(lat, lon) else "sierra",
    }


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = "trAIl-data-pipeline/1.0"

    all_records: list[dict] = []
    offset = 0

    log.info("Fetching WFIGS fires in Sierra Nevada / Yosemite bbox...")
    while True:
        log.info("  Fetching offset %d ...", offset)
        try:
            features = fetch_page(offset, session)
        except Exception as exc:
            log.warning("  Fetch failed at offset %d: %s", offset, exc)
            break

        if not features:
            break

        for feat in features:
            record = parse_feature(feat)
            if record:
                all_records.append(record)

        log.info("  Got %d features (total so far: %d)", len(features), len(all_records))
        if len(features) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.3)

    yose_count = sum(1 for r in all_records if r["park_region"] == "yosemite")
    log.info("Total fires fetched: %d (%d in Yosemite bbox)", len(all_records), yose_count)

    fieldnames = [
        "name", "lat", "lon", "incident_type_category", "incident_type_kind",
        "final_acres", "fire_cause", "fire_cause_general", "discovered_dt",
        "percent_contained", "poo_state", "poo_county", "landowner_category", "park_region",
    ]
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_records)

    log.info("Written to %s", OUTPUT_FILE)


if __name__ == "__main__":
    main()
