package trail.domain

import io.circe.{Decoder, Encoder}
import io.circe.generic.semiauto.*

final case class DroneResult(
  victimFound: Boolean,
  victimLat: Option[Double],
  victimLng: Option[Double],
  confidence: Double,
  imageUrl: Option[String],
  scanDurationSeconds: Int
)

object DroneResult:
  given Encoder[DroneResult] = deriveEncoder
  given Decoder[DroneResult] = deriveDecoder
