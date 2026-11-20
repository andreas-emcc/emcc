package dev.emcc.ecore.runtime;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * A named, typed channel of the message bus (overview 4.3), e.g. {@code objects.changed}.
 *
 * @param name lowercase words separated by dots, with at least one dot
 * @param type the payload type
 * @param <T> the payload type
 */
public record Topic<T>(String name, Class<T> type) {

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+");

  public Topic {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(type, "type");
    if (!NAME.matcher(name).matches() || name.length() > 128) {
      throw new IllegalArgumentException("topic name must be dotted lowercase words: " + name);
    }
  }

  public static <T> Topic<T> of(String name, Class<T> type) {
    return new Topic<>(name, type);
  }
}
