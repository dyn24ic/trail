package trail.repository

import cats.effect.IO
import doobie.*
import doobie.implicits.*
import io.circe.syntax.*
import io.circe.parser.decode
import trail.domain.*

class IncidentRepository(xa: Transactor[IO]):

  private def encodeOpt[A: io.circe.Encoder](a: Option[A]): Option[String] =
    a.map(_.asJson.noSpaces)

  private def decodeOpt[A: io.circe.Decoder](s: Option[String]): Option[A] =
    s.flatMap(str => decode[A](str).toOption)

  private def rowToIncident(
    id: String,
    triggerType: String,
    triggerPayload: String,
    status: String,
    locationLat: Option[Double],
    locationLng: Option[Double],
    searchZones: Option[String],
    droneResult: Option[String],
    triage: Option[String],
    route: Option[String],
    createdAt: String,
    updatedAt: String,
    report: Option[String],
    externalReports: Option[String],
    aiRecommendation: Option[String]
  ): Incident =
    val parsedStatus =
      decode[IncidentStatus](s""""$status"""").getOrElse(IncidentStatus.Triggered)
    Incident(
      id               = id,
      triggerType      = triggerType,
      triggerPayload   = triggerPayload,
      status           = parsedStatus,
      locationLat      = locationLat,
      locationLng      = locationLng,
      searchZones      = decodeOpt[List[SearchZone]](searchZones),
      droneResult      = decodeOpt[DroneResult](droneResult),
      triage           = decodeOpt[InjuryTriage](triage),
      route            = decodeOpt[ResponderRoute](route),
      createdAt        = createdAt,
      updatedAt        = updatedAt,
      report           = decodeOpt[IncidentReport](report),
      externalReports  = decodeOpt[ExternalReports](externalReports),
      aiRecommendation = decodeOpt[AiRecommendation](aiRecommendation)
    )

  def create(incident: Incident): IO[Unit] =
    val statusStr = incident.status.toString
    sql"""
      INSERT INTO incidents (
        id, trigger_type, trigger_payload, status,
        location_lat, location_lng,
        search_zones, drone_result, triage, route,
        created_at, updated_at
      ) VALUES (
        ${incident.id}, ${incident.triggerType}, ${incident.triggerPayload}, $statusStr,
        ${incident.locationLat}, ${incident.locationLng},
        ${encodeOpt(incident.searchZones)},
        ${encodeOpt(incident.droneResult)},
        ${encodeOpt(incident.triage)},
        ${encodeOpt(incident.route)},
        ${incident.createdAt}, ${incident.updatedAt}
      )
    """.update.run.transact(xa).void

  // Doobie 1.x / Scala 3 handles nested tuples more reliably for large row widths.
  private type RowA = (String, String, String, String, Option[Double], Option[Double])
  private type RowB = (Option[String], Option[String], Option[String], Option[String])
  private type RowC = (String, String, Option[String], Option[String], Option[String])
  private type Row  = (RowA, RowB, RowC)

  private def fromRow(r: Row): Incident =
    val ((id, triggerType, triggerPayload, status, locationLat, locationLng),
         (searchZones, droneResult, triage, route),
         (createdAt, updatedAt, report, externalReports, aiRecommendation)) = r
    rowToIncident(id, triggerType, triggerPayload, status, locationLat, locationLng,
                  searchZones, droneResult, triage, route, createdAt, updatedAt,
                  report, externalReports, aiRecommendation)

  private val selectCols = fr"""
    SELECT id, trigger_type, trigger_payload, status,
           location_lat, location_lng,
           search_zones, drone_result, triage, route,
           created_at, updated_at, report,
           external_reports, ai_recommendation
    FROM incidents"""

  def findById(id: String): IO[Option[Incident]] =
    (selectCols ++ fr"WHERE id = $id")
      .query[Row]
      .option
      .transact(xa)
      .map(_.map(fromRow))

  def findAll: IO[List[Incident]] =
    (selectCols ++ fr"ORDER BY created_at DESC")
      .query[Row]
      .to[List]
      .transact(xa)
      .map(_.map(fromRow))

  def updateFull(incident: Incident): IO[Unit] =
    val statusStr = incident.status.toString
    sql"""
      UPDATE incidents SET
        status            = $statusStr,
        search_zones      = ${encodeOpt(incident.searchZones)},
        drone_result      = ${encodeOpt(incident.droneResult)},
        triage            = ${encodeOpt(incident.triage)},
        route             = ${encodeOpt(incident.route)},
        report            = ${encodeOpt(incident.report)},
        external_reports  = ${encodeOpt(incident.externalReports)},
        ai_recommendation = ${encodeOpt(incident.aiRecommendation)},
        updated_at        = ${incident.updatedAt}
      WHERE id = ${incident.id}
    """.update.run.transact(xa).void
