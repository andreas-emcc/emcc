package dev.emcc.sdk.channel;

/**
 * SDK 1.2.0: a channel the plugin offers. A value: it may travel in messages, as a {@code
 * WorkerRef} may.
 */
public interface ChannelRef {

  /** The channel's id: this plugin and the link. */
  ChannelId id();

  /**
   * Withdraws the channel, e.g. when its link goes: watchers get a list without it, items still
   * pending are dropped, and later sends to it return {@code CLOSED}. Calling it again has no
   * effect.
   */
  void withdraw();

  /**
   * SDK 1.9.0 (CR-0050 point 2; ADR-0059 point 5): sets the channel's state for its senders, e.g.
   * {@code state(ChannelState.NOT_SENDING, "No destination")}. Watchers get a new {@link
   * ChannelList} at each change (coalesced: the latest list only); setting the same state and detail
   * again changes nothing. A channel starts {@link ChannelState#READY} with an empty detail. Does
   * nothing once withdrawn.
   *
   * <p>Abstract since the 1.9.0 freeze, with part U (a default method that threw until ECore gave
   * it, C8's registry). The test kit's {@code FakeChannels} gives it.
   *
   * @param detail plain text, 0 to {@link ChannelInfo#MAX_STATE_DETAIL} characters, no control
   *     characters; may be empty
   * @throws IllegalArgumentException for a detail that is too long or holds a control character
   */
  void state(ChannelState state, String detail);
}
