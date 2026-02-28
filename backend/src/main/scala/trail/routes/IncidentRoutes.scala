package trail.routes

import cats.effect.IO
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.*
import org.http4s.dsl.io.*
import trail.domain.{Incident, IncidentReport, IncidentSummary}
import trail.services.IncidentService

object IncidentRoutes:

  def routes(service: IncidentService): HttpRoutes[IO] = HttpRoutes.of[IO]:

    case GET -> Root / "api" / "v1" / "incidents" =>
      service.listIncidents.flatMap { incidents =>
        Ok(incidents.map(toSummary).asJson)
      }

    case GET -> Root / "api" / "v1" / "incidents" / id =>
      service.getIncident(id).flatMap:
        case Some(incident) => Ok(incident.asJson)
        case None           => NotFound(io.circe.Json.obj("error" -> s"Incident $id not found".asJson))

    case GET -> Root / "api" / "v1" / "incidents" / id / "report" =>
      service.getReport(id).flatMap:
        case Some(r) => Ok(r.asJson)
        case None    => NotFound(io.circe.Json.obj("error" -> "Report not yet available".asJson))

    case GET -> Root / "api" / "v1" / "incidents" / id / "status" =>
      service.getIncident(id).flatMap:
        case Some(i) =>
          Ok(io.circe.Json.obj(
            "id"        -> i.id.asJson,
            "status"    -> i.status.asJson,
            "updatedAt" -> i.updatedAt.asJson
          ))
        case None =>
          NotFound(io.circe.Json.obj("error" -> s"Incident $id not found".asJson))

  private def toSummary(i: Incident): IncidentSummary =
    IncidentSummary(
      id          = i.id,
      triggerType = i.triggerType,
      status      = i.status,
      locationLat = i.locationLat,
      locationLng = i.locationLng,
      createdAt   = i.createdAt,
      updatedAt   = i.updatedAt
    )
