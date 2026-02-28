# trAIl – Stage 2 Backend

Scala 3 REST API for the trAIl (Trail Guardian) search-and-rescue platform. Receives hiker emergency triggers, runs an AI pipeline (search-zone prediction → drone dispatch → injury triage → responder routing), and persists everything to SQLite.

---

## Stack

| Layer      | Library / Version                        |
|------------|------------------------------------------|
| Language   | Scala 3.8.2 via scala-cli               |
| HTTP       | http4s 0.23.33 (ember-server, circe, dsl)|
| JSON       | Circe 0.14.15 (generic, parser, literal) |
| Database   | Doobie 1.0.0-RC5 + SQLite (HikariCP)    |
| Effects    | cats-effect 3.6.3                        |
| Logging    | Logback 1.5.32                           |

Dependencies are declared in `project.scala` using `//> using dep` directives (scala-cli, **not** sbt).

---

## Project Layout

```
backend/
├── project.scala                          # scala-cli deps + Scala version
└── src/main/scala/trail/
    ├── Main.scala                         # entry point, server wiring
    ├── domain/
    │   ├── TriggerEvent.scala             # sealed trait + 4 subtypes + Circe codecs
    │   ├── Incident.scala                 # Incident, IncidentSummary, IncidentStatus enum
    │   ├── SearchZone.scala
    │   ├── DroneResult.scala
    │   ├── InjuryTriage.scala
    │   └── ResponderRoute.scala
    ├── db/
    │   └── Database.scala                 # HikariTransactor + schema init
    ├── repository/
    │   └── IncidentRepository.scala       # Doobie CRUD
    ├── services/
    │   ├── SearchZonePredictorService.scala
    │   ├── DroneDispatchService.scala
    │   ├── TriageService.scala
    │   ├── ResponderRoutingService.scala
    │   └── IncidentService.scala          # pipeline orchestrator
    └── routes/
        ├── TriggerRoutes.scala
        └── IncidentRoutes.scala
```

---

## Running

```bash
cd backend
scala run .
```

The server starts on `http://0.0.0.0:8080`. A SQLite database file `trail.db` is created in the working directory on first run.

---

## API

### POST /api/v1/triggers

Create an incident and kick off the pipeline asynchronously.

**Trigger types** (send whichever matches the event):

```jsonc
// Emergency call box pressed
{ "deviceId": "box-01", "lat": 49.123, "lng": -122.456 }

// Sensor anomaly (motion or audio)
{ "sensorId": "s-42", "anomalyType": "audio", "lat": 49.123, "lng": -122.456 }

// Overdue hiker
{ "hikerId": "h-7", "trailId": "t-3", "overdueMinutes": 90,
  "lastKnownLat": 49.123, "lastKnownLng": -122.456 }

// 911 dispatch
{ "callId": "c-99", "callerDescription": "injured ankle", "lat": 49.123, "lng": -122.456 }
```

**Response `201 Created`:**
```json
{
  "incidentId": "uuid",
  "status": "Triggered",
  "message": "Incident created. Pipeline running asynchronously."
}
```

---

### GET /api/v1/incidents

List all incident summaries.

```json
[
  {
    "id": "uuid",
    "triggerType": "CallBox",
    "status": "Routed",
    "locationLat": 49.123,
    "locationLng": -122.456,
    "createdAt": "2026-02-28T10:00:00Z",
    "updatedAt": "2026-02-28T10:00:15Z"
  }
]
```

---

### GET /api/v1/incidents/:id

Full incident detail including search zones, drone result, triage, and responder route.

---

### GET /api/v1/incidents/:id/status

Lightweight status check.

```json
{ "id": "uuid", "status": "Triaged", "updatedAt": "2026-02-28T10:00:10Z" }
```

---

## Incident Lifecycle

```
Triggered → Searching → VictimFound → Triaged → Routed → Closed
```

Each stage is persisted to SQLite as it completes. The pipeline runs asynchronously after the trigger endpoint returns.

---

## Scala 3 Notes

- Codecs use `given` instances (not `implicit val`).
- Imports use `import foo.*` (not deprecated `foo._`).
- `Decoder[A]` is invariant — subtypes are widened with `.map(e => e: SuperType)`, not type ascription alone.
- `if/else` branches inside `for` comprehensions require `{}` braces.
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
