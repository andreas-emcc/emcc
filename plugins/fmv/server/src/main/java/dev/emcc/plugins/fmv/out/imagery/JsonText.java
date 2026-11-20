package dev.emcc.plugins.fmv.out.imagery;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A small, strict JSON reader (RFC 8259) into the SDK's JSON values, for {@code imagery.json}: the
 * SDK has no parser for plugins (owner, Q1). Bounded: at most {@link #MAX_CHARS} characters and
 * {@link #MAX_DEPTH} levels; a duplicate member name, trailing text or anything else not JSON is
 * refused with its position.
 */
public final class JsonText {

  /** The longest text it reads. */
  public static final int MAX_CHARS = 1 << 20;

  /** The deepest nesting it reads. */
  public static final int MAX_DEPTH = 32;

  /** Text that is not JSON this reader takes. */
  public static final class JsonException extends Exception {
    private static final long serialVersionUID = 1L;

    JsonException(String message) {
      super(message);
    }
  }

  private final String s;
  private int at;

  private JsonText(String s) {
    this.s = s;
  }

  /** Reads one JSON value, the whole text. */
  public static JsonValue parse(String text) throws JsonException {
    if (text.length() > MAX_CHARS) {
      throw new JsonException("longer than " + MAX_CHARS + " characters");
    }
    JsonText p = new JsonText(text);
    if (p.s.startsWith("﻿")) {
      p.at = 1;
    }
    JsonValue v = p.value(0);
    p.space();
    if (p.at != p.s.length()) {
      throw p.error("text after the value");
    }
    return v;
  }

  private JsonException error(String what) {
    return new JsonException(what + " at character " + at);
  }

  private void space() {
    while (at < s.length()) {
      char c = s.charAt(at);
      if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
        at++;
      } else {
        return;
      }
    }
  }

  private JsonValue value(int depth) throws JsonException {
    if (depth > MAX_DEPTH) {
      throw error("nested deeper than " + MAX_DEPTH);
    }
    space();
    if (at >= s.length()) {
      throw error("a value expected");
    }
    char c = s.charAt(at);
    return switch (c) {
      case '{' -> object(depth);
      case '[' -> array(depth);
      case '"' -> JsonString.of(string());
      case 't' -> word("true", JsonBoolean.of(true));
      case 'f' -> word("false", JsonBoolean.of(false));
      case 'n' -> word("null", new JsonNull());
      default -> {
        if (c == '-' || (c >= '0' && c <= '9')) {
          yield number();
        }
        throw error("a value expected");
      }
    };
  }

  private JsonValue word(String w, JsonValue v) throws JsonException {
    if (!s.startsWith(w, at)) {
      throw error("a value expected");
    }
    at += w.length();
    return v;
  }

  private JsonObject object(int depth) throws JsonException {
    at++;
    Map<String, JsonValue> members = new LinkedHashMap<>();
    space();
    if (at < s.length() && s.charAt(at) == '}') {
      at++;
      return JsonObject.of(members);
    }
    while (true) {
      space();
      if (at >= s.length() || s.charAt(at) != '"') {
        throw error("a member name expected");
      }
      String name = string();
      space();
      expect(':');
      JsonValue v = value(depth + 1);
      if (members.put(name, v) != null) {
        throw error("the member \"" + name + "\" twice");
      }
      space();
      if (at < s.length() && s.charAt(at) == ',') {
        at++;
      } else {
        expect('}');
        return JsonObject.of(members);
      }
    }
  }

  private JsonArray array(int depth) throws JsonException {
    at++;
    List<JsonValue> values = new ArrayList<>();
    space();
    if (at < s.length() && s.charAt(at) == ']') {
      at++;
      return new JsonArray(values);
    }
    while (true) {
      values.add(value(depth + 1));
      space();
      if (at < s.length() && s.charAt(at) == ',') {
        at++;
      } else {
        expect(']');
        return new JsonArray(values);
      }
    }
  }

  private void expect(char c) throws JsonException {
    if (at >= s.length() || s.charAt(at) != c) {
      throw error("'" + c + "' expected");
    }
    at++;
  }

  private String string() throws JsonException {
    at++;
    StringBuilder b = new StringBuilder();
    while (true) {
      if (at >= s.length()) {
        throw error("an unterminated string");
      }
      char c = s.charAt(at++);
      if (c == '"') {
        return b.toString();
      }
      if (c < 0x20) {
        throw error("a control character in a string");
      }
      if (c != '\\') {
        b.append(c);
        continue;
      }
      if (at >= s.length()) {
        throw error("an unterminated escape");
      }
      char e = s.charAt(at++);
      switch (e) {
        case '"', '\\', '/' -> b.append(e);
        case 'b' -> b.append('\b');
        case 'f' -> b.append('\f');
        case 'n' -> b.append('\n');
        case 'r' -> b.append('\r');
        case 't' -> b.append('\t');
        case 'u' -> {
          if (at + 4 > s.length()) {
            throw error("a short \\u escape");
          }
          int v = 0;
          for (int i = 0; i < 4; i++) {
            int d = Character.digit(s.charAt(at + i), 16);
            if (d < 0) {
              throw error("a \\u escape that is not hex");
            }
            v = v * 16 + d;
          }
          at += 4;
          b.append((char) v);
        }
        default -> throw error("an unknown escape \\" + e);
      }
    }
  }

  private JsonNumber number() throws JsonException {
    int start = at;
    if (s.charAt(at) == '-') {
      at++;
    }
    if (at < s.length() && s.charAt(at) == '0') {
      at++;
    } else if (!digits()) {
      throw error("a number expected");
    }
    if (at < s.length() && s.charAt(at) == '.') {
      at++;
      if (!digits()) {
        throw error("digits after the point expected");
      }
    }
    if (at < s.length() && (s.charAt(at) == 'e' || s.charAt(at) == 'E')) {
      at++;
      if (at < s.length() && (s.charAt(at) == '+' || s.charAt(at) == '-')) {
        at++;
      }
      if (!digits()) {
        throw error("an exponent's digits expected");
      }
    }
    return JsonNumber.of(s.substring(start, at));
  }

  private boolean digits() {
    int start = at;
    while (at < s.length() && s.charAt(at) >= '0' && s.charAt(at) <= '9') {
      at++;
    }
    return at > start;
  }
}
