package dev.emcc.ecore.runtime;

/**
 * Caps on what one owner may hold in the scheduler, so that one plugin cannot fill it for everyone
 * (CR-0005, overview 4.2). ECore's own owners are unlimited; the plugin host sets the plugin caps.
 *
 * @param outstandingAsks asks sent and not yet answered, failed or timed out; one more is answered
 *     at once with {@code Failed("too many outstanding asks")}
 * @param activeTimers {@code once} timers that have neither fired nor been cancelled, and {@code
 *     every} timers that have not been cancelled; one more makes {@code once} or {@code every} throw
 *     {@link IllegalStateException}
 */
public record OwnerLimits(int outstandingAsks, int activeTimers) {

  /** No caps: ECore's own owners. */
  public static final OwnerLimits UNLIMITED = new OwnerLimits(Integer.MAX_VALUE, Integer.MAX_VALUE);

  /** The reason of the {@code Failed} answer to an ask over the cap (the SDK's wording, CR-0005). */
  public static final String TOO_MANY_ASKS = "too many outstanding asks";

  /** Which cap was reached. */
  public enum Cap {
    OUTSTANDING_ASKS("outstanding asks"),
    ACTIVE_TIMERS("active timers");

    private final String text;

    Cap(String text) {
      this.text = text;
    }

    /** As it appears in log messages, e.g. "active timers". */
    public String text() {
      return text;
    }
  }

  public OwnerLimits {
    if (outstandingAsks < 1 || activeTimers < 1) {
      throw new IllegalArgumentException("limits must be at least 1: asks " + outstandingAsks + ", timers " + activeTimers);
    }
  }
}
