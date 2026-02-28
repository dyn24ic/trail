package trail.routes

import cats.effect.IO
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.*
import org.http4s.dsl.io.*
import trail.domain.TriggerEvent
import trail.services.IncidentService

object TriggerRoutes:

  given EntityDecoder[IO, TriggerEvent] = jsonOf[IO, TriggerEvent]

  def routes(service: IncidentService): HttpRoutes[IO] = HttpRoutes.of[IO]:

    case req @ POST -> Root / "api" / "v1" / "triggers" =>
      req
        .decode[TriggerEvent] { event =>
          service.handleTrigger(event).flatMap { incident =>
            Created(
              io.circe.Json.obj(
                "incidentId" -> incident.id.asJson,
                "status" -> incident.status.asJson,
                "message" -> "Incident created. Pipeline running asynchronously.".asJson
              )
            )
          }
        }
        .handleErrorWith { err =>
          BadRequest(io.circe.Json.obj("error" -> err.getMessage.asJson))
        }
