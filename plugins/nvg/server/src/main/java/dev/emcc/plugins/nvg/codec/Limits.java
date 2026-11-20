package dev.emcc.plugins.nvg.codec;

/**
 * The limits of a read document (brief, section 4; assumption N10). Over a limit the whole
 * document is refused with its reason.
 *
 * @param maxBytes the document's size, at most 16 MiB
 * @param maxDepth how deep elements nest
 * @param maxItems shapes, groups and composites
 * @param maxPoints coordinate pairs in all {@code points} attributes
 * @param maxText characters of one attribute value or one element's text
 */
public record Limits(int maxBytes, int maxDepth, int maxItems, long maxPoints, int maxText) {

  public static final int MIB = 1024 * 1024;

  /** The brief's limits: 16 MiB, depth 64, 100 000 items, 1 000 000 points, 1 MiB of text. */
  public static final Limits DEFAULT = new Limits(16 * MIB, 64, 100_000, 1_000_000, MIB);

  public Limits {
    if (maxBytes < 1 || maxDepth < 2 || maxItems < 1 || maxPoints < 1 || maxText < 1) {
      throw new IllegalArgumentException("limits must be positive");
    }
  }

  /** These limits with a smaller document size, from the {@code maxDocumentMegabytes} setting. */
  public Limits withMegabytes(int megabytes) {
    return new Limits(Math.min(maxBytes, megabytes * MIB), maxDepth, maxItems, maxPoints, maxText);
  }
}
