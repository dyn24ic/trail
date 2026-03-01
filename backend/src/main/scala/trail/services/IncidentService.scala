package trail.services

import cats.effect.IO
import cats.effect.std.UUIDGen
import java.time.Instant
import trail.domain.*
import trail.repository.IncidentRepository

class IncidentService(
  repo:            IncidentRepository,
  zonePredictor:   SearchZonePredictorService,
  droneDispatch:   DroneDispatchService,
  triageService:   TriageService,
  routingService:  ResponderRoutingService,
  postMortemSvc:   PostMortemService,
  aiRecoSvc:       AiRecommendationService
):
  // Mock fixed trailhead for responder routing
  private val TrailheadLat = -33.8688
  private val TrailheadLng =  151.2093

  def handleTrigger(event: TriggerEvent): IO[Incident] =
    for
      id       <- UUIDGen.randomString[IO]
      now      =  Instant.now().toString
      payload  =  io.circe.Encoder[TriggerEvent].apply(event).noSpaces
      incident =  Incident(
                    id             = id,
                    triggerType    = TriggerEvent.triggerType(event),
                    triggerPayload = payload,
                    status         = IncidentStatus.Triggered,
                    locationLat    = Some(event.lat),
                    locationLng    = Some(event.lng),
                    searchZones    = None,
                    droneResult    = None,
                    triage         = None,
                    route          = None,
                    createdAt      = now,
                    updatedAt      = now
                  )
      _        <- repo.create(incident)
    yield incident

  /** Run the next pipeline stage for the given incident based on its current status. */
  def advanceStage(id: String): IO[Option[Incident]] =
    repo.findById(id).flatMap:
      case None => IO.pure(None)
      case Some(inc) =>
        val now = Instant.now().toString
        inc.status match

          case IncidentStatus.Triggered =>
            io.circe.parser.decode[TriggerEvent](inc.triggerPayload) match
              case Left(err) => IO.raiseError(new Exception(s"Cannot decode trigger: ${err.getMessage}"))
              case Right(event) =>
                for
                  zones   <- zonePredictor.predict(event)
                  updated =  inc.copy(status = IncidentStatus.Searching, searchZones = Some(zones), updatedAt = now)
                  _       <- repo.updateFull(updated)
                yield Some(updated)

          case IncidentStatus.Searching =>
            val zones = inc.searchZones.getOrElse(List.empty)
            for
              droneResult <- droneDispatch.scan(zones)
              nextStatus   = if droneResult.victimFound then IncidentStatus.VictimFound else IncidentStatus.Searching
              updated      = inc.copy(status = nextStatus, droneResult = Some(droneResult), updatedAt = now)
              _           <- repo.updateFull(updated)
            yield Some(updated)

          case IncidentStatus.VictimFound =>
            val lat = inc.droneResult.flatMap(_.victimLat).orElse(inc.locationLat).getOrElse(0.0)
            val lng = inc.droneResult.flatMap(_.victimLng).orElse(inc.locationLng).getOrElse(0.0)
            for
              triage  <- triageService.assess(lat, lng)
              updated =  inc.copy(status = IncidentStatus.Triaged, triage = Some(triage), updatedAt = now)
              _       <- repo.updateFull(updated)
            yield Some(updated)

          case IncidentStatus.Triaged =>
            val victimLat = inc.droneResult.flatMap(_.victimLat).orElse(inc.locationLat).getOrElse(0.0)
            val victimLng = inc.droneResult.flatMap(_.victimLng).orElse(inc.locationLng).getOrElse(0.0)
            for
              route   <- routingService.route(TrailheadLat, TrailheadLng, victimLat, victimLng, inc.triage.get)
              updated =  inc.copy(status = IncidentStatus.Routed, route = Some(route), updatedAt = now)
              _       <- repo.updateFull(updated)
            yield Some(updated)

          case IncidentStatus.Routed =>
            for
              report  <- postMortemSvc.generate(inc)
              updated =  inc.copy(status = IncidentStatus.Closed, report = Some(report), updatedAt = now)
              _       <- repo.updateFull(updated)
            yield Some(updated)

          case IncidentStatus.Closed =>
            IO.pure(Some(inc))

  private def runPipeline(incident: Incident, event: TriggerEvent): IO[Unit] =
    for
      zones      <- zonePredictor.predict(event)
      searching  =  incident.copy(
                      status      = IncidentStatus.Searching,
                      searchZones = Some(zones),
                      updatedAt   = Instant.now().toString
                    )
      _          <- repo.updateFull(searching)

      droneResult <- droneDispatch.scan(zones)
      postDrone   =  searching.copy(
                       status      = if droneResult.victimFound then IncidentStatus.VictimFound
                                     else IncidentStatus.Searching,
                       droneResult = Some(droneResult),
                       updatedAt   = Instant.now().toString
                     )
      _           <- repo.updateFull(postDrone)

      triaged <- {
                   if droneResult.victimFound then
                     for {
                       t  <- triageService.assess(
                               droneResult.victimLat.getOrElse(incident.locationLat.getOrElse(0.0)),
                               droneResult.victimLng.getOrElse(incident.locationLng.getOrElse(0.0))
                             )
                       up =  postDrone.copy(
                               status    = IncidentStatus.Triaged,
                               triage    = Some(t),
                               updatedAt = Instant.now().toString
                             )
                       _  <- repo.updateFull(up)
                     } yield up
                   else
                     IO.pure(postDrone)
                 }

      preReport <- {
                     if droneResult.victimFound then
                       for {
                         r  <- routingService.route(
                                 TrailheadLat,
                                 TrailheadLng,
                                 droneResult.victimLat.getOrElse(incident.locationLat.getOrElse(0.0)),
                                 droneResult.victimLng.getOrElse(incident.locationLng.getOrElse(0.0)),
                                 triaged.triage.get
                               )
                         up =  triaged.copy(
                                 status    = IncidentStatus.Routed,
                                 route     = Some(r),
                                 updatedAt = Instant.now().toString
                               )
                         _  <- repo.updateFull(up)
                       } yield up
                     else
                       IO.pure(postDrone)
                   }

      // ── Stage 5: Post-mortem report ────────────────────────────────────
      report <- postMortemSvc.generate(preReport)
      closed  =  preReport.copy(
                   status    = IncidentStatus.Closed,
                   report    = Some(report),
                   updatedAt = Instant.now().toString
                 )
      _      <- repo.updateFull(closed)
    yield ()

  def getIncident(id: String): IO[Option[Incident]] =
    repo.findById(id)

  def listIncidents: IO[List[Incident]] =
    repo.findAll

  def deleteAllIncidents: IO[Int] =
    repo.deleteAll

  def getReport(id: String): IO[Option[IncidentReport]] =
    repo.findById(id).map(_.flatMap(_.report))

  def submitPoliceReport(id: String, report: PoliceReport): IO[Option[Incident]] =
    repo.findById(id).flatMap:
      case None => IO.pure(None)
      case Some(inc) =>
        val existing = inc.externalReports.getOrElse(ExternalReports(None, None))
        val updated  = inc.copy(
          externalReports = Some(existing.copy(police = Some(report))),
          updatedAt       = java.time.Instant.now().toString
        )
        repo.updateFull(updated).as(Some(updated))

  def submitAmbulanceReport(id: String, report: AmbulanceReport): IO[Option[Incident]] =
    repo.findById(id).flatMap:
      case None => IO.pure(None)
      case Some(inc) =>
        val existing = inc.externalReports.getOrElse(ExternalReports(None, None))
        val updated  = inc.copy(
          externalReports = Some(existing.copy(ambulance = Some(report))),
          updatedAt       = java.time.Instant.now().toString
        )
        repo.updateFull(updated).as(Some(updated))

  def updateStatus(id: String, newStatus: IncidentStatus): IO[Option[Incident]] =
    repo.findById(id).flatMap:
      case None => IO.pure(None)
      case Some(_) =>
        val now = java.time.Instant.now().toString
        repo.patchStatus(id, newStatus, now).flatMap(_ => repo.findById(id))

  def generateAiRecommendation(id: String): IO[Option[AiRecommendation]] =
    repo.findById(id).flatMap:
      case None => IO.pure(None)
      case Some(inc) =>
        aiRecoSvc.generate(inc).flatMap { reco =>
          val updated = inc.copy(
            aiRecommendation = Some(reco),
            updatedAt        = java.time.Instant.now().toString
          )
          repo.updateFull(updated).as(Some(reco))
        }
