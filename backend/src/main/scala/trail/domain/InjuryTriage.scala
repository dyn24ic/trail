package trail.domain

import io.circe.{Decoder, Encoder}
import io.circe.generic.semiauto.*

enum InjuryType:
  case Fall, Drowning, Medical, Vehicle, Rockfall, Lightning, SearchRescue, FireRelated, Unknown

object InjuryType:
  given Encoder[InjuryType] = Encoder[String].contramap:
    case InjuryType.Fall         => "fall"
    case InjuryType.Drowning     => "drowning"
    case InjuryType.Medical      => "medical"
    case InjuryType.Vehicle      => "vehicle"
    case InjuryType.Rockfall     => "rockfall"
    case InjuryType.Lightning    => "lightning"
    case InjuryType.SearchRescue => "search_rescue"
    case InjuryType.FireRelated  => "fire_related"
    case InjuryType.Unknown      => "unknown"
  given Decoder[InjuryType] = Decoder[String].emap:
    case "fall"          => Right(InjuryType.Fall)
    case "drowning"      => Right(InjuryType.Drowning)
    case "medical"       => Right(InjuryType.Medical)
    case "vehicle"       => Right(InjuryType.Vehicle)
    case "rockfall"      => Right(InjuryType.Rockfall)
    case "lightning"     => Right(InjuryType.Lightning)
    case "search_rescue" => Right(InjuryType.SearchRescue)
    case "fire_related"  => Right(InjuryType.FireRelated)
    case "unknown"       => Right(InjuryType.Unknown)
    case other           => Left(s"Unknown injury type: $other")

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
  injuryType: InjuryType,
  consciousAndResponsive: Boolean,
  recommendedResponse: String,
  estimatedMedicalUrgencyMinutes: Int
)

object InjuryTriage:
  given Encoder[InjuryTriage] = deriveEncoder
  given Decoder[InjuryTriage] = deriveDecoder
