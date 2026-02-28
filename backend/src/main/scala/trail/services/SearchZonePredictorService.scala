package trail.services

import cats.effect.IO
import scala.util.Random
import trail.domain.SearchZone

class SearchZonePredictorService:

  def predict(lat: Double, lng: Double): IO[List[SearchZone]] = IO:
    val rng = new Random()

    def offsetDeg(base: Double, maxDelta: Double = 0.01): Double =
      base + (rng.nextDouble() * 2 * maxDelta) - maxDelta

    def confidence: Double =
      BigDecimal(0.5 + rng.nextDouble() * 0.45)
        .setScale(2, BigDecimal.RoundingMode.HALF_UP)
        .toDouble

    List(
      SearchZone(offsetDeg(lat), offsetDeg(lng), radiusMeters = 200.0, confidence = confidence),
      SearchZone(offsetDeg(lat), offsetDeg(lng), radiusMeters = 350.0, confidence = confidence),
      SearchZone(offsetDeg(lat), offsetDeg(lng), radiusMeters = 500.0, confidence = confidence)
    ).sortBy(-_.confidence)
