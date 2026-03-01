package trail.routes

import cats.effect.IO
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.*
import org.http4s.dsl.io.*
import trail.domain.{AmbulanceReport, Incident, IncidentReport, IncidentSummary, PoliceReport}
import trail.services.IncidentService

object IncidentRoutes:

  given EntityDecoder[IO, PoliceReport]    = jsonOf[IO, PoliceReport]
  given EntityDecoder[IO, AmbulanceReport] = jsonOf[IO, AmbulanceReport]

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

    case req @ POST -> Root / "api" / "v1" / "incidents" / id / "police-report" =>
      req.decode[PoliceReport] { report =>
        service.submitPoliceReport(id, report).flatMap:
          case Some(_) => Ok(io.circe.Json.obj("message" -> "Police report saved".asJson))
          case None    => NotFound(io.circe.Json.obj("error" -> s"Incident $id not found".asJson))
      }.handleErrorWith { err =>
        BadRequest(io.circe.Json.obj("error" -> err.getMessage.asJson))
      }

    case req @ POST -> Root / "api" / "v1" / "incidents" / id / "ambulance-report" =>
      req.decode[AmbulanceReport] { report =>
        service.submitAmbulanceReport(id, report).flatMap:
          case Some(_) => Ok(io.circe.Json.obj("message" -> "Ambulance report saved".asJson))
          case None    => NotFound(io.circe.Json.obj("error" -> s"Incident $id not found".asJson))
      }.handleErrorWith { err =>
        BadRequest(io.circe.Json.obj("error" -> err.getMessage.asJson))
      }

    case POST -> Root / "api" / "v1" / "incidents" / id / "ai-recommendation" =>
      service.generateAiRecommendation(id).flatMap:
        case Some(reco) => Ok(reco.asJson)
        case None       => NotFound(io.circe.Json.obj("error" -> s"Incident $id not found".asJson))

    case GET -> Root / "api" / "v1" / "incidents" / id / "ai-recommendation" =>
      service.getIncident(id).flatMap:
        case Some(i) if i.aiRecommendation.isDefined => Ok(i.aiRecommendation.asJson)
        case Some(_) => NotFound(io.circe.Json.obj("error" -> "No AI recommendation generated yet".asJson))
        case None    => NotFound(io.circe.Json.obj("error" -> s"Incident $id not found".asJson))

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
