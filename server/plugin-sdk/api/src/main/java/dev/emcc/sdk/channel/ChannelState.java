package dev.emcc.sdk.channel;

/**
 * SDK 1.9.0 (CR-0050 point 2; ADR-0059 point 5; owner, UQ4 A): how a channel is, as its offering
 * plugin sets it ({@link ChannelRef#state}) and its senders read it ({@link ChannelInfo#state()},
 * with {@link ChannelInfo#stateDetail()}). Only the channel's own state, not per item.
 */
public enum ChannelState {
  /** It sends; the default. */
  READY,
  /** It sends, with a fault, e.g. frames late. */
  DEGRADED,
  /** It takes items but sends nothing, e.g. no destination, no render thread, waiting for a conversion slot. */
  NOT_SENDING
}
