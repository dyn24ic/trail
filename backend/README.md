# trAIl – Stage 2b Backend: Responder Route Optimisation

Django REST API for SAR responder routing using terrain data, live weather, and GPT-4o analysis.

## Quick Start

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in your API keys
python manage.py migrate
python manage.py runserver
```

## Environment Variables (`.env`)

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | GPT-4o for route analysis (falls back to rules engine if missing) |
| `OPENWEATHER_API_KEY` | OpenWeatherMap current conditions (falls back to clear defaults if missing) |
| `DJANGO_SECRET_KEY` | Django secret key |

## API Endpoints

### `POST /api/route/calculate/`
Calculate safest/fastest route for one responder type.

**Request:**
```json
{
  "responder_lat": 40.1,
  "responder_lon": -105.3,
  "victim_lat": 40.05,
  "victim_lon": -105.25,
  "severity": 4,
  "route_type": "ground"
}
```

| Field | Type | Description |
|---|---|---|
| `severity` | 1–5 | 1=minor injury, 5=life-threatening. Drives responder speed. |
| `route_type` | `ground`\|`helicopter` | Routing algorithm selection |

**Response includes:**
- `route.waypoints` – ordered list of `{lat, lon, elevation_m, slope_deg, hazard, colour}`
- `route.elevation_profile` – downsampled profile for charting
- `route.danger_zones` – up to 10 hazard areas with type, bounds, scores
- `route.safety_score` – 0 (safe) → 1 (extreme danger)
- `route.route_colour` – hex colour (`#22c55e` green → `#ef4444` red)
- `route.eta_minutes` – estimated time adjusted for severity + weather + terrain
- `route.helicopter_recommendation` – whether helicopter is recommended + reasons
- `weather` – full weather conditions at midpoint
- `analysis` – GPT-4o (or fallback) summary, hazards, turn-by-turn, recommendations

---

### `POST /api/route/compare/`
Compute both ground and helicopter routes simultaneously and get a recommendation.

Same request body; `route_type` is ignored.

**Response adds:** `recommended_type: "ground"|"helicopter"`

---

### `GET /api/terrain/?west=&south=&east=&north=`
Return terrain stats and danger zones for a bounding box.

---

### `GET /api/weather/?lat=&lon=`
Current weather with routing speed factors.

---

### `GET /api/health/`
Service status + API key configuration check.

---

## Architecture

```
routing/
├── services/
│   ├── terrain_service.py   # seamless-3dep DEM fetch → slope/hazard grids
│   ├── weather_service.py   # OpenWeatherMap → routing speed factors
│   ├── route_service.py     # A* pathfinding on DEM grid, ETA, danger zones
│   └── llm_service.py       # GPT-4o route analysis + rules-based fallback
├── views.py                 # DRF API views
├── serializers.py           # Input validation
├── urls.py                  # URL routing
└── models.py                # RouteRequest audit log
```

## Severity Speed Table

| Severity | Ground km/h | Helicopter km/h |
|---|---|---|
| 1 – minor | 4 | 150 |
| 2 | 5.5 | 175 |
| 3 – moderate | 7 | 200 |
| 4 | 9 | 220 |
| 5 – critical | 12 | 240 |

Speed is further adjusted by weather and terrain slope factors.

## Helicopter Recommendation Threshold

Ground route `safety_score > 0.75` AND helicopter flight conditions met (wind < 15 m/s, visibility ≥ 1500 m, no active storm) triggers helicopter recommendation.
