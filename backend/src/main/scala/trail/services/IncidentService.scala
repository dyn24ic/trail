package trail.services

import cats.effect.IO
import cats.effect.std.UUIDGen
import java.time.Instant
import trail.domain.*
import trail.repository.IncidentRepository

class IncidentService(
  repo:           IncidentRepository,
  zonePredictor:  SearchZonePredictorService,
  droneDispatch:  DroneDispatchService,
  triageService:  TriageService,
  routingService: ResponderRoutingService
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
      _        <- runPipeline(incident, event).start
    yield incident

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

      _ <- {
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
               } yield ()
             else
               IO.unit
           }
    yield ()

  def getIncident(id: String): IO[Option[Incident]] =
    repo.findById(id)

  def listIncidents: IO[List[Incident]] =
    repo.findAll
