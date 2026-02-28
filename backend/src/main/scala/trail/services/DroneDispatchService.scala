package trail.services

import cats.effect.IO
import scala.util.Random
import trail.domain.{DroneResult, SearchZone}

class DroneDispatchService:

  def scan(zones: List[SearchZone]): IO[DroneResult] = IO:
    val rng = new Random()
    val victimFound = rng.nextDouble() < 0.80

    if victimFound then
      val zone = zones.head
      val victLat = zone.lat + (rng.nextDouble() * 0.004 - 0.002)
      val victLng = zone.lng + (rng.nextDouble() * 0.004 - 0.002)
      DroneResult(
        victimFound = true,
        victimLat = Some(victLat),
        victimLng = Some(victLng),
        confidence = 0.75 + rng.nextDouble() * 0.20,
        imageUrl = Some(
          s"https://mock-drone-feed.trail.app/frames/${System.currentTimeMillis()}"
        ),
        scanDurationSeconds = 120 + rng.nextInt(180)
      )
    else
      DroneResult(
        victimFound = false,
        victimLat = None,
        victimLng = None,
        confidence = 0.0,
        imageUrl = None,
        scanDurationSeconds = 300 + rng.nextInt(120)
      )
