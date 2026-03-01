"""
Fetch Yosemite road incident locations from NPS ArcGIS FeatureServer.

Service: YOSE_TRANS_Road_Incidents
URL: https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_TRANS_Road_Incidents/FeatureServer

Steps:
  1. Discover the layer schema (field names/types) via /0?f=json
  2. Paginate through /0/query to retrieve all features
  3. Extract coordinates (from geometry or lat/lon attribute fields)
  4. Map raw incident type string → our incidentType taxonomy
  5. Filter to Yosemite bbox

Output: 01_data/output/road_incidents.csv
  date, lat, lon, incident_type, road_name, severity, description, raw_type
"""
import csv
import datetime
import json
import logging
import time
from pathlib import Path
from typing import Optional

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

BASE_URL  = "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_TRANS_Road_Incidents/FeatureServer"
LAYER_ID  = 0
PAGE_SIZE = 1000
TIMEOUT   = 60

OUTPUT_DIR  = Path(__file__).parent / "output"
OUTPUT_FILE = OUTPUT_DIR / "road_incidents.csv"

# Expanded Yosemite + approach roads bbox
YOSEMITE_BBOX = {
    "south": 37.50, "north": 38.20,
    "west": -120.00, "east": -119.00,
}


# ---------------------------------------------------------------------------
# Schema discovery
# ---------------------------------------------------------------------------

def discover_schema() -> dict:
    """Return the FeatureServer layer metadata (fields, geometry type, name)."""
    url = f"{BASE_URL}/{LAYER_ID}"
    resp = requests.get(url, params={"f": "json"}, timeout=30)
    resp.raise_for_status()
    meta = resp.json()
    log.info("Layer: %s  |  Geometry: %s  |  Fields: %d",
             meta.get("name", "?"),
             meta.get("geometryType", "?"),
             len(meta.get("fields", [])))
    return meta


def _find_field(fields: list[str], *keywords: str) -> Optional[str]:
    """Case-insensitive search for the first field whose name contains any keyword."""
    for kw in keywords:
        for f in fields:
            if kw.lower() in f.lower():
                return f
    return None


# ---------------------------------------------------------------------------
# Incident type classification
# ---------------------------------------------------------------------------

_TYPE_MAP = {
    # Vehicle / road
    "vehicle":   ["vehicle", "mvr", "car", "truck", "collision", "crash", "auto", "accident"],
    "fire_related": ["fire", "smoke"],
    "medical":   ["medical", "cardiac", "heart", "ems", "illness", "injury"],
    "drowning":  ["drown", "water", "flood", "swim"],
    "fall":      ["fall", "cliff", "ledge", "slip"],
    "rockfall":  ["rock", "boulder", "slide"],
    "lightning": ["lightning", "strike"],
    "search_rescue": ["search", "missing", "rescue", "lost", "overdue"],
}


def classify_incident_type(raw_value: str) -> str:
    """Map a raw ArcGIS field string to our incidentType taxonomy."""
    raw = raw_value.lower()
    for itype, keywords in _TYPE_MAP.items():
        if any(kw in raw for kw in keywords):
            return itype
    # Default for road-incident service
    return "vehicle"


# ---------------------------------------------------------------------------
# Feature fetch
# ---------------------------------------------------------------------------

def _epoch_ms_to_date(epoch_ms) -> str:
    try:
        return datetime.datetime.utcfromtimestamp(float(epoch_ms) / 1000).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return ""


def fetch_all_features(schema: dict) -> list[dict]:
    """Paginate through the FeatureServer and return normalised incident rows."""
    field_names = [f["name"] for f in schema.get("fields", [])]
    field_types = {f["name"]: f.get("type", "") for f in schema.get("fields", [])}

    # Identify useful fields by keyword matching
    lat_field   = _find_field(field_names, "latitude",  "lat",  "y_coord")
    lon_field   = _find_field(field_names, "longitude", "lon",  "x_coord")
    date_field  = _find_field(field_names, "incidentdate", "reportdate", "date", "datetime")
    type_field  = _find_field(field_names, "incidenttype", "type", "category", "class")
    road_field  = _find_field(field_names, "road", "location", "route", "street")
    sev_field   = _find_field(field_names, "severity", "serious", "fatal", "injury")
    desc_field  = _find_field(field_names, "description", "comment", "narrative", "notes", "remarks")

    log.info(
        "Field mapping — lat:%s  lon:%s  date:%s  type:%s  road:%s  sev:%s  desc:%s",
        lat_field, lon_field, date_field, type_field, road_field, sev_field, desc_field,
    )

    query_url = f"{BASE_URL}/{LAYER_ID}/query"
    all_rows: list[dict] = []
    offset = 0

    while True:
        params = {
            "f":                 "json",
            "where":             "1=1",
            "outFields":         "*",
            "returnGeometry":    "true",
            "outSR":             "4326",
            "resultOffset":      offset,
            "resultRecordCount": PAGE_SIZE,
        }

        try:
            resp = requests.get(query_url, params=params, timeout=TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.error("Page at offset=%d failed: %s", offset, exc)
            break

        features = data.get("features", [])
        if not features:
            break

        for feat in features:
            attrs = feat.get("attributes") or {}
            geom  = feat.get("geometry") or {}

            # ── Coordinates ──────────────────────────────────────────────
            lat = lon = None
            if lat_field and lon_field:
                try:
                    lat = float(attrs[lat_field])
                    lon = float(attrs[lon_field])
                except (KeyError, TypeError, ValueError):
                    pass
            # Fall back to geometry x/y
            if lat is None and geom:
                try:
                    lon = float(geom.get("x", 0))
                    lat = float(geom.get("y", 0))
                except (TypeError, ValueError):
                    pass

            if lat is None or lat == 0.0:
                continue

            # Filter to Yosemite region
            if not (YOSEMITE_BBOX["south"] <= lat <= YOSEMITE_BBOX["north"]
                    and YOSEMITE_BBOX["west"] <= lon <= YOSEMITE_BBOX["east"]):
                continue

            # ── Date ─────────────────────────────────────────────────────
            date_val = attrs.get(date_field, "") if date_field else ""
            if date_field and field_types.get(date_field) in ("esriFieldTypeDate",):
                date_str = _epoch_ms_to_date(date_val)
            elif isinstance(date_val, (int, float)) and date_val > 1_000_000_000:
                date_str = _epoch_ms_to_date(date_val)
            else:
                date_str = str(date_val)[:10] if date_val else ""

            # ── Type ─────────────────────────────────────────────────────
            raw_type = str(attrs.get(type_field, "")) if type_field else ""
            incident_type = classify_incident_type(raw_type)

            all_rows.append({
                "date":          date_str,
                "lat":           round(lat, 6),
                "lon":           round(lon, 6),
                "incident_type": incident_type,
                "road_name":     str(attrs.get(road_field, "")) if road_field else "",
                "severity":      str(attrs.get(sev_field, "")) if sev_field else "",
                "description":   str(attrs.get(desc_field, "")) if desc_field else "",
                "raw_type":      raw_type,
            })

        fetched_so_far = offset + len(features)
        log.info("Fetched %d features (total so far: %d)", len(features), fetched_so_far)
        offset += PAGE_SIZE

        if not data.get("exceededTransferLimit", False):
            break
        time.sleep(0.3)

    return all_rows


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    log.info("Discovering schema for YOSE_TRANS_Road_Incidents FeatureServer …")
    try:
        schema = discover_schema()
    except Exception as exc:
        log.error("Schema discovery failed: %s", exc)
        return

    log.info("Fetching all road incident features …")
    rows = fetch_all_features(schema)

    if not rows:
        log.warning("No road incidents found in Yosemite bbox. Service may be empty or require auth.")
        return

    fieldnames = ["date", "lat", "lon", "incident_type", "road_name", "severity", "description", "raw_type"]
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    log.info("Wrote %d road incidents to %s", len(rows), OUTPUT_FILE)

    # Summary
    from collections import Counter
    type_counts = Counter(r["incident_type"] for r in rows)
    year_counts = Counter(r["date"][:4] for r in rows if len(r["date"]) >= 4)
    log.info("Type breakdown: %s", dict(type_counts.most_common()))
    log.info("Year range: %s – %s", min(year_counts), max(year_counts))


if __name__ == "__main__":
    main()
