package trail.domain

import io.circe.generic.semiauto.*
import io.circe.{Decoder, Encoder}

final case class ReportTimeline(
  triggeredAt:          String,
  totalResponseMinutes: Int,
  droneSearchSeconds:   Int,
  victimFound:          Boolean,
  triageSeverity:       Option[String]
)

object ReportTimeline:
  given Encoder[ReportTimeline] = deriveEncoder
  given Decoder[ReportTimeline] = deriveDecoder

final case class ResponseMetrics(
  searchZoneCount:    Int,
  bestZoneConfidence: Double,
  droneConfidence:    Double,
  etaMinutes:         Int,
  accessType:         String,
  medicalUrgencyMin:  Option[Int]
)

object ResponseMetrics:
  given Encoder[ResponseMetrics] = deriveEncoder
  given Decoder[ResponseMetrics] = deriveDecoder

final case class TrailRecommendation(
  category:    String,
  priority:    String,
  lat:         Option[Double],
  lng:         Option[Double],
  description: String,
  rationale:   String
)

object TrailRecommendation:
  given Encoder[TrailRecommendation] = deriveEncoder
  given Decoder[TrailRecommendation] = deriveDecoder

final case class IncidentReport(
  incidentId:        String,
  generatedAt:       String,
  timeline:          ReportTimeline,
  rootCauseAnalysis: String,
  responseMetrics:   ResponseMetrics,
  recommendations:   List[TrailRecommendation]
)

object IncidentReport:
  given Encoder[IncidentReport] = deriveEncoder
  given Decoder[IncidentReport] = deriveDecoder
