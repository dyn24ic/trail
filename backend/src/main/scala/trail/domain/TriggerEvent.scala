package trail.domain

import io.circe.{Decoder, Encoder}
import io.circe.generic.semiauto.*

sealed trait TriggerEvent:
  def lat: Double
  def lng: Double

object TriggerEvent:
  final case class CallBox(
      deviceId: String,
      lat: Double,
      lng: Double
  ) extends TriggerEvent

  final case class SensorAnomaly(
      sensorId: String,
      anomalyType: String,
      lat: Double,
      lng: Double
  ) extends TriggerEvent

  final case class OverdueHiker(
      hikerId: String,
      trailId: String,
      overdueMinutes: Int,
      lastKnownLat: Double,
      lastKnownLng: Double
  ) extends TriggerEvent:
    val lat: Double = lastKnownLat
    val lng: Double = lastKnownLng

  final case class Emergency911(
      callId: String,
      callerDescription: String,
      lat: Double,
      lng: Double
  ) extends TriggerEvent

  given callBoxEncoder: Encoder[CallBox] = deriveEncoder
  given callBoxDecoder: Decoder[CallBox] = deriveDecoder
  given sensorAnomalyEncoder: Encoder[SensorAnomaly] = deriveEncoder
  given sensorAnomalyDecoder: Decoder[SensorAnomaly] = deriveDecoder
  given overdueHikerEncoder: Encoder[OverdueHiker] = deriveEncoder
  given overdueHikerDecoder: Decoder[OverdueHiker] = deriveDecoder
  given emergency911Encoder: Encoder[Emergency911] = deriveEncoder
  given emergency911Decoder: Decoder[Emergency911] = deriveDecoder

  given Encoder[TriggerEvent] = Encoder.instance {
    case e: CallBox       => callBoxEncoder(e)
    case e: SensorAnomaly => sensorAnomalyEncoder(e)
    case e: OverdueHiker  => overdueHikerEncoder(e)
    case e: Emergency911  => emergency911Encoder(e)
  }

  given Decoder[TriggerEvent] =
    callBoxDecoder
      .map(e => e: TriggerEvent)
      .or(sensorAnomalyDecoder.map(e => e: TriggerEvent))
      .or(overdueHikerDecoder.map(e => e: TriggerEvent))
      .or(emergency911Decoder.map(e => e: TriggerEvent))

  def triggerType(e: TriggerEvent): String = e match
    case _: CallBox       => "CallBox"
    case _: SensorAnomaly => "SensorAnomaly"
    case _: OverdueHiker  => "OverdueHiker"
    case _: Emergency911  => "Emergency911"
