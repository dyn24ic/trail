package trail.domain

import io.circe.{Decoder, Encoder}
import io.circe.generic.semiauto.*

final case class PoliceReport(
  officerName:   String,
  badgeNumber:   String,
  description:   String,
  crimeInvolved: Boolean,
  submittedAt:   String
)

object PoliceReport:
  given Encoder[PoliceReport] = deriveEncoder
  given Decoder[PoliceReport] = deriveDecoder

final case class AmbulanceReport(
  paramedicName:       String,
  vehicleId:           String,
  treatmentGiven:      String,
  hospitalDestination: Option[String],
  submittedAt:         String
)

object AmbulanceReport:
  given Encoder[AmbulanceReport] = deriveEncoder
  given Decoder[AmbulanceReport] = deriveDecoder

final case class ExternalReports(
  police:    Option[PoliceReport],
  ambulance: Option[AmbulanceReport]
)

object ExternalReports:
  given Encoder[ExternalReports] = deriveEncoder
  given Decoder[ExternalReports] = deriveDecoder

final case class AiRecommendation(
  generatedAt:        String,
  summary:            String,
  immediateActions:   List[String],
  preventionMeasures: List[String],
  resourceNotes:      String,
  modelUsed:          String
)

object AiRecommendation:
  given Encoder[AiRecommendation] = deriveEncoder
  given Decoder[AiRecommendation] = deriveDecoder
