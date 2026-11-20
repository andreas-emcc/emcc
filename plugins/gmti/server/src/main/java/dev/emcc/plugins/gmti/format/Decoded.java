package dev.emcc.plugins.gmti.format;

import org.jspecify.annotations.Nullable;

/**
 * What the decoder made of one packet's bytes: the packet, or a refusal with its reason (one of the
 * brief's drop reasons, section 6) and a detail for the debug log.
 *
 * @param packet the packet, or {@code null} when refused
 * @param reason {@code null}, or the drop reason
 * @param detail what was wrong, for the debug log; never received data
 */
public record Decoded(@Nullable Packet packet, @Nullable String reason, @Nullable String detail) {

  /** A packet whose sizes do not add up, a segment past the packet's end, a mask that cannot be true, a dwell in a job-0 packet. */
  public static final String MALFORMED = "malformed";
  /** A packet larger than {@link Decoder#MAX_PACKET} (framing). */
  public static final String TOO_LONG = "too long";
  /** A datagram whose length is not its packet's {@code P2} (UDP). */
  public static final String SIZE_MISMATCH = "size mismatch";

  static Decoded of(Packet packet) {
    return new Decoded(packet, null, null);
  }

  static Decoded refused(String reason, String detail) {
    return new Decoded(null, reason, detail);
  }
}
