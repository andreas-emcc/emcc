package dev.emcc.sdk.http;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;

/**
 * Writes the SDK's JSON values as compact RFC 8259 text, for {@link HttpReply#json}. Numbers keep
 * their exact text; a lone surrogate in a string is escaped, so the UTF-8 encoding loses nothing.
 */
final class JsonText {

  private JsonText() {}

  static String write(JsonValue value) {
    var out = new StringBuilder();
    write(value, out);
    return out.toString();
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
}
