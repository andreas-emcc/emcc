package dev.emcc.plugins.cot;

/** Text that came from a peer, from a parser or from the store, made fit for a log line and the status. */
final class Text {

  /** The longest text of that kind that is shown. */
  static final int MAX = 200;

  private Text() {}

  /**
   * No control character and no Unicode line or paragraph separator (so no forged log line), cut to
   * {@link #MAX} characters.
   */
  static String clean(String text) {
    String plain = text.replaceAll("[\\p{Cntrl}\\u0085\\u2028\\u2029]", " ");
    return plain.length() <= MAX ? plain : plain.substring(0, MAX - 3) + "...";
  }
}
