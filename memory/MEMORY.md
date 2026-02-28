# trAIl Project Memory

## Project Overview
- Product: **trAIl** (Trail Guardian) — AI-powered SAR for hiking trails
- Working dir: `/Users/sunnywong_1/Documents/GitHub/trail/`
- Key file: `CLAUDE.md` contains full product spec

## File Structure
```
trail/
  CLAUDE.md                      — Product spec (must read first)
  app/                           — Next.js 16.1.6 frontend (TypeScript)
    src/
      app/api/elevation/route.ts — GET /api/elevation (OpenTopo → USGS → procedural)
      components/three/          — Three.js terrain scene + markers
      components/dashboard/      — Dashboard UI (MapContainer, panels)
      lib/elevation/             — fetchOpenTopo, fetchUSGS, parseGeoTiff, fallbackTerrain
      lib/coordMapping.ts        — latLonToMesh, demGridToVertexHeights, heightAtMeshPos
      types/elevation.ts         — BBox, ElevationResponse
      types/markers.ts           — SensorMarker, DroneMarker, IncidentMarker
      data/trailBbox.ts          — YOSEMITE_BBOX (S:37.70 N:37.82 W:-119.62 E:-119.47)
  backend/                       — Multi-stack Python/Scala backend
    trail_backend/               — Django 6.0.2 project config
      settings.py                — INSTALLED_APPS: routing, weather
      urls.py                    — /api/ → routing, /api/hotspots/ → weather
    routing/                     — Stage 2b: responder route optimisation (Django app)
      services/
        terrain_service.py       — seamless-3dep DEM + slope/hazard grids (REUSE in weather)
        weather_service.py       — OpenWeatherMap (for routing speed factors)
        llm_service.py           — GPT-4o route analysis pattern (response_format json_object)
        route_service.py         — A* pathfinding
    weather/                     — Stage 1: hotspot prediction (new Django app, this session)
      WEATHER.md                 — Full documentation of data sources + pipeline
      services/
        arcgis_service.py        — All ArcGIS FeatureServer queries (fire, smoke, hydro, roads)
        openmeteo_service.py     — Open-Meteo GFS/HRRR weather
        elevation_service.py     — Wraps routing.terrain_service; candidate grid + scoring
        hotspot_service.py       — Main orchestrator + GPT call (AI_MODEL = "gpt-4o")
      views.py                   — GET /api/hotspots/predict/?south=&north=&west=&east=
      management/commands/predict_hotspots.py — CLI testing
    src/main/scala/trail/        — Stage 2: incident detection Scala/http4s backend
    requirements.txt             — openai, numpy, scipy, seamless-3dep, requests, django…
    .env.example                 — OPENAI_API_KEY, OPENWEATHER_API_KEY, DJANGO_SECRET_KEY
```

## Backend Stacks
- **Django/Python** (trail_backend): Stage 2b routing + Stage 1 weather/hotspot prediction
- **Scala/http4s** (src/main/scala): Stage 2 incident detection + SAR pipeline

## Weather App — ArcGIS Field Names (verified 2026-02-28)
| Service | Layer | Key fields |
|---------|-------|-----------|
| YOSE_FIRE_FDRA2023andFireDangerRatings_view | /0 | `FDR`, `FDRANAME`, `AVGERC`, `AVGBI` |
| YOSE_FIRE_FDRA2023DispatchLevels_tbl | /1 | `DISPLEVEL` (Low/Medium/High), `FDRANUM` |
| YOSE_TRANS_Road_Incidents | /0 | `incident_type`, `vehicle_impact`, `incident_category` |
| YOSE_AIR_SmokeForecast_pt | /0 | `HR24AQI`, `HR24PM25`, `INTERVAL1SLC` |
| YOSE_HYDRO_StreamGageData_tbl | **/3** | `FLOW` (CFS), `RIVSTG` (ft), `MINFLDSTG/MODFLDSTG/MAJFLDSTG` |

Note: Stream gage data is table layer **3**, not 0.

## HotspotPredictionResponse Format (frontend-compatible)
```json
{ "hotspots": [{ "id", "lat", "lon", "radiusMeters", "riskScore", "riskLevel",
                  "factors": { "fire", "weather", "terrain", "water", "accessibility" },
                  "description", "recommendations" }],
  "bbox", "generatedAt", "modelVersion", "conditions": { "fireDangerRating", "weatherSummary", "activeFires", "smokeAqi" } }
```
riskLevel maps to severity: extreme→critical, high→warning, moderate→info

## AI Model Path
weather app: gpt-4o → gpt-5.2 (TODO) → NVIDIA Nemotron (fine-tuned)
routing app: gpt-4o (llm_service.py)

## Key Patterns
- GPT calls: `response_format={"type": "json_object"}`, temp=0.2–0.3
- ArcGIS: append `/query` + spatial bbox geometry params; check for `error` key in HTTP 200 response
- All external fetches: wrapped in try/except, return safe defaults on failure
- Terrain: `from routing.services.terrain_service import get_terrain_data` (reused)
- Parallel fetches: `concurrent.futures.ThreadPoolExecutor` (not asyncio)

## User Preferences
- No emojis in output unless asked
- Concise responses
- git pull before creating files; manual approval for edits
