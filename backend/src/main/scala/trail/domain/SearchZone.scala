package trail.domain

import io.circe.{Decoder, Encoder}
import io.circe.generic.semiauto.*

final case class SearchZone(
  lat: Double,
  lng: Double,
  radiusMeters: Double,
  confidence: Double
)

object SearchZone:
  given Encoder[SearchZone] = deriveEncoder
  given Decoder[SearchZone] = deriveDecoder
