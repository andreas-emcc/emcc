package dev.emcc.plugins.nvg.codec;

import java.util.Map;
import java.util.Objects;

/**
 * One ring of an area's {@code exclude}: a hole.
 *
 * @param element {@code linear-ring}, {@code circular-ring}, {@code elliptic-ring}, {@code arcband-ring} or {@code rect-ring}
 * @param attributes its attributes as written, e.g. {@code points}
 */
public record Ring(String element, Map<String, String> attributes) {

  public Ring {
    Objects.requireNonNull(element, "element");
    attributes = Map.copyOf(attributes);
  }
}
