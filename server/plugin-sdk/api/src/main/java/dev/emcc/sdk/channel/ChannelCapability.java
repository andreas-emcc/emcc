package dev.emcc.sdk.channel;

/** SDK 1.2.0: what an output channel can do besides sending updates (ADR-0037 point 4). */
public enum ChannelCapability {
  /**
   * It can send a delete. Without it, a {@link ChannelItem.Removal} only stops the channel sending
   * the object, and the receiver keeps it until it goes stale.
   */
  DELETE
}
