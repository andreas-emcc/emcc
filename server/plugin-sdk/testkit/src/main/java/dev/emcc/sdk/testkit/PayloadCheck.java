package dev.emcc.sdk.testkit;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.9.0 (CR-0048 point 4): the test kit's check of a {@link dev.emcc.sdk.channel.DeclaredItem}'s
 * payload, as {@link FakeChannels} runs it at {@code send}: the size, at most {@code
 * DeclaredItem.MAX_PAYLOAD_BYTES} as compact UTF-8 JSON, and the kind's {@code payload} schema.
 *
 * <p><b>A subset of JSON Schema:</b> {@code type}, {@code properties}, {@code required}, {@code
 * additionalProperties} (a boolean or a schema), {@code items}, {@code minItems}, {@code maxItems},
 * {@code enum}, {@code const}, {@code minimum}, {@code maximum}, {@code exclusiveMinimum}, {@code
 * exclusiveMaximum}, {@code minLength}, {@code maxLength}, and {@code $ref} to {@code #/$defs/…}.
 * Other keywords ({@code pattern}, {@code format}, {@code oneOf} and the like) are not checked here.
 * <b>ECore checks the whole schema</b>, so a payload that passes here may still be refused there; a
 * plugin's own test of its payload's shape covers the rest. Model rule 23: a {@code $ref} that does
 * not start with {@code #} is refused.
 */
public final class PayloadCheck {

  private PayloadCheck() {}

  /** The size of {@code payload} as compact UTF-8 JSON, in bytes. */
  public static int size(JsonObject payload) {
    return TestJson.write(payload).getBytes(StandardCharsets.UTF_8).length;
  }

  /** The first problem of {@code value} against {@code schema}, as "<JSON pointer>: <problem>", or null. */
  public static @Nullable String problem(JsonObject schema, JsonValue value) {
    return check(schema, schema, value, "");
  }

  /** The first {@code $ref} in {@code schema} that does not point inside it (model rule 23), or null. */
  public static @Nullable String remoteRef(JsonValue schema) {
    if (schema instanceof JsonObject o) {
      for (Map.Entry<String, JsonValue> m : o.members().entrySet()) {
        if (m.getKey().equals("$ref") && m.getValue() instanceof JsonString s && !s.value().startsWith("#")) {
          return s.value();
        }
        String inner = remoteRef(m.getValue());
        if (inner != null) {
          return inner;
        }
      }
    } else if (schema instanceof JsonArray a) {
      for (JsonValue v : a.values()) {
        String inner = remoteRef(v);
        if (inner != null) {
          return inner;
        }
      }
    }
    return null;
  }

  private static @Nullable String check(JsonObject root, JsonObject schema, JsonValue value, String at) {
    String path = at.isEmpty() ? "/" : at;
    if (schema.get("$ref") instanceof JsonString ref) {
      JsonObject target = resolve(root, ref.value());
      if (target == null) {
        return path + ": $ref " + ref.value() + " does not point inside the schema";
      }
      return check(root, target, value, at);
    }
    if (schema.get("type") instanceof JsonValue type && !typeMatches(type, value)) {
      return path + ": is not of type " + TestJson.write(type);
    }
    if (schema.get("const") instanceof JsonValue c && !TestJson.normalize(c).equals(TestJson.normalize(value))) {
      return path + ": is not " + TestJson.write(c);
    }
    if (schema.get("enum") instanceof JsonArray e && e.values().stream().noneMatch(v -> TestJson.normalize(v).equals(TestJson.normalize(value)))) {
      return path + ": is not one of " + TestJson.write(e);
    }
    if (value instanceof JsonNumber n) {
      BigDecimal d = n.bigDecimalValue();
      if (below(schema, "minimum", d, false) || below(schema, "exclusiveMinimum", d, true)) {
        return path + ": is below its minimum";
      }
      if (above(schema, "maximum", d, false) || above(schema, "exclusiveMaximum", d, true)) {
        return path + ": is above its maximum";
      }
    }
    if (value instanceof JsonString s) {
      int length = s.value().codePointCount(0, s.value().length());
      if (schema.get("minLength") instanceof JsonNumber min && length < min.longValueExact()) {
        return path + ": is shorter than " + min.text();
      }
      if (schema.get("maxLength") instanceof JsonNumber max && length > max.longValueExact()) {
        return path + ": is longer than " + max.text();
      }
    }
    if (value instanceof JsonArray a) {
      if (schema.get("minItems") instanceof JsonNumber min && a.size() < min.longValueExact()) {
        return path + ": has fewer than " + min.text() + " items";
      }
      if (schema.get("maxItems") instanceof JsonNumber max && a.size() > max.longValueExact()) {
        return path + ": has more than " + max.text() + " items";
      }
      if (schema.get("items") instanceof JsonObject items) {
        for (int i = 0; i < a.size(); i++) {
          String p = check(root, items, a.get(i), at + "/" + i);
          if (p != null) {
            return p;
          }
        }
      }
    }
    if (value instanceof JsonObject o) {
      if (schema.get("required") instanceof JsonArray required) {
        for (JsonValue r : required.values()) {
          if (r instanceof JsonString name && !o.has(name.value())) {
            return path + ": has no " + name.value();
          }
        }
      }
      JsonObject properties = schema.get("properties") instanceof JsonObject p ? p : JsonObject.empty();
      JsonValue additional = schema.get("additionalProperties");
      for (Map.Entry<String, JsonValue> m : o.members().entrySet()) {
        String child = at + "/" + m.getKey();
        if (properties.get(m.getKey()) instanceof JsonObject ps) {
          String p = check(root, ps, m.getValue(), child);
          if (p != null) {
            return p;
          }
        } else if (additional instanceof JsonBoolean b && !b.value()) {
          return child + ": is not a property the schema allows";
        } else if (additional instanceof JsonObject as) {
          String p = check(root, as, m.getValue(), child);
          if (p != null) {
            return p;
          }
        }
      }
    }
    return null;
  }

  private static @Nullable JsonObject resolve(JsonObject root, String ref) {
    if (!ref.startsWith("#")) {
      return null;
    }
    JsonValue node = root;
    for (String part : ref.substring(1).split("/")) {
      if (part.isEmpty()) {
        continue;
      }
      String key = part.replace("~1", "/").replace("~0", "~");
      node = node instanceof JsonObject o ? o.get(key) : null;
      if (node == null) {
        return null;
      }
    }
    return node instanceof JsonObject o ? o : null;
  }

  private static boolean typeMatches(JsonValue type, JsonValue value) {
    List<String> types = new ArrayList<>();
    if (type instanceof JsonString s) {
      types.add(s.value());
    } else if (type instanceof JsonArray a) {
      a.values().forEach(v -> types.add(v instanceof JsonString s ? s.value() : ""));
    }
    for (String t : types) {
      boolean ok = switch (t) {
        case "object" -> value instanceof JsonObject;
        case "array" -> value instanceof JsonArray;
        case "string" -> value instanceof JsonString;
        case "boolean" -> value instanceof JsonBoolean;
        case "null" -> value instanceof JsonNull;
        case "number" -> value instanceof JsonNumber;
        case "integer" -> value instanceof JsonNumber n && isInteger(n);
        default -> false;
      };
      if (ok) {
        return true;
      }
    }
    return false;
  }

  private static boolean isInteger(JsonNumber n) {
    try {
      return n.bigDecimalValue().stripTrailingZeros().scale() <= 0;
    } catch (NumberFormatException e) {
      return false;
    }
  }

  private static boolean below(JsonObject schema, String key, BigDecimal d, boolean exclusive) {
    return schema.get(key) instanceof JsonNumber n && (exclusive ? d.compareTo(n.bigDecimalValue()) <= 0 : d.compareTo(n.bigDecimalValue()) < 0);
  }

  private static boolean above(JsonObject schema, String key, BigDecimal d, boolean exclusive) {
    return schema.get(key) instanceof JsonNumber n && (exclusive ? d.compareTo(n.bigDecimalValue()) >= 0 : d.compareTo(n.bigDecimalValue()) > 0);
  }
}
