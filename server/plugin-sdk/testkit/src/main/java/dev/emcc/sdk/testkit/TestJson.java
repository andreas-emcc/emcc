package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * A small, strict JSON parser and writer for the test kit (RFC 8259: no comments, no trailing
 * commas, no duplicate names), so that the codec contract test does not depend on the codec it
 * tests. {@link #parse} and {@link #write} keep numbers as their exact text; {@link #normalize}
 * compares core numbers as doubles.
 *
 * <pre>{@code
 * JsonValue a = TestJson.parse(original);
 * JsonValue b = TestJson.parse(codec.write(codec.read(kind, original)));
 * assertThat(TestJson.normalize(b)).isEqualTo(TestJson.normalize(a));
 * }</pre>
 */
public final class TestJson {

  /** Optional members where empty means absent (model rule 13). */
  private static final Set<String> EMPTY_MEANS_ABSENT = Set.of("extensions", "modifiers", "style", "properties", "categories", "details");

  /**
   * Members whose value is free-form JSON, kept exactly (ADR-0007): extension data, and a plugin
   * manifest's settings schema with its defaults.
   */
  private static final Set<String> FREE_FORM = Set.of("extensions", "settings");

  private final String text;
  private final int maxDepth;
  private int pos;
  private int depth;

  private TestJson(String text, int maxDepth) {
    this.text = text;
    this.maxDepth = maxDepth;
  }

  public static JsonValue parse(String text) {
    return parse(text, Integer.MAX_VALUE);
  }

  /** As {@link #parse(String)}, refusing arrays and objects nested deeper than {@code maxDepth} (a POST body, CR-0026). */
  static JsonValue parse(String text, int maxDepth) {
    var p = new TestJson(text, maxDepth);
    p.skipWhitespace();
    JsonValue value = p.value();
    p.skipWhitespace();
    if (p.pos != text.length()) {
      throw p.error("trailing characters");
    }
    return value;
  }

  /**
   * Normalizes what the model treats as equal, at any depth except inside free-form JSON (extension
   * data, a manifest's settings), which is opaque and stays exact (model README, "Conventions"):
   *
   * <ul>
   *   <li>optional members whose value is an empty object or array are removed (model rule 13);
   *   <li>a 30-digit APP-6E SIDC ending in ten zeros becomes its 20-digit form;
   *   <li>a layer's {@code "workspace": "core.view"} is removed, since the store keeps View as
   *       absent and readers treat both alike (data model 1.2.0, R2), except in an update's {@code
   *       data}, where an absent {@code workspace} keeps the stored one and {@code core.view} must
   *       equal it;
   *   <li>likewise a layer's {@code "locked": false} is removed, since the store keeps it as absent
   *       (data model 1.3.0, ADR-0042), except in an update's {@code data}, where {@code false}
   *       clears the lock and an absent one keeps it;
   *   <li>numbers become the nearest IEEE 754 double, as the SDK's model types hold them (CR-0004).
   * </ul>
   */
  public static JsonValue normalize(JsonValue value) {
    return normalize(value, true);
  }

  private static JsonValue normalize(JsonValue value, boolean viewMeansAbsent) {
    return switch (value) {
      case JsonObject o -> {
        boolean app6e = o.get("standard") instanceof JsonString s && s.value().equals("APP-6E");
        boolean update = o.get("operation") instanceof JsonString op && op.value().equals("update");
        var b = JsonObject.builder();
        o.members().forEach((name, v) -> {
          if (EMPTY_MEANS_ABSENT.contains(name) && isEmptyContainer(v)) {
            return;
          }
          if (app6e && name.equals("sidc") && v instanceof JsonString sidc && sidc.value().length() == 30 && sidc.value().endsWith("0000000000")) {
            b.put(name, JsonString.of(sidc.value().substring(0, 20)));
            return;
          }
          if (viewMeansAbsent && name.equals("workspace") && v instanceof JsonString w && w.value().equals(Workspace.VIEW)) {
            return;
          }
          if (viewMeansAbsent && name.equals("locked") && JsonBoolean.FALSE.equals(v)) {
            return;
          }
          b.put(name, FREE_FORM.contains(name) ? v : normalize(v, viewMeansAbsent && !(update && name.equals("data"))));
        });
        yield b.build();
      }
      case JsonArray a -> new JsonArray(a.values().stream().map(v -> normalize(v, viewMeansAbsent)).toList());
      case JsonNumber n -> asDouble(n);
      default -> value;
    };
  }

  /** The nearest double; a number beyond the double range stays as written, so it equals no double. */
  private static JsonNumber asDouble(JsonNumber n) {
    double d = n.doubleValue();
    return Double.isFinite(d) ? JsonNumber.of(d) : n;
  }

  /** Writes compact JSON; numbers as their exact text. */
  public static String write(JsonValue value) {
    var out = new StringBuilder();
    write(value, out);
    return out.toString();
  }

  private static boolean isEmptyContainer(JsonValue v) {
    return (v instanceof JsonObject o && o.isEmpty()) || (v instanceof JsonArray a && a.size() == 0);
  }

  private static void write(JsonValue value, StringBuilder out) {
    switch (value) {
      case JsonObject o -> {
        out.append('{');
        boolean first = true;
        for (var e : o.members().entrySet()) {
          if (!first) {
            out.append(',');
          }
          first = false;
          writeString(e.getKey(), out);
          out.append(':');
          write(e.getValue(), out);
        }
        out.append('}');
      }
      case JsonArray a -> {
        out.append('[');
        for (int i = 0; i < a.size(); i++) {
          if (i > 0) {
            out.append(',');
          }
          write(a.get(i), out);
        }
        out.append(']');
      }
      case JsonString s -> writeString(s.value(), out);
      case JsonNumber n -> out.append(n.text());
      case JsonBoolean b -> out.append(b.value());
      case JsonNull n -> out.append("null");
    }
  }

  private static void writeString(String s, StringBuilder out) {
    out.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          boolean pairedHigh = Character.isHighSurrogate(c) && i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1));
          boolean pairedLow = Character.isLowSurrogate(c) && i > 0 && Character.isHighSurrogate(s.charAt(i - 1));
          if (c < 0x20 || (Character.isSurrogate(c) && !pairedHigh && !pairedLow)) {
            out.append(String.format("\\u%04x", (int) c));
          } else {
            out.append(c);
          }
        }
      }
    }
    out.append('"');
  }

  /**
   * One value. The arrays and objects being read are kept on {@code open}, not on the thread's
   * stack, so that a value nested as deep as {@code maxDepth} parses on any thread (a POST body,
   * CR-0026).
   */
  private JsonValue value() {
    var open = new ArrayDeque<Open>();
    while (true) {
      JsonValue v = start(open);
      if (v == null) {
        continue; // an array or object was opened: read its first value
      }
      // v is complete: add it to the innermost open container, and close those that end here
      while (true) {
        Open top = open.peek();
        if (top == null) {
          return v;
        }
        if (top.object) {
          top.members.put(top.name, v);
        } else {
          top.values.add(v);
        }
        skipWhitespace();
        if (peek() == ',') {
          pos++;
          skipWhitespace();
          if (top.object) {
            top.name = memberName(top);
          }
          break;
        }
        expect(top.object ? '}' : ']');
        depth--;
        open.pop();
        v = top.object ? JsonObject.of(top.members) : new JsonArray(top.values);
      }
    }
  }

  /**
   * A value's start: a scalar, or an empty array or object, is returned whole; a non-empty array or
   * object is pushed on {@code open}, read up to its first value, and {@code null} is returned.
   */
  private @Nullable JsonValue start(Deque<Open> open) {
    if (pos >= text.length()) {
      throw error("unexpected end");
    }
    char c = text.charAt(pos);
    if (c != '{' && c != '[') {
      return switch (c) {
        case '"' -> new JsonString(string());
        case 't' -> literal("true", JsonBoolean.TRUE);
        case 'f' -> literal("false", JsonBoolean.FALSE);
        case 'n' -> literal("null", JsonNull.INSTANCE);
        default -> number();
      };
    }
    boolean object = c == '{';
    enter();
    pos++;
    skipWhitespace();
    if (peek() == (object ? '}' : ']')) {
      pos++;
      depth--;
      return object ? JsonObject.empty() : new JsonArray(List.of());
    }
    var o = new Open(object);
    if (object) {
      o.name = memberName(o);
    }
    open.push(o);
    return null;
  }

  /** A member's name and its colon, up to its value; a name the object already has is refused. */
  private String memberName(Open o) {
    skipWhitespace();
    if (peek() != '"') {
      throw error("expected a member name");
    }
    String name = string();
    if (o.members.containsKey(name)) {
      throw error("duplicate member \"" + name + "\"");
    }
    skipWhitespace();
    expect(':');
    skipWhitespace();
    return name;
  }

  private String string() {
    expect('"');
    var out = new StringBuilder();
    while (true) {
      if (pos >= text.length()) {
        throw error("unterminated string");
      }
      char c = text.charAt(pos++);
      if (c == '"') {
        return out.toString();
      }
      if (c < 0x20) {
        throw error("control character in string");
      }
      if (c != '\\') {
        out.append(c);
        continue;
      }
      if (pos >= text.length()) {
        throw error("unterminated string");
      }
      char e = text.charAt(pos++);
      switch (e) {
        case '"', '\\', '/' -> out.append(e);
        case 'b' -> out.append('\b');
        case 'f' -> out.append('\f');
        case 'n' -> out.append('\n');
        case 'r' -> out.append('\r');
        case 't' -> out.append('\t');
        case 'u' -> {
          int code = 0;
          for (int i = 0; i < 4; i++) {
            int digit = pos < text.length() ? hexDigit(text.charAt(pos)) : -1;
            if (digit < 0) {
              throw error("bad \\u escape");
            }
            code = code * 16 + digit;
            pos++;
          }
          out.append((char) code);
        }
        default -> throw error("bad escape \\" + e);
      }
    }
  }

  /** An ASCII hex digit's value, or -1: RFC 8259 allows no other digits, and no sign. */
  private static int hexDigit(char c) {
    if (c >= '0' && c <= '9') {
      return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
      return c - 'a' + 10;
    }
    if (c >= 'A' && c <= 'F') {
      return c - 'A' + 10;
    }
    return -1;
  }

  private JsonNumber number() {
    int start = pos;
    while (pos < text.length() && "+-0123456789.eE".indexOf(text.charAt(pos)) >= 0) {
      pos++;
    }
    if (start == pos) {
      throw error("unexpected character '" + text.charAt(pos) + "'");
    }
    try {
      return JsonNumber.of(text.substring(start, pos));
    } catch (IllegalArgumentException e) {
      throw error(e.getMessage());
    }
  }

  private JsonValue literal(String word, JsonValue value) {
    if (!text.startsWith(word, pos)) {
      throw error("expected " + word);
    }
    pos += word.length();
    return value;
  }

  private char peek() {
    if (pos >= text.length()) {
      throw error("unexpected end");
    }
    return text.charAt(pos);
  }

  private void expect(char c) {
    if (peek() != c) {
      throw error("expected '" + c + "'");
    }
    pos++;
  }

  private void skipWhitespace() {
    while (pos < text.length() && " \t\r\n".indexOf(text.charAt(pos)) >= 0) {
      pos++;
    }
  }

  private void enter() {
    if (++depth > maxDepth) {
      throw error("nested deeper than " + maxDepth);
    }
  }

  private IllegalArgumentException error(String message) {
    return new IllegalArgumentException("JSON at position " + pos + ": " + message);
  }

  /** An array or object being read: its values so far, and for an object the next value's name. */
  private static final class Open {
    final boolean object;
    final Map<String, JsonValue> members;
    final List<JsonValue> values;
    String name = "";

    Open(boolean object) {
      this.object = object;
      this.members = object ? new LinkedHashMap<>() : Map.of();
      this.values = object ? List.of() : new ArrayList<>();
    }
  }
}
