package dev.emcc.sdk.http;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Immutable HTTP headers. Names compare case-insensitively; a name may occur more than once.
 *
 * <pre>{@code
 * Headers h = Headers.of("Content-Type", "image/png").with("Cache-Control", "max-age=86400");
 * h.first("content-type")   // "image/png"
 * }</pre>
 *
 * @param entries the headers in order
 */
public record Headers(List<Header> entries) {

  private static final Headers EMPTY = new Headers(List.of());

  public Headers {
    entries = List.copyOf(entries);
  }

  public static Headers empty() {
    return EMPTY;
  }

  public static Headers of(String name, String value) {
    return new Headers(List.of(new Header(name, value)));
  }

  /** A copy with one more header. */
  public Headers with(String name, String value) {
    var copy = new ArrayList<>(entries);
    copy.add(new Header(name, value));
    return new Headers(copy);
  }

  /** The first value of {@code name}, or {@code null}. */
  public @Nullable String first(String name) {
    for (Header h : entries) {
      if (h.name().equalsIgnoreCase(name)) {
        return h.value();
      }
    }
    return null;
  }

  /** All values of {@code name}, in order. */
  public List<String> all(String name) {
    return entries.stream().filter(h -> h.name().equalsIgnoreCase(name)).map(Header::value).toList();
  }

  /**
   * One header.
   *
   * @param name an HTTP token (RFC 9110), compared case-insensitively
   * @param value without line breaks
   */
  public record Header(String name, String value) {

    private static final Pattern TOKEN = Pattern.compile("[!#$%&'*+.^_`|~0-9A-Za-z-]+");

    public Header {
      Objects.requireNonNull(name, "name");
      Objects.requireNonNull(value, "value");
      if (!TOKEN.matcher(name).matches()) {
        throw new IllegalArgumentException("not a header name: " + name);
      }
      if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
        throw new IllegalArgumentException("header value contains a line break");
      }
    }

    /** The name in lower case, for comparisons. */
    public String key() {
      return name.toLowerCase(Locale.ROOT);
    }
  }
}
