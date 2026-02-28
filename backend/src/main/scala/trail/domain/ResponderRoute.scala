package trail.domain

import io.circe.{Decoder, Encoder}
import io.circe.generic.semiauto.*

final case class RouteStep(
  stepNumber: Int,
  description: String,
  distanceMeters: Double,
  estimatedMinutes: Int,
  hazards: List[String]
)

final case class ResponderRoute(
  steps: List[RouteStep],
  totalDistanceMeters: Double,
  totalEtaMinutes: Int,
  accessType: String,
  notes: String
)

object RouteStep:
  given Encoder[RouteStep] = deriveEncoder
  given Decoder[RouteStep] = deriveDecoder

object ResponderRoute:
  given Encoder[ResponderRoute] = deriveEncoder
  given Decoder[ResponderRoute] = deriveDecoder
