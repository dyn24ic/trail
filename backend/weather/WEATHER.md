# trAIl – Weather & Hotspot Prediction Module

## Purpose

Stage 1 of the trAIl (Trail Guardian) MVP: fuse real-time environmental data from multiple
sources and use a GPT model to identify geographic zones most likely to produce hiker accidents
in the next 24 hours. Output is structured JSON consumable directly by the frontend (same
lat/lon + severity conventions as existing marker types).

> Future plan: upgrade the AI model from `gpt-4o` to `gpt-5.2`, then fine-tune NVIDIA Nemotron
> on Yosemite-specific SAR incident datasets for domain-specialised predictions.

---

## Product Context (from trAIl CLAUDE.md)

**trAIl (Trail Guardian)** — AI-powered Search & Rescue for hiking trails.

### Stage 1: Mapping & Sensor Placement
AI risk model scores hotspots based on historical incidents, terrain difficulty, remoteness,
and weather exposure. Low-cost stationary sensors ($80) and emergency call boxes ($150) are
placed at high-risk points identified by this model.

### Stage 2: Accident Detection & Drone Response
AI predicts search zones using historical data, terrain, and environmental conditions.
Hotspot scores from this module seed the search zone prioritisation.

### Stage 2b: Responder Route Optimisation (separate module – `routing/`)
AI calculates fastest/safest responder routes considering terrain, weather, and injury severity.

### Core Value
- Rapid location: 5–15 min vs 30–90 min traditional search
- ~$2k setup per 20 km trail, ~$1k annual operation
- Continuously improves accuracy from incident data

---

## Data Sources

### 1. Fire Danger Ratings
**Service:** `YOSE_FIRE_FDRA2023andFireDangerRatings_view/FeatureServer/0`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/YOSE_FIRE_FDRA2023andFireDangerRatings_view/FeatureServer/0`
**Type:** Polygon layer (spatial query by bbox)
**Key fields:**
- `FDR` — Fire Danger Rating string (LOW / MODERATE / HIGH / VERY HIGH / EXTREME)
- `FDRANAME` — Fire Danger Rating Area name
- `AVGERC` — Average Energy Release Component
- `AVGBI` — Average Burning Index

**Risk contribution:** High fire danger raises overall zone risk, especially when combined with
dry, windy weather.

---

### 2. Fire Dispatch Levels
**Service:** `YOSE_FIRE_FDRA2023DispatchLevels_tbl/FeatureServer/1`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_FIRE_FDRA2023DispatchLevels_tbl/FeatureServer/1`
**Type:** Table (no geometry; attribute-only query)
**Key fields:**
- `DISPLEVEL` — Dispatch level (Low / Medium / High)
- `FDRANUM` — FDRA number
- `UPDTTIME` — Last update timestamp

**Risk contribution:** High dispatch level means significant fire resources are already committed,
indicating active fire conditions.

---

### 3. Road Incidents
**Service:** `YOSE_TRANS_Road_Incidents/FeatureServer/0`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_TRANS_Road_Incidents/FeatureServer/0`
**Type:** Line layer (spatial query by bbox)
**Key fields:**
- `incident_type` — Type of road condition (e.g. "ice, snowfall")
- `incident_category` — Broader category (e.g. "winter")
- `vehicle_impact` — Closure severity (e.g. "all-lanes-closed")

**Risk contribution:** Road closures reduce emergency access, increasing the risk that an
incident in the affected area will have a longer response time.

---

### 4. Smoke Forecast (24-hour)
**Service:** `YOSE_AIR_SmokeForecast_pt/FeatureServer/0`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_AIR_SmokeForecast_pt/FeatureServer/0`
**Type:** Point layer
**Key fields:**
- `HR24AQI` — 24-hour Air Quality Index
- `HR24PM25` — 24-hour PM2.5 concentration (µg/m³)
- `INTERVAL1SLC` — Smoke level category for current interval
- `LATITUDE`, `LONGITUDE` — Station coordinates

**Risk contribution:** Poor air quality impairs hiker visibility and physical performance;
high smoke also signals nearby fire activity.

---

### 5. No-Campfire Zones
**Service:** `YOSE_BND_NoFireZone/FeatureServer/0`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_BND_NoFireZone/FeatureServer/0`
**Type:** Polygon layer

**Risk contribution:** Active no-campfire zones correlate with high fire risk conditions.
Areas outside these zones that are close to their boundaries may be at elevated fire risk.

---

### 6. Stream Gage Data
**Service:** `YOSE_HYDRO_StreamGageData_tbl/FeatureServer/3`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_HYDRO_StreamGageData_tbl/FeatureServer/3`
**Type:** Table (attribute-only, linked to StreamGages_pt by station ID)
**Key fields:**
- `FLOW` — River discharge (CFS)
- `RIVSTG` — River stage / water level (feet)
- `MINFLDSTG` — Minor flood stage threshold (feet)
- `MODFLDSTG` — Moderate flood stage threshold (feet)
- `MAJFLDSTG` — Major flood stage threshold (feet)
- `FLOWTIME` — Measurement timestamp

**Risk contribution:** High flow or flood-stage readings indicate dangerous water crossings —
a leading cause of hiker fatalities in Yosemite.

---

### 7. Stream Gage Locations
**Service:** `YOSE_HYDRO_StreamGages_pt/FeatureServer/0`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_HYDRO_StreamGages_pt/FeatureServer/0`
**Type:** Point layer

**Risk contribution:** Geographic positions of the stream monitoring network.

---

### 8. Hydromet Station Data
**Service:** `YOSE_HYDRO_HydroMetStationData_tbl/FeatureServer`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_HYDRO_HydroMetStationData_tbl/FeatureServer`
**Type:** Table (soil moisture, snowpack, and weather sensor data)

**Risk contribution:** Soil moisture and snowpack data inform flood and avalanche risk.
High snowmelt + high soil moisture → elevated stream crossing danger.

---

### 9. Hydromet Station Locations
**Service:** `YOSE_HYDRO_HydroMetStations_pt/FeatureServer`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_HYDRO_HydroMetStations_pt/FeatureServer`
**Type:** Point layer

---

### 10. Forest Health (2022)
**Service:** `YOSE_LAND_ForestHealth2022_pt/FeatureServer/0`
**URL:** `https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/YOSE_LAND_ForestHealth2022_pt/FeatureServer/0`
**Type:** Point layer

**Risk contribution:** Dead or stressed forest increases wildfire risk and trail hazards
(falling trees, obscured paths).

---

### 11. HRRR / GFS Weather (Open-Meteo)
**API:** `https://api.open-meteo.com/v1/gfs`
**Model:** GFS-HRRR hybrid (3 km resolution, 1-hour update cycle)
**Docs:** https://open-meteo.com/en/docs/gfs-api
**Auth:** None (free, 600 req/min)
**Variables fetched:**
- `temperature_2m` — °C
- `windspeed_10m` — km/h
- `precipitation` — mm/hr
- `relativehumidity_2m` — %
- `weathercode` — WMO weather code

**Risk contribution:** High wind increases fall risk on exposed ridges; extreme temperatures
cause heat stroke or hypothermia; heavy precipitation degrades trail surfaces and visibility.

---

### 12. Terrain / DEM (seamless-3dep)
**Source:** USGS 3D Elevation Program via the `seamless-3dep` Python library (already in
`requirements.txt`). Falls back to synthetic terrain if tiles are unavailable.
**Already implemented in:** `routing/services/terrain_service.py`
**Reused functions:**
- `get_terrain_data(lat1, lon1, lat2, lon2)` — fetches DEM, computes slope + hazard grid
- `latlon_to_grid(lat, lon, transform)` — converts coordinates to grid indices
- `get_slope_at(lat, lon, terrain_data)` — slope in degrees at a point
- `get_elevation_at(lat, lon, terrain_data)` — elevation in metres at a point
- `identify_danger_zones(terrain_data, threshold)` — returns top-10 high-hazard clusters

**Risk contribution:** Steep slopes (falls), high exposed ridges (weather exposure), and
remote areas (slow rescue access) are the primary terrain risk factors.

---

## Prediction Pipeline

```
predict_hotspots(bbox)
        │
        ▼
[Phase 1 – Parallel data fetch]
  Fire danger ratings     ── ArcGIS FeatureServer/0  (polygon spatial query)
  Fire dispatch levels    ── ArcGIS FeatureServer/1  (table, attr-only)
  Road incidents          ── ArcGIS FeatureServer/0  (line spatial query)
  Smoke AQI               ── ArcGIS FeatureServer/0  (point spatial query)
  Stream gage data        ── ArcGIS FeatureServer/3  (table, attr-only)
  Terrain / DEM           ── seamless-3dep (via routing.services.terrain_service)
  Weather (HRRR)          ── Open-Meteo GFS API
        │
        │  concurrent.futures.ThreadPoolExecutor
        │  Failures are caught individually — partial data is fine
        ▼
[Phase 2 – RawConditions assembly]
  fire_conditions:    { danger_rating, dispatch_level, no_campfire_active }
  weather_conditions: { temperature_c, wind_kmh, precip_mm_hr, humidity_pct }
  hydro_conditions:   { flood_alert, max_flow_cfs }
  smoke_aqi:          float | None
  road_incident_count: int
  terrain_data:       { elevation_grid, slope_grid, hazard_grid, transform }
        │
        ▼
[Phase 3 – Candidate grid + numeric scoring]
  8×8 = 64 evenly-spaced candidate lat/lon points across bbox
  Per point:
    fire_score       = f(danger_rating, dispatch_level)           → [0, 1]
    weather_score    = f(wind, precip, temperature)               → [0, 1]
    terrain_score    = f(slope, elevation_percentile, remoteness) → [0, 1]
    water_score      = f(flood_alert, flow_vs_threshold)          → [0, 1]
    access_score     = f(road_incident_count, remoteness)         → [0, 1]
    composite        = weighted sum                               → [0, 1]
  Top 20 candidates sorted by composite score are passed to the AI.
        │
        ▼
[Phase 4 – GPT analysis (structured JSON output)]
  Model: gpt-4o  (upgrade to gpt-5.2 → NVIDIA Nemotron post fine-tune)
  System prompt: SAR context, Yosemite landmarks, risk thresholds
  User prompt:   current conditions + pre-scored candidate table (compact)
  response_format: json_object  ←  same pattern as routing/services/llm_service.py
        │
        ▼
[Phase 5 – Response assembly]
  HotspotPredictionResponse {
    hotspots, bbox, generatedAt, modelVersion, conditions
  }
```

---

## Output Format (Frontend-Compatible JSON)

```json
{
  "hotspots": [
    {
      "id": "HOTSPOT-001",
      "lat": 37.7421,
      "lon": -119.5320,
      "radiusMeters": 500,
      "riskScore": 0.82,
      "riskLevel": "high",
      "factors": {
        "fire": 0.70,
        "weather": 0.55,
        "terrain": 0.90,
        "water": 0.30,
        "accessibility": 0.45
      },
      "description": "Half Dome cable route approach — steep exposed terrain combined with high fire danger rating and strong afternoon winds create compound risk.",
      "recommendations": [
        "Post ranger advisory at Half Dome trailhead",
        "Pre-position drone ALPHA-01 at Mirror Lake LZ",
        "Alert hikers registered for permits"
      ]
    }
  ],
  "bbox": { "south": 37.70, "north": 37.82, "west": -119.62, "east": -119.47 },
  "generatedAt": "2026-02-28T14:30:00Z",
  "modelVersion": "trAIl-weather-v1.0+gpt-4o",
  "conditions": {
    "fireDangerRating": "HIGH",
    "weatherSummary": "12°C, wind 28 km/h, precip 0.0 mm/hr",
    "activeFires": 0,
    "smokeAqi": 42
  }
}
```

### Mapping to Existing Frontend Types

| Hotspot field    | Frontend equivalent                                  |
|------------------|------------------------------------------------------|
| `lat`, `lon`     | Same as `SensorMarker`, `DroneMarker`, `IncidentMarker` |
| `riskLevel`      | Maps to `severity`: extreme→critical, high→warning, moderate→info |
| `radiusMeters`   | Search zone radius (same concept as existing search zones in TerrainScene) |
| `riskScore`      | Numeric for gradient heatmap rendering (0=green, 1=red) |

---

## API Endpoint

```
GET /api/hotspots/predict/?south=37.70&north=37.82&west=-119.62&east=-119.47
```

**Response:** `HotspotPredictionResponse` JSON (see above)
**Cache:** No caching (live data — predictions should always be current)
**Auth:** None (internal backend, not public)

---

## Environment Variables

Add to `backend/.env` (copy from `backend/.env.example`):

```
OPENAI_API_KEY=sk-...          # Required – GPT-4o predictions
# OPENWEATHER_API_KEY is used by routing/, not weather/
```

The weather module uses:
- `settings.OPENAI_API_KEY` — already configured in `trail_backend/settings.py`
- No additional keys needed (ArcGIS is public; Open-Meteo is free)

---

## Running

```bash
cd backend
source venv/bin/activate
# Management command (CLI test):
python manage.py predict_hotspots
# Or with custom bbox:
python manage.py predict_hotspots --south 37.70 --north 37.82 --west -119.62 --east -119.47
# Django dev server:
python manage.py runserver
# Then: GET http://localhost:8000/api/hotspots/predict/
```

---

## Future Integration Path

1. **Frontend connection:** Add `GET /api/hotspots/predict/` call in `app/src/app/api/hotspots/route.ts`
   (Next.js API route → Django backend). Response maps directly to a new `HotspotMarker` type.
2. **Three.js rendering:** Add hotspot zones as semi-transparent pulsing spheres in `TerrainScene.tsx`,
   using `latLonToMesh()` from `coordMapping.ts` and `riskLevel` to choose colour.
3. **Model upgrade:** Replace `AI_MODEL` constant in `hotspot_service.py` with `gpt-5.2` when
   available, then swap to NVIDIA Nemotron endpoint after fine-tuning.
4. **Periodic refresh:** Add Celery task to re-run `predict_hotspots` every 30 minutes and cache
   results in Redis, eliminating per-request GPT latency for the dashboard.

---

## Related Modules

| Module | Location | Purpose |
|--------|----------|---------|
| Terrain / DEM | `routing/services/terrain_service.py` | Imported by `elevation_service.py` |
| Weather (routing) | `routing/services/weather_service.py` | OpenWeatherMap for responder routing speed |
| LLM routing | `routing/services/llm_service.py` | GPT-4o for route analysis (separate concern) |
| Elevation API | `app/src/app/api/elevation/route.ts` | Next.js elevation endpoint (3D mesh) |
| Coord mapping | `app/src/lib/coordMapping.ts` | lat/lon → Three.js mesh coordinates |
