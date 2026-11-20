package dev.emcc.sdk.channel;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * SDK 1.2.0: a channel's id: the offering plugin and its link's name (ADR-0037 point 4). A sender
 * may keep it, e.g. in its saved state, and finds the channel again by it; a link that was renamed
 * or removed has no channel any more, and the sender shows it as missing (ACA note N8).
 *
 * <pre>{@code
 * new ChannelId("cot", "tak-north")     // shown as cot/tak-north
 * }</pre>
 *
 * @param plugin the offering plugin's id
 * @param link the link's name, which is also the data source of what it receives (ADR-0023):
 *     lowercase words separated by hyphens, at most 64 characters
 */
public record ChannelId(String plugin, String link) {

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public ChannelId {
    Objects.requireNonNull(plugin, "plugin");
    Objects.requireNonNull(link, "link");
    if (!NAME.matcher(plugin).matches() || plugin.length() > 64) {
      throw new IllegalArgumentException("not a plugin id: " + plugin);
    }
    checkLink(link);
  }

  static void checkLink(String link) {
    if (!NAME.matcher(link).matches() || link.length() > 64) {
      throw new IllegalArgumentException("a link's name is lowercase words separated by hyphens, at most 64 characters: " + link);
    }
  }

  /**
   * Parses {@link #toString()}'s form, {@code plugin/link}.
   *
   * @throws IllegalArgumentException if {@code text} is not of that form
   */
  public static ChannelId parse(String text) {
    int slash = text.indexOf('/');
    if (slash < 0) {
      throw new IllegalArgumentException("a channel id is plugin/link: " + text);
    }
    return new ChannelId(text.substring(0, slash), text.substring(slash + 1));
  }

  /** {@code plugin/link}, e.g. {@code cot/tak-north}. */
  @Override
  public String toString() {
    return plugin + "/" + link;
  }
}
