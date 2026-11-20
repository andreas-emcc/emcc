package dev.emcc.sdk.channel;

/**
 * SDK 1.4.0: a kind of data an output channel takes (ADR-0048 point 4; CR-0030 part 1). A sender
 * sends a channel only the kinds it takes; {@link ChannelSpec#kinds()} says which.
 */
public enum ChannelKind {
  /** Objects as they are: {@link ChannelItem.Update} and {@link ChannelItem.Removal}. Every 1.3.0 channel takes it. */
  GROUND_TRUTH,
  /** What a sensor detects, in sensor reports: {@link ChannelItem.SensorReport}. */
  SENSOR_REPORTS
}
