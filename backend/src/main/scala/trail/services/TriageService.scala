package trail.services

import cats.effect.IO
import scala.util.Random
import trail.domain.{InjuryTriage, InjuryType, Severity}

class TriageService:

  private val injuryTypes = InjuryType.values

  def assess(victimLat: Double, victimLng: Double): IO[InjuryTriage] = IO:
    val rng      = new Random()
    val severity = rng.nextInt(3) match
      case 0 => Severity.Minor
      case 1 => Severity.Moderate
      case _ => Severity.Severe

    val injury    = injuryTypes(rng.nextInt(injuryTypes.length))
    val conscious = severity match
      case Severity.Severe => rng.nextBoolean()
      case _               => true

    val (response, urgencyMin) = severity match
      case Severity.Minor    => ("First aid on scene, walk-out capable", 90)
      case Severity.Moderate => ("Stretcher evacuation required, monitor vitals", 45)
      case Severity.Severe   => ("Immediate helicopter evacuation, paramedic response", 15)

    InjuryTriage(
      severity                       = severity,
      injuryType                     = injury,
      consciousAndResponsive         = conscious,
      recommendedResponse            = response,
      estimatedMedicalUrgencyMinutes = urgencyMin
    )
