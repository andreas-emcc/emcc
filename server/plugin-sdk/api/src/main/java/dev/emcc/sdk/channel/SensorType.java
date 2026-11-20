package dev.emcc.sdk.channel;

/**
 * SDK 1.5.0 (CR-0039 point 7, CR-0040 point 3; T-169): what type of sensor made a {@link
 * ChannelItem.SensorReport}, said in its {@link ChannelItem.Sensor#type()}. A channel that takes
 * sensor reports may take only some types ({@link ChannelSpec#sensorTypes()}); a sender offers a
 * sensor only the channels that take its type. A sensor that says no type counts as {@link #GENERIC}
 * for that offer.
 */
public enum SensorType {
  /** A sensor that detects anything in its area, e.g. the simulator's generic sensor. */
  GENERIC,
  /**
   * A ground radar (owner, 2026-11-10, Q36), whose reports are its dwells: the type {@code gmti}
   * takes; {@code cot} and later outputs may take it too.
   */
  GROUND_RADAR
}
