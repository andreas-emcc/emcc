package dev.emcc.plugins.nvg.codec;

import org.jspecify.annotations.Nullable;

/**
 * What reading a document gave: the document, or the reason it was refused. A record of nullable
 * fields, not a sealed interface, so that it may travel in a message (rule C3).
 *
 * @param document the document, or {@code null} when refused
 * @param counter the refusal's counter, e.g. {@code refused: DTD}; {@code null} when read
 * @param reason the refusal's reason for people, e.g. {@code NVG 1.5 is not supported; 2.0.x only}; {@code null} when read
 */
public record ReadResult(@Nullable NvgDocument document, @Nullable String counter, @Nullable String reason) {

  public static ReadResult read(NvgDocument document) {
    return new ReadResult(document, null, null);
  }

  public static ReadResult refused(String counter, String reason) {
    return new ReadResult(null, counter, reason);
  }

  public boolean isRefused() {
    return document == null;
  }
}
