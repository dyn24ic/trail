package trail.services

import cats.effect.IO
import io.circe.{Json, parser}
import io.circe.syntax.*
import org.http4s.{Headers, Method, Request, Uri}
import org.http4s.ember.client.EmberClientBuilder
import org.http4s.headers.{Authorization, `Content-Type`}
import org.http4s.MediaType
import java.time.Instant
import trail.domain.*

/**
 * Generates AI-powered incident recommendations using the OpenAI chat completions API.
 *
 * Priority:
 *   1. POST https://api.openai.com/v1/chat/completions (gpt-4o-mini)
 *   2. Rule-based fallback if OPENAI_API_KEY is absent or the call fails
 *
 * Configure by setting OPENAI_API_KEY in the environment.
 */
class AiRecommendationService:

  private val openAiKey = sys.env.get("OPENAI_API_KEY").filter(_.nonEmpty)
  private val model     = "gpt-4o-mini"

  def generate(incident: Incident): IO[AiRecommendation] =
    openAiKey match
      case Some(key) =>
        callOpenAi(key, incident).handleErrorWith { err =>
          IO.println(s"[AiRecommendation] OpenAI call failed ($err) — using fallback") *>
            IO.pure(ruleBased(incident))
        }
      case None =>
        IO.pure(ruleBased(incident))

  // ---------------------------------------------------------------------------
  // OpenAI chat completions call
  // ---------------------------------------------------------------------------

  private def buildPrompt(incident: Incident): String =
    val triage = incident.triage.map { t =>
      s"Severity: ${t.severity}, Injury: ${t.injuryType}, Conscious: ${t.consciousAndResponsive}, " +
      s"Urgency: ${t.estimatedMedicalUrgencyMinutes} min, Response: ${t.recommendedResponse}"
    }.getOrElse("No triage data available")

    val zones = incident.searchZones.map { zs =>
      zs.zipWithIndex.map { case (z, i) =>
        s"Zone ${i+1}: (${f"${z.lat}%.4f"}, ${f"${z.lng}%.4f"}), radius ${z.radiusMeters}m, confidence ${f"${z.confidence * 100}%.0f"}%%"
      }.mkString("; ")
    }.getOrElse("No zone data")

    val drone = incident.droneResult.map { d =>
      s"Victim found: ${d.victimFound}, Confidence: ${f"${d.confidence * 100}%.0f"}%%, Scan duration: ${d.scanDurationSeconds}s"
    }.getOrElse("No drone data")

    val route = incident.route.map { r =>
      val hazards = r.steps.flatMap(_.hazards).distinct
      s"Access: ${r.accessType}, ETA: ${r.totalEtaMinutes} min, Distance: ${f"${r.totalDistanceMeters / 1000}%.1f"} km" +
      (if hazards.nonEmpty then s", Hazards: ${hazards.mkString(", ")}" else "")
    }.getOrElse("No route data")

    val police = incident.externalReports.flatMap(_.police).map { p =>
      s"Officer: ${p.officerName} (${p.badgeNumber}), Crime involved: ${p.crimeInvolved}. Report: ${p.description}"
    }.getOrElse("No police report submitted")

    val ambulance = incident.externalReports.flatMap(_.ambulance).map { a =>
      val hospital = a.hospitalDestination.map(h => s", Hospital: $h").getOrElse("")
      s"Paramedic: ${a.paramedicName} (${a.vehicleId}). Treatment: ${a.treatmentGiven}$hospital"
    }.getOrElse("No ambulance report submitted")

    val latStr = incident.locationLat.map(v => BigDecimal(v).setScale(4, BigDecimal.RoundingMode.HALF_UP).toString).getOrElse("unknown")
    val lngStr = incident.locationLng.map(v => BigDecimal(v).setScale(4, BigDecimal.RoundingMode.HALF_UP).toString).getOrElse("unknown")

    s"""You are a search and rescue analytics AI. Analyse this trail incident and provide actionable recommendations.

INCIDENT SUMMARY
- ID: ${incident.id.take(12)}
- Trigger type: ${incident.triggerType}
- Location: ($latStr, $lngStr)
- Status: ${incident.status}

SEARCH & DRONE
- $zones
- $drone

TRIAGE
- $triage

RESPONDER ROUTE
- $route

POLICE REPORT
- $police

AMBULANCE REPORT
- $ambulance

Respond with a JSON object with exactly these fields:
{
  "summary": "<2-3 sentence incident summary>",
  "immediateActions": ["<action 1>", "<action 2>", "<action 3>"],
  "preventionMeasures": ["<measure 1>", "<measure 2>", "<measure 3>"],
  "resourceNotes": "<paragraph on resource deployment or infrastructure recommendations>"
}
Return only valid JSON with no markdown fences."""

  private def callOpenAi(apiKey: String, incident: Incident): IO[AiRecommendation] =
    EmberClientBuilder.default[IO].build.use { client =>
      val body = Json.obj(
        "model" -> Json.fromString(model),
        "messages" -> Json.arr(
          Json.obj(
            "role"    -> Json.fromString("user"),
            "content" -> Json.fromString(buildPrompt(incident))
          )
        ),
        "temperature"      -> Json.fromDoubleOrNull(0.4),
        "max_tokens"       -> Json.fromInt(600),
        "response_format"  -> Json.obj("type" -> Json.fromString("json_object"))
      )

      val req = Request[IO](
        method  = Method.POST,
        uri     = Uri.unsafeFromString("https://api.openai.com/v1/chat/completions"),
        headers = Headers(
          `Content-Type`(MediaType.application.json),
          Authorization(org.http4s.Credentials.Token(org.http4s.AuthScheme.Bearer, apiKey))
        )
      ).withEntity(body.noSpaces)

      client.expect[String](req).flatMap { raw =>
        IO.fromEither(
          parser.parse(raw).flatMap { json =>
            json.hcursor
              .downField("choices").downArray
              .downField("message")
              .downField("content")
              .as[String]
              .flatMap(parser.parse)
              .flatMap(parseRecommendation)
          }
        )
      }.map(_.copy(modelUsed = model))
    }

  private def parseRecommendation(json: Json): Either[io.circe.Error, AiRecommendation] =
    val c = json.hcursor
    for
      summary    <- c.downField("summary").as[String]
      immediate  <- c.downField("immediateActions").as[List[String]]
      prevention <- c.downField("preventionMeasures").as[List[String]]
      resources  <- c.downField("resourceNotes").as[String]
    yield AiRecommendation(
      generatedAt        = Instant.now().toString,
      summary            = summary,
      immediateActions   = immediate,
      preventionMeasures = prevention,
      resourceNotes      = resources,
      modelUsed          = model
    )

  // ---------------------------------------------------------------------------
  // Rule-based fallback
  // ---------------------------------------------------------------------------

  private def ruleBased(incident: Incident): AiRecommendation =
    val severity  = incident.triage.map(_.severity.toString).getOrElse("unknown")
    val injury    = incident.triage.map(_.injuryType.toString).getOrElse("unknown")
    val found     = incident.droneResult.exists(_.victimFound)
    val hazards   = incident.route.map(_.steps.flatMap(_.hazards).distinct).getOrElse(Nil)
    val trigType  = incident.triggerType

    val summary = s"$trigType incident with ${if found then s"$severity $injury" else "unlocated hiker"}. " +
      s"Drone scan ${if found then "located the victim" else "did not locate the victim"}. " +
      (if hazards.nonEmpty then s"Route hazards identified: ${hazards.take(2).mkString(", ")}." else "No major route hazards detected.")

    val immediate = List(
      if found then s"Confirm $severity triage with arriving paramedics" else "Expand ground search beyond drone coverage area",
      if hazards.contains("Steep slope") then "Brief all responders on steep slope approach protocol" else "Maintain responder radio contact throughout extraction",
      incident.triage.map(t => if t.severity == Severity.Severe then "Activate helicopter standby for evacuation" else s"Prepare stretcher for ${t.estimatedMedicalUrgencyMinutes}-min urgency extraction").getOrElse("Conduct thorough area sweep and document findings")
    )

    val prevention = List(
      s"Review trigger zone coverage for $trigType incidents — consider additional sensor nodes",
      if hazards.nonEmpty then s"Install hazard markers at ${hazards.head} areas along this trail segment" else "Conduct routine trail safety audit for this sector",
      "Update trail difficulty rating based on this incident's injury data and environmental conditions"
    )

    val resources = incident.triage.map { t =>
      s"Based on ${t.severity} severity and ${t.injuryType} injury type, recommend pre-positioning medical supplies at the nearest trailhead. " +
      s"Medical urgency window of ${t.estimatedMedicalUrgencyMinutes} minutes suggests ${if t.estimatedMedicalUrgencyMinutes <= 30 then "immediate ALS response" else "BLS response is appropriate"}."
    }.getOrElse("Recommend reviewing sensor coverage and emergency response protocols for this trail segment.")

    AiRecommendation(
      generatedAt        = Instant.now().toString,
      summary            = summary,
      immediateActions   = immediate,
      preventionMeasures = prevention,
      resourceNotes      = resources,
      modelUsed          = "fallback"
    )
