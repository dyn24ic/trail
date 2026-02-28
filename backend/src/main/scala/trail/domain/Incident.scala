package trail.domain

import io.circe.{Decoder, Encoder}
import io.circe.generic.semiauto.*

enum IncidentStatus:
  case Triggered, Searching, VictimFound, Triaged, Routed, Closed

object IncidentStatus:
  given Encoder[IncidentStatus] = Encoder[String].contramap(_.toString)
  given Decoder[IncidentStatus] = Decoder[String].emap:
    case "Triggered"   => Right(IncidentStatus.Triggered)
    case "Searching"   => Right(IncidentStatus.Searching)
    case "VictimFound" => Right(IncidentStatus.VictimFound)
    case "Triaged"     => Right(IncidentStatus.Triaged)
    case "Routed"      => Right(IncidentStatus.Routed)
    case "Closed"      => Right(IncidentStatus.Closed)
    case other         => Left(s"Unknown status: $other")

final case class Incident(
  id: String,
  triggerType: String,
  triggerPayload: String,
  status: IncidentStatus,
  locationLat: Option[Double],
  locationLng: Option[Double],
  searchZones: Option[List[SearchZone]],
  droneResult: Option[DroneResult],
  triage: Option[InjuryTriage],
  route: Option[ResponderRoute],
  createdAt: String,
  updatedAt: String,
  report: Option[IncidentReport] = None
)

object Incident:
  given Encoder[Incident] = deriveEncoder
  given Decoder[Incident] = deriveDecoder

final case class IncidentSummary(
  id: String,
  triggerType: String,
  status: IncidentStatus,
  locationLat: Option[Double],
  locationLng: Option[Double],
  createdAt: String,
  updatedAt: String
)

object IncidentSummary:
  given Encoder[IncidentSummary] = deriveEncoder
  given Decoder[IncidentSummary] = deriveDecoder
