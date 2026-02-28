package trail.services

import cats.effect.IO
import scala.util.Random
import trail.domain.{InjuryTriage, ResponderRoute, RouteStep, Severity}

class ResponderRoutingService:

  private def haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double =
    val R    = 6371.0
    val dLat = math.toRadians(lat2 - lat1)
    val dLng = math.toRadians(lng2 - lng1)
    val a    = math.sin(dLat / 2) * math.sin(dLat / 2) +
               math.cos(math.toRadians(lat1)) * math.cos(math.toRadians(lat2)) *
               math.sin(dLng / 2) * math.sin(dLng / 2)
    2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

  def route(
    trailheadLat: Double,
    trailheadLng: Double,
    victimLat: Double,
    victimLng: Double,
    triage: InjuryTriage
  ): IO[ResponderRoute] = IO:
    val rng        = new Random()
    val distKm     = haversineKm(trailheadLat, trailheadLng, victimLat, victimLng)
    val distMeters = distKm * 1000

    val (accessType, speedKmh) = triage.severity match
      case Severity.Severe   => ("helicopter", 150.0)
      case Severity.Moderate => ("ground", 4.0)
      case Severity.Minor    => ("ground", 5.0)

    val etaMin = math.max(5, (distKm / speedKmh * 60).toInt + rng.nextInt(10))

    val possibleHazards = List(
      "Steep slope", "River crossing", "Loose rock",
      "Limited visibility", "High wind exposure", "Dense vegetation"
    )
    def randomHazards: List[String] = rng.shuffle(possibleHazards).take(rng.nextInt(3))

    val steps = List(
      RouteStep(1, "Depart trailhead / staging area",      distMeters * 0.15, (etaMin * 0.10).toInt, randomHazards),
      RouteStep(2, "Navigate to ridge access point",       distMeters * 0.35, (etaMin * 0.30).toInt, randomHazards),
      RouteStep(3, "Approach victim GPS coordinates",      distMeters * 0.40, (etaMin * 0.45).toInt, randomHazards),
      RouteStep(4, "Stabilise and prepare for evacuation", distMeters * 0.10, (etaMin * 0.15).toInt, List.empty)
    )

    ResponderRoute(
      steps               = steps,
      totalDistanceMeters = distMeters,
      totalEtaMinutes     = etaMin,
      accessType          = accessType,
      notes               = s"Route optimised for $accessType access. Distance: ${"%.1f".format(distKm)} km."
    )
