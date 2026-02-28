package trail.domain

import io.circe.{Decoder, Encoder}
import io.circe.generic.semiauto.*

enum Severity:
  case Minor, Moderate, Severe

object Severity:
  given Encoder[Severity] = Encoder[String].contramap(_.toString)
  given Decoder[Severity] = Decoder[String].emap:
    case "Minor"    => Right(Severity.Minor)
    case "Moderate" => Right(Severity.Moderate)
    case "Severe"   => Right(Severity.Severe)
    case other      => Left(s"Unknown severity: $other")

final case class InjuryTriage(
  severity: Severity,
  injuryType: String,
  consciousAndResponsive: Boolean,
  recommendedResponse: String,
  estimatedMedicalUrgencyMinutes: Int
)

object InjuryTriage:
  given Encoder[InjuryTriage] = deriveEncoder
  given Decoder[InjuryTriage] = deriveDecoder
