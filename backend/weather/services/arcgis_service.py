"""
ArcGIS FeatureServer client for Yosemite NPS data layers.

All services are public (no auth required). Each fetcher is independent and
designed to fail gracefully — a single unavailable layer never blocks the pipeline.

ArcGIS query pattern:
    {serviceUrl}/query?where=1%3D1&outFields=*&f=json&resultRecordCount=N
    For spatial (bbox) queries, add geometry + geometryType + spatialRel + inSR + outSR.

Key field names (verified against live services 2026-02-28):
    Fire danger (poly):   FDR, FDRANAME, AVGERC, AVGBI
    Dispatch levels (tbl): DISPLEVEL (Low/Medium/High), FDRANUM, UPDTTIME
    Road incidents (line): incident_type, incident_category, vehicle_impact
    Smoke forecast (pt):  HR24AQI, HR24PM25, INTERVAL1SLC, LATITUDE, LONGITUDE
    Stream gage data (tbl/3): FLOW (cfs), RIVSTG (ft), MINFLDSTG, MODFLDSTG, MAJFLDSTG
"""
import json
import logging
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)

TIMEOUT_SEC = 10

# ---------------------------------------------------------------------------
# Service URL constants
# ---------------------------------------------------------------------------
_BASE = "https://services1.arcgis.com/fBc8EJBxQRMcHlei"

URLS = {
    "fire_danger":      f"{_BASE}/ArcGIS/rest/services/YOSE_FIRE_FDRA2023andFireDangerRatings_view/FeatureServer/0",
    "fire_dispatch":    f"{_BASE}/arcgis/rest/services/YOSE_FIRE_FDRA2023DispatchLevels_tbl/FeatureServer/1",
    "road_incidents":   f"{_BASE}/arcgis/rest/services/YOSE_TRANS_Road_Incidents/FeatureServer/0",
    "smoke_forecast":   f"{_BASE}/arcgis/rest/services/YOSE_AIR_SmokeForecast_pt/FeatureServer/0",
    "no_campfire":      f"{_BASE}/arcgis/rest/services/YOSE_BND_NoFireZone/FeatureServer/0",
    "stream_gage_data": f"{_BASE}/arcgis/rest/services/YOSE_HYDRO_StreamGageData_tbl/FeatureServer/3",
    "stream_gage_pts":  f"{_BASE}/arcgis/rest/services/YOSE_HYDRO_StreamGages_pt/FeatureServer/0",
    "forest_health":    f"{_BASE}/arcgis/rest/services/YOSE_LAND_ForestHealth2022_pt/FeatureServer/0",
}

# Fire dispatch level string → normalised risk multiplier
_DISPATCH_RISK = {"low": 0.2, "medium": 0.5, "high": 0.8}

# Fire danger rating string → normalised risk score
_FDR_RISK = {
    "low": 0.1, "moderate": 0.3, "high": 0.6, "very high": 0.8, "extreme": 1.0,
}


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

def _bbox_geometry(bbox: dict) -> str:
    """Encode a {south, north, west, east} dict as an ArcGIS geometry JSON string."""
    return json.dumps({
        "xmin": bbox["west"],
        "ymin": bbox["south"],
        "xmax": bbox["east"],
        "ymax": bbox["north"],
        "spatialReference": {"wkid": 4326},
    })


def _query(url: str, params: dict) -> list[dict[str, Any]]:
    """
    Execute an ArcGIS FeatureServer query and return the features list.
    Returns [] on any error (404, service error, network timeout, etc.).

    Note: ArcGIS may return HTTP 200 with an 'error' body — this is handled explicitly.
    """
    base_params = {
        "f": "json",
        "outFields": "*",
        "resultRecordCount": 100,
        "where": "1=1",
    }
    base_params.update(params)

    try:
        resp = requests.get(f"{url}/query", params=base_params, timeout=TIMEOUT_SEC)
        resp.raise_for_status()
        data = resp.json()

        # ArcGIS returns HTTP 200 but embeds an error object for invalid queries
        if "error" in data:
            logger.warning("ArcGIS service error from %s: %s", url, data["error"])
            return []

        return data.get("features", [])

    except Exception as exc:
        logger.warning("ArcGIS query failed for %s: %s", url, exc)
        return []


def _spatial_query(url: str, bbox: dict, extra_params: Optional[dict] = None) -> list[dict]:
    """Query a spatial layer with a bbox geometry filter."""
    params = {
        "geometry": _bbox_geometry(bbox),
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "inSR": "4326",
        "outSR": "4326",
    }
    if extra_params:
        params.update(extra_params)
    return _query(url, params)


# ---------------------------------------------------------------------------
# Fire conditions
# ---------------------------------------------------------------------------

def get_fire_conditions(bbox: dict) -> dict:
    """
    Returns:
        danger_rating   str     e.g. "HIGH" (or "UNKNOWN")
        danger_score    float   0–1 normalised
        dispatch_level  str     "Low" / "Medium" / "High" / "UNKNOWN"
        dispatch_score  float   0–1 normalised
        no_campfire_active bool
    """
    # 1. Fire danger rating polygons (spatial)
    features = _spatial_query(URLS["fire_danger"], bbox, {"outFields": "FDR,FDRANAME,AVGERC,AVGBI"})
    danger_rating = "UNKNOWN"
    danger_score = 0.4  # default to moderate-low
    if features:
        fdr_raw = (features[0].get("attributes", {}).get("FDR") or "UNKNOWN").strip()
        danger_rating = fdr_raw.upper()
        danger_score = _FDR_RISK.get(fdr_raw.lower(), 0.4)

    # 2. Dispatch levels table (no geometry — attr query only)
    dispatch_features = _query(
        URLS["fire_dispatch"],
        {"outFields": "DISPLEVEL,FDRANUM,UPDTTIME", "orderByFields": "UPDTTIME DESC"},
    )
    dispatch_level = "UNKNOWN"
    dispatch_score = 0.0
    if dispatch_features:
        raw = (dispatch_features[0].get("attributes", {}).get("DISPLEVEL") or "").strip()
        if raw:
            dispatch_level = raw
            dispatch_score = _DISPATCH_RISK.get(raw.lower(), 0.3)

    # 3. No-campfire zone presence (1 feature is enough to flag active)
    no_campfire_features = _spatial_query(
        URLS["no_campfire"], bbox, {"outFields": "OBJECTID", "resultRecordCount": 1}
    )
    no_campfire_active = len(no_campfire_features) > 0

    return {
        "danger_rating": danger_rating,
        "danger_score": danger_score,
        "dispatch_level": dispatch_level,
        "dispatch_score": dispatch_score,
        "no_campfire_active": no_campfire_active,
    }


# ---------------------------------------------------------------------------
# Smoke / air quality
# ---------------------------------------------------------------------------

def get_smoke_aqi(bbox: dict) -> Optional[float]:
    """
    Returns the maximum 24-hour AQI reading from smoke forecast stations within
    the bbox, or None if no data is available.
    """
    features = _spatial_query(
        URLS["smoke_forecast"], bbox,
        {"outFields": "HR24AQI,HR24PM25,INTERVAL1SLC,LATITUDE,LONGITUDE"},
    )
    aqis = []
    for f in features:
        aqi = f.get("attributes", {}).get("HR24AQI")
        if aqi is not None:
            try:
                aqis.append(float(aqi))
            except (TypeError, ValueError):
                pass
    return max(aqis) if aqis else None


# ---------------------------------------------------------------------------
# Hydrology / stream gages
# ---------------------------------------------------------------------------

def get_hydro_conditions(bbox: dict) -> dict:
    """
    Queries stream gage data (table, layer 3) for flood alert flags.

    Returns:
        flood_alert      bool    True if any gage is at or above minor flood stage
        max_flow_cfs     float | None
        station_count    int
        flood_severity   str     "none" / "minor" / "moderate" / "major"
    """
    # Stream gage data is a non-spatial table (no geometry) — attr-only query
    features = _query(
        URLS["stream_gage_data"],
        {"outFields": "FLOW,RIVSTG,MINFLDSTG,MODFLDSTG,MAJFLDSTG,FLOWTIME"},
    )

    if not features:
        return {"flood_alert": False, "max_flow_cfs": None, "station_count": 0, "flood_severity": "none"}

    max_flow: Optional[float] = None
    flood_severity = "none"

    for f in features:
        attr = f.get("attributes", {})
        flow = attr.get("FLOW")
        rivstg = attr.get("RIVSTG")
        minfld = attr.get("MINFLDSTG")
        modfld = attr.get("MODFLDSTG")
        majfld = attr.get("MAJFLDSTG")

        if flow is not None:
            try:
                fv = float(flow)
                if max_flow is None or fv > max_flow:
                    max_flow = fv
            except (TypeError, ValueError):
                pass

        # Flood stage comparison
        if rivstg is not None:
            try:
                stage = float(rivstg)
                if majfld and stage >= float(majfld):
                    flood_severity = "major"
                elif modfld and stage >= float(modfld) and flood_severity not in ("major",):
                    flood_severity = "moderate"
                elif minfld and stage >= float(minfld) and flood_severity == "none":
                    flood_severity = "minor"
            except (TypeError, ValueError):
                pass

    return {
        "flood_alert": flood_severity != "none",
        "max_flow_cfs": round(max_flow, 1) if max_flow is not None else None,
        "station_count": len(features),
        "flood_severity": flood_severity,
    }


# ---------------------------------------------------------------------------
# Wildfire incidents (WFIGS — National Interagency Fire Center)
# ---------------------------------------------------------------------------

# WFIGS is hosted on a different ArcGIS organisation than NPS
_WFIGS_URL = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services"
    "/WFIGS_Incident_Locations_Current/FeatureServer/0"
)


def get_wildfire_incidents(bbox: dict) -> dict:
    """
    Query the NIFC WFIGS active wildfire incident layer for fires within the bbox.

    Returns:
        count   int     number of active fires intersecting the bbox
        fires   list    each entry: {lat, lon, name, acres, cause, discovered, contained_pct}
    """
    features = _spatial_query(
        _WFIGS_URL,
        bbox,
        {
            "outFields": (
                "InitialLatitude,InitialLongitude,IncidentName,"
                "FinalAcres,FireCause,FireDiscoveryDateTime,"
                "IncidentTypeCategory,PercentContained"
            ),
            "resultRecordCount": 50,
        },
    )

    fires = []
    for f in features:
        attr = f.get("attributes", {})
        try:
            lat = float(attr.get("InitialLatitude")  or 0)
            lon = float(attr.get("InitialLongitude") or 0)
        except (TypeError, ValueError):
            continue
        if lat == 0 and lon == 0:
            continue

        # Convert epoch-ms discovery date to ISO string
        disc_raw = attr.get("FireDiscoveryDateTime")
        if isinstance(disc_raw, (int, float)) and disc_raw > 0:
            import datetime as _dt
            discovered = _dt.datetime.utcfromtimestamp(disc_raw / 1000).strftime("%Y-%m-%dT%H:%MZ")
        else:
            discovered = str(disc_raw or "")

        fires.append({
            "lat":           round(lat, 5),
            "lon":           round(lon, 5),
            "name":          str(attr.get("IncidentName") or ""),
            "acres":         float(attr.get("FinalAcres") or 0),
            "cause":         str(attr.get("FireCause") or "Unknown"),
            "type":          str(attr.get("IncidentTypeCategory") or "WF"),
            "discovered":    discovered,
            "contained_pct": float(attr.get("PercentContained") or 0),
        })

    return {"count": len(fires), "fires": fires}


# ---------------------------------------------------------------------------
# Road incidents
# ---------------------------------------------------------------------------

def get_road_incidents(bbox: dict) -> dict:
    """
    Returns:
        count           int   number of active road incidents in the bbox
        has_closure     bool  any all-lanes-closed incident
        types           list[str]  incident types found
    """
    features = _spatial_query(
        URLS["road_incidents"], bbox,
        {"outFields": "incident_type,incident_category,vehicle_impact"},
    )

    if not features:
        return {"count": 0, "has_closure": False, "types": []}

    types = []
    has_closure = False
    for f in features:
        attr = f.get("attributes", {})
        itype = attr.get("incident_type") or ""
        impact = (attr.get("vehicle_impact") or "").lower()
        if itype:
            types.append(itype)
        if "closed" in impact or "closure" in impact:
            has_closure = True

    return {"count": len(features), "has_closure": has_closure, "types": list(set(types))}
