package trail.services

import cats.effect.IO
import java.time.Instant
import trail.domain.*

class PostMortemService:

  def generate(incident: Incident): IO[IncidentReport] = IO:
    val now         = Instant.now().toString
    val triggered   = Instant.parse(incident.createdAt)
    val completed   = Instant.parse(incident.updatedAt)
    val totalMin    = ((completed.toEpochMilli - triggered.toEpochMilli) / 60000L).toInt max 1

    val droneResult  = incident.droneResult
    val victimFound  = droneResult.exists(_.victimFound)
    val droneSeconds = droneResult.map(_.scanDurationSeconds).getOrElse(0)
    val triageSev    = incident.triage.map(_.severity.toString)

    val zones        = incident.searchZones.getOrElse(Nil)
    val bestConf     = if zones.isEmpty then 0.0 else zones.map(_.confidence).max
    val droneConf    = droneResult.map(_.confidence).getOrElse(0.0)
    val eta          = incident.route.map(_.totalEtaMinutes).getOrElse(0)
    val access       = incident.route.map(_.accessType).getOrElse("unknown")
    val urgency      = incident.triage.map(_.estimatedMedicalUrgencyMinutes)

    val lat = incident.locationLat.getOrElse(0.0)
    val lng = incident.locationLng.getOrElse(0.0)
    val severity = incident.triage.map(_.severity.toString).getOrElse("unknown")

    // ── Timeline ──────────────────────────────────────────────────────────
    val timeline = ReportTimeline(
      triggeredAt          = incident.createdAt,
      totalResponseMinutes = totalMin,
      droneSearchSeconds   = droneSeconds,
      victimFound          = victimFound,
      triageSeverity       = triageSev
    )

    // ── Response metrics ──────────────────────────────────────────────────
    val metrics = ResponseMetrics(
      searchZoneCount    = zones.size,
      bestZoneConfidence = bestConf,
      droneConfidence    = droneConf,
      etaMinutes         = eta,
      accessType         = access,
      medicalUrgencyMin  = urgency
    )

    // ── Root cause analysis ───────────────────────────────────────────────
    val foundMsg = if victimFound then
      s"Victim located with $severity injuries."
    else
      "Victim not located by drone; ground search or self-evacuation possible."

    val rootCause = incident.triggerType match
      case "Emergency911" =>
        s"Emergency 911 call received at (${f"$lat%.4f"}, ${f"$lng%.4f"}). $foundMsg " +
        "Incident likely triggered by sudden incapacitation or acute injury on trail."
      case "OverdueHiker" =>
        s"Hiker reported overdue at last known position (${f"$lat%.4f"}, ${f"$lng%.4f"}). $foundMsg " +
        "Overdue incidents often indicate navigation error, fatigue, or injury preventing self-return."
      case "SensorAnomaly" =>
        s"Automated sensor anomaly detected at (${f"$lat%.4f"}, ${f"$lng%.4f"}). $foundMsg " +
        "Sensor-triggered incidents may indicate fall, prolonged stationary presence, or audio distress."
      case "CallBox" =>
        s"Emergency call box activated at (${f"$lat%.4f"}, ${f"$lng%.4f"}). $foundMsg " +
        "Call box activations indicate hiker self-awareness of distress; infrastructure placement effective."
      case other =>
        s"Incident type '$other' triggered at (${f"$lat%.4f"}, ${f"$lng%.4f"}). $foundMsg"

    // ── Recommendations ───────────────────────────────────────────────────
    val recs = scala.collection.mutable.ListBuffer[TrailRecommendation]()

    val allHazards = incident.route.map(_.steps.flatMap(_.hazards)).getOrElse(Nil).distinct

    if allHazards.contains("Steep slope") then
      recs += TrailRecommendation(
        category    = "warning_sign",
        priority    = "high",
        lat         = Some(lat + 0.001),
        lng         = Some(lng),
        description = "Install high-visibility warning sign at steep slope approach",
        rationale   = "Steep slope encountered on responder route; hiker fall risk elevated in this zone."
      )

    if allHazards.contains("River crossing") then
      recs += TrailRecommendation(
        category    = "warning_sign",
        priority    = "medium",
        lat         = Some(lat),
        lng         = Some(lng + 0.001),
        description = "Post river crossing advisory with current flow level indicator",
        rationale   = "River crossing identified on route; seasonal water levels create variable hazard."
      )

    if allHazards.contains("Loose rock") then
      recs += TrailRecommendation(
        category    = "warning_sign",
        priority    = "medium",
        lat         = Some(lat - 0.001),
        lng         = Some(lng),
        description = "Mark loose rock zone with high-visibility trail markers",
        rationale   = "Loose rock encountered on rescue approach; rockfall risk for both hikers and responders."
      )

    incident.triggerType match
      case "SensorAnomaly" =>
        recs += TrailRecommendation(
          category    = "sensor_placement",
          priority    = "medium",
          lat         = Some(lat + 0.0015),
          lng         = Some(lng + 0.0015),
          description = "Evaluate additional sensor coverage in adjacent zones",
          rationale   = "Sensor anomaly triggered this incident; verify field of view and close any detection gaps."
        )
      case "CallBox" =>
        recs += TrailRecommendation(
          category    = "sensor_placement",
          priority    = "low",
          lat         = Some(lat - 0.0015),
          lng         = Some(lng - 0.0015),
          description = "Assess passive sensor deployment near call box location",
          rationale   = "Call box activation indicates this zone needs earlier automated detection capability."
        )
      case _ => ()

    if !victimFound then
      recs += TrailRecommendation(
        category    = "sensor_placement",
        priority    = "high",
        lat         = Some(lat + 0.002),
        lng         = Some(lng - 0.001),
        description = "Deploy additional sensors to eliminate drone search blind spot",
        rationale   = "Drone failed to locate victim in predicted zones; area likely has a detection coverage gap."
      )

    incident.triage.foreach { t =>
      t.severity match
        case Severity.Severe =>
          recs += TrailRecommendation(
            category    = "trail_closure",
            priority    = "critical",
            lat         = Some(lat),
            lng         = Some(lng - 0.002),
            description = "Initiate temporary trail closure pending hazard re-assessment",
            rationale   = s"Severe injury (${t.injuryType}) occurred in this zone; conditions may be unsafe for general access."
          )
        case Severity.Moderate =>
          recs += TrailRecommendation(
            category    = "risk_alert",
            priority    = "high",
            lat         = Some(lat - 0.001),
            lng         = Some(lng + 0.001),
            description = "Issue elevated risk alert for this trail segment",
            rationale   = s"Moderate injury (${t.injuryType}) recorded; hikers should be warned of current conditions."
          )
        case Severity.Minor => ()
    }

    if bestConf < 0.7 then
      recs += TrailRecommendation(
        category    = "trail_reroute",
        priority    = "medium",
        lat         = Some(lat + 0.001),
        lng         = Some(lng + 0.002),
        description = "Review trail routing to improve search zone predictability",
        rationale   = s"Low search zone confidence (best: ${f"$bestConf%.2f"}) suggests terrain complexity; rerouting may improve future response times."
      )

    IncidentReport(
      incidentId        = incident.id,
      generatedAt       = now,
      timeline          = timeline,
      rootCauseAnalysis = rootCause,
      responseMetrics   = metrics,
      recommendations   = recs.toList
    )
