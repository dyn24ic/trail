package trail.services

import cats.effect.IO
import io.circe.{Json, parser}
import io.circe.syntax.*
import org.http4s.{Headers, Method, Request, Uri}
import org.http4s.client.Client
import org.http4s.headers.{Authorization, `Content-Type`}
import org.http4s.MediaType
import org.http4s.ember.client.EmberClientBuilder
import scala.util.Random
import trail.domain.{InjuryTriage, ResponderRoute, RouteStep, Severity}

import java.time.{Instant, ZoneOffset}

/**
 * Calculates the fastest and safest responder route from trailhead to victim.
 *
 * Priority:
 *   1. POST {BREV_ROUTE_URL}/predict_route  →  Nemotron 70B on Brev
 *   2. Haversine + fixed 4-step fallback (original mock implementation)
 *
 * Configure by setting BREV_ROUTE_URL in the environment.
 * If the variable is absent or the call fails, the fallback is used transparently.
 */
class ResponderRoutingService:

  private val brevUrl    = sys.env.get("BREV_ROUTE_URL").filter(_.nonEmpty)
  private val brevApiKey = sys.env.get("BREV_API_KEY").filter(_.nonEmpty)

  def route(
    trailheadLat: Double,
    trailheadLng: Double,
    victimLat:    Double,
    victimLng:    Double,
    triage:       InjuryTriage,
  ): IO[ResponderRoute] =
    brevUrl match
      case Some(url) => callBrev(url, trailheadLat, trailheadLng, victimLat, victimLng, triage)
          .handleErrorWith { err =>
            IO.println(s"[ResponderRoutingService] Brev call failed ($err) — using fallback") *>
              IO.pure(haversineFallback(trailheadLat, trailheadLng, victimLat, victimLng, triage))
          }
      case None =>
        IO.pure(haversineFallback(trailheadLat, trailheadLng, victimLat, victimLng, triage))

  // ---------------------------------------------------------------------------
  // Brev HTTP call
  // ---------------------------------------------------------------------------

  private def callBrev(
    baseUrl:      String,
    thLat: Double, thLng: Double,
    vLat:  Double, vLng:  Double,
    triage: InjuryTriage,
  ): IO[ResponderRoute] =
    EmberClientBuilder.default[IO].build.use { client =>
      val now    = Instant.now().atOffset(ZoneOffset.UTC)
      val distKm = haversineKm(thLat, thLng, vLat, vLng)

      val triageJson = Json.obj(
        "severity"                      -> Json.fromString(triage.severity.toString),
        "injuryType"                    -> Json.fromString(triage.injuryType),
        "consciousAndResponsive"        -> Json.fromBoolean(triage.consciousAndResponsive),
        "recommendedResponse"           -> Json.fromString(triage.recommendedResponse),
        "estimatedMedicalUrgencyMinutes" -> Json.fromInt(triage.estimatedMedicalUrgencyMinutes),
      )

      val body = Json.obj(
        "trailhead_lat" -> Json.fromDoubleOrNull(thLat),
        "trailhead_lng" -> Json.fromDoubleOrNull(thLng),
        "victim_lat"    -> Json.fromDoubleOrNull(vLat),
        "victim_lng"    -> Json.fromDoubleOrNull(vLng),
        "distance_km"   -> Json.fromDoubleOrNull(distKm),
        "month"         -> Json.fromInt(now.getMonthValue),
        "hour_local"    -> Json.fromInt(now.getHour),
        "triage"        -> triageJson,
      )

      val uri = Uri.unsafeFromString(s"$baseUrl/predict_route")

      val baseHeaders = Headers(`Content-Type`(MediaType.application.json))
      val authHeaders = brevApiKey.fold(baseHeaders)(key =>
        baseHeaders.put(Authorization(
          org.http4s.Credentials.Token(org.http4s.AuthScheme.Bearer, key)
        ))
      )

      val req = Request[IO](method = Method.POST, uri = uri, headers = authHeaders)
        .withEntity(body.noSpaces)

      client.expect[String](req).flatMap { rawJson =>
        IO.fromEither(
          parser.parse(rawJson).flatMap(parseRoute)
        )
      }
    }

  private def parseRoute(json: Json): Either[io.circe.Error, ResponderRoute] =
    for
      steps      <- json.hcursor.downField("steps").as[List[Json]]
      totalDist  <- json.hcursor.downField("totalDistanceMeters").as[Double]
      totalEta   <- json.hcursor.downField("totalEtaMinutes").as[Int]
      accessType <- json.hcursor.downField("accessType").as[String]
      notes      <- json.hcursor.downField("notes").as[String]
    yield
      val parsedSteps = steps.zipWithIndex.flatMap { (sj, i) =>
        for
          desc  <- sj.hcursor.downField("description").as[String].toOption
          dist  <- sj.hcursor.downField("distanceMeters").as[Double].toOption
          mins  <- sj.hcursor.downField("estimatedMinutes").as[Int].toOption
          haz    = sj.hcursor.downField("hazards").as[List[String]].getOrElse(List.empty)
        yield RouteStep(i + 1, desc, dist, mins, haz)
      }
      ResponderRoute(parsedSteps, totalDist, totalEta, accessType, notes)

  // ---------------------------------------------------------------------------
  // Haversine fallback (original implementation)
  // ---------------------------------------------------------------------------

  private def haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double =
    val R    = 6371.0
    val dLat = math.toRadians(lat2 - lat1)
    val dLng = math.toRadians(lng2 - lng1)
    val a    = math.sin(dLat / 2) * math.sin(dLat / 2) +
               math.cos(math.toRadians(lat1)) * math.cos(math.toRadians(lat2)) *
               math.sin(dLng / 2) * math.sin(dLng / 2)
    2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))

  private def haversineFallback(
    thLat: Double, thLng: Double,
    vLat:  Double, vLng:  Double,
    triage: InjuryTriage,
  ): ResponderRoute =
    val rng        = new Random()
    val distKm     = haversineKm(thLat, thLng, vLat, vLng)
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
      RouteStep(4, "Stabilise and prepare for evacuation", distMeters * 0.10, (etaMin * 0.15).toInt, List.empty),
    )

    ResponderRoute(
      steps               = steps,
      totalDistanceMeters = distMeters,
      totalEtaMinutes     = etaMin,
      accessType          = accessType,
      notes               = s"Route optimised for $accessType access. Distance: ${"%.1f".format(distKm)} km.",
    )
