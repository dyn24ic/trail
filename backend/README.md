# trAIl – Backend

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
