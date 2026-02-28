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
import trail.domain.{SearchZone, TriggerEvent}

import java.time.{Instant, ZoneOffset}

/**
 * Predicts search zones given a TriggerEvent.
 *
 * Priority:
 *   1. POST {BREV_SEARCH_ZONE_URL}/predict_zones  →  Nemotron 70B on Brev
 *   2. Random-offset fallback (original mock implementation)
 *
 * Configure by setting BREV_SEARCH_ZONE_URL in the environment.
 * If the variable is absent or the call fails, the fallback is used transparently.
 */
class SearchZonePredictorService:

  private val brevUrl    = sys.env.get("BREV_SEARCH_ZONE_URL").filter(_.nonEmpty)
  private val brevApiKey = sys.env.get("BREV_API_KEY").filter(_.nonEmpty)

  def predict(event: TriggerEvent): IO[List[SearchZone]] =
    brevUrl match
      case Some(url) => callBrev(url, event).handleErrorWith { err =>
        IO.println(s"[SearchZonePredictor] Brev call failed ($err) — using fallback") *>
          IO.pure(randomFallback(event.lat, event.lng))
      }
      case None =>
        IO.pure(randomFallback(event.lat, event.lng))

  // ---------------------------------------------------------------------------
  // Brev HTTP call
  // ---------------------------------------------------------------------------

  private def callBrev(baseUrl: String, event: TriggerEvent): IO[List[SearchZone]] =
    EmberClientBuilder.default[IO].build.use { client =>
      val now       = Instant.now().atOffset(ZoneOffset.UTC)
      val month     = now.getMonthValue
      val hourLocal = now.getHour

      val triggerType    = TriggerEvent.triggerType(event)
      val triggerPayload = io.circe.Encoder[TriggerEvent].apply(event)

      val body = Json.obj(
        "trigger_type"          -> Json.fromString(triggerType),
        "lat"                   -> Json.fromDoubleOrNull(event.lat),
        "lng"                   -> Json.fromDoubleOrNull(event.lng),
        "trigger_payload"       -> triggerPayload,
        "month"                 -> Json.fromInt(month),
        "hour_local"            -> Json.fromInt(hourLocal),
        "incident_type_context" -> Json.fromString("unknown"),
      )

      val uri = Uri.unsafeFromString(s"$baseUrl/predict_zones")

      val headersBuilder = Headers(
        `Content-Type`(MediaType.application.json),
      )
      val authHeaders = brevApiKey.fold(headersBuilder)(key =>
        headersBuilder.put(Authorization(
          org.http4s.Credentials.Token(org.http4s.AuthScheme.Bearer, key)
        ))
      )

      val req = Request[IO](
        method  = Method.POST,
        uri     = uri,
        headers = authHeaders,
      ).withEntity(body.noSpaces)

      client.expect[String](req).flatMap { rawJson =>
        IO.fromEither(
          parser.parse(rawJson)
            .flatMap { json =>
              json.hcursor
                .downField("search_zones")
                .as[List[Json]]
                .map(_.flatMap(parseZone))
            }
        )
      }
    }

  private def parseZone(j: Json): Option[SearchZone] =
    for
      lat  <- j.hcursor.downField("lat").as[Double].toOption
      lng  <- j.hcursor.downField("lng").as[Double].toOption
      rad  =  j.hcursor.downField("radiusMeters").as[Double].getOrElse(300.0)
      conf =  j.hcursor.downField("confidence").as[Double].getOrElse(0.5)
      if lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    yield SearchZone(lat, lng, radiusMeters = rad, confidence = conf)

  // ---------------------------------------------------------------------------
  // Random fallback (original implementation)
  // ---------------------------------------------------------------------------

  private def randomFallback(lat: Double, lng: Double): List[SearchZone] =
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
      SearchZone(offsetDeg(lat), offsetDeg(lng), radiusMeters = 500.0, confidence = confidence),
    ).sortBy(-_.confidence)
