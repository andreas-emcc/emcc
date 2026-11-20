package dev.emcc.plugins.gmti.format;

import java.util.Objects;

/**
 * A free text segment (AEDP 3.8, Table 3-19). Skipped and counted; only logged at debug (brief
 * section 2). The decoder keeps at most {@link #MAX_KEPT} characters of the text.
 *
 * @param originator {@code F1}
 * @param recipient {@code F2}
 * @param text {@code F3}, cut to {@link #MAX_KEPT} characters
 */
public record FreeText(String originator, String recipient, String text) implements Segment {

  /** The most characters of a text the decoder keeps. */
  public static final int MAX_KEPT = 256;

  public FreeText {
    Objects.requireNonNull(originator, "originator");
    Objects.requireNonNull(recipient, "recipient");
    Objects.requireNonNull(text, "text");
  }

  @Override
  public int type() {
    return FREE_TEXT;
  }
}
