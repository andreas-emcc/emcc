package dev.emcc.plugins.ais.transport;

import org.jspecify.annotations.Nullable;

/**
 * What one link says about itself in the plugin's status (brief section 6): its name, where it is, its
 * state, and what it received and wrote in the last minute. Pure, so that every state can be tested.
 *
 * @param name the link's name
 * @param where {@link Link#where()}
 * @param udp whether it is a UDP link (it is {@code listening}, not {@code up})
 * @param state where it is now
 * @param error why it is down, as ECore or the task reported it; {@code null} otherwise
 * @param messagesPerMinute AIS messages of the used types decoded in the last minute
 * @param shipsPerMinute ships created or updated in the last minute
 * @param layer the name of the layer its ships go to, once known
 */
record LinkStatus(String name, String where, boolean udp, State state, @Nullable String error, long messagesPerMinute, long shipsPerMinute, @Nullable String layer) {

  /** The longest reason shown: a link's part is about 150 characters, and the whole status holds 512. */
  private static final int MAX_ERROR = 80;

  enum State { SWITCHED_OFF, DOWN, STARTING, UP }

  /** Whether the link does what it should: a link that is switched off is no problem. */
  boolean healthy() {
    return state == State.UP || state == State.SWITCHED_OFF;
  }

  String text() {
    String head = name + " [" + where + "]: ";
    return switch (state) {
      case SWITCHED_OFF -> head + "switched off";
      case DOWN -> head + "down: " + (error == null ? "not started" : cut(error)) + rates();
      case STARTING -> head + (udp ? "starting" : "connecting") + rates();
      case UP -> head + (udp ? "listening" : "up") + rates();
    };
  }

  private String rates() {
    return ", " + messagesPerMinute + " msg/min, " + shipsPerMinute + " ships/min" + (layer == null ? "" : ", layer '" + cut(layer) + "'");
  }

  private static String cut(String text) {
    String plain = clean(text);
    return plain.length() <= MAX_ERROR ? plain : plain.substring(0, MAX_ERROR - 3) + "...";
  }

  /** No control character and no Unicode line or paragraph separator, so that no line of a log or the status can be forged. */
  static String clean(String text) {
    return text.replaceAll("[\\p{Cntrl}\\u0085\\u2028\\u2029]", " ");
  }
}
