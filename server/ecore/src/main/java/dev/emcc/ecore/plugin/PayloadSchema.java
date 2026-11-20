package dev.emcc.ecore.plugin;

import com.networknt.schema.Error;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import com.networknt.schema.path.NodePath;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * A declared channel kind's payload schema (SDK 1.9.0, CR-0048 point 4; model rule 23), compiled
 * once when the manifest is read. Immutable, so any thread may check a payload with it.
 *
 * <p><b>Self-contained and offline</b> (ADR-0030): every {@code $ref}, {@code $dynamicRef} and
 * {@code $recursiveRef} in it starts with {@code #}; it names no {@code $id}, and no {@code $schema}
 * but draft 2020-12's. The library's loader fetches nothing besides, so a schema that would need
 * anything from elsewhere is refused at load, never fetched.
 */
final class PayloadSchema {

  /** The one dialect a payload schema may name in {@code $schema}: the one ECore compiles with. */
  static final String DIALECT = "https://json-schema.org/draft/2020-12/schema";

  private static final List<String> REFS = List.of("$ref", "$dynamicRef", "$recursiveRef");
  /** Keywords whose members are names, each with a schema: a name is never a keyword. */
  private static final List<String> NAMED_SCHEMAS = List.of("properties", "patternProperties", "$defs", "definitions", "dependentSchemas");
  /** Keywords that hold data, not schemas: never searched (review of C8). */
  private static final List<String> DATA = List.of("enum", "const", "default", "examples", "dependentRequired", "required");

  private final Schema schema;

  private PayloadSchema(Schema schema) {
    this.schema = schema;
  }

  /**
   * Compiles {@code payload}, the schema of the kind {@code kindId}.
   *
   * @throws IllegalArgumentException with the first problem: not self-contained, or not a schema the
   *     library can compile
   */
  static PayloadSchema compile(String kindId, JsonNode payload) {
    Objects.requireNonNull(payload, "payload");
    String outside = outside(payload, "");
    if (outside != null) {
      throw new IllegalArgumentException("the payload schema of " + kindId + " is not self-contained (model rule 23): " + outside);
    }
    try {
      SchemaRegistry registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12,
          builder -> builder.schemaLoader(loader -> loader.fetchRemoteResources(false)));
      Schema compiled = registry.getSchema(SchemaLocation.of("urn:emc2:channel-kind:" + kindId), payload);
      compiled.initializeValidators(); // finds a broken keyword now, not at the first send
      return new PayloadSchema(compiled);
    } catch (RuntimeException e) {
      throw new IllegalArgumentException("the payload schema of " + kindId + " cannot be used: "
          + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()), e);
    }
  }

  /**
   * The first problem of an item of {@code kind}'s payload, or null, in the test kit's words ({@code
   * FakeChannels}): its size as compact UTF-8 JSON over {@link DeclaredItem#MAX_PAYLOAD_BYTES}, then
   * the schema. Run outside any lock (rule C4).
   */
  @Nullable String problem(String kind, JsonObject payload) {
    JsonNode node = toNode(payload);
    int size = node.toString().getBytes(StandardCharsets.UTF_8).length;
    if (size > DeclaredItem.MAX_PAYLOAD_BYTES) {
      return "a payload of " + kind + " is at most " + DeclaredItem.MAX_PAYLOAD_BYTES + " bytes: " + size;
    }
    String problem = problem(node);
    return problem == null ? null : "a payload of " + kind + " does not match its schema: " + problem;
  }

  /** The SDK's JSON value as a Jackson tree, numbers exact. */
  static JsonNode toNode(JsonValue value) {
    JsonNodeFactory nodes = JsonNodeFactory.instance;
    return switch (value) {
      case JsonObject o -> {
        ObjectNode n = nodes.objectNode();
        o.members().forEach((name, v) -> n.set(name, toNode(v)));
        yield n;
      }
      case JsonArray a -> {
        ArrayNode n = nodes.arrayNode();
        a.values().forEach(v -> n.add(toNode(v)));
        yield n;
      }
      case JsonString s -> nodes.stringNode(s.value());
      case JsonNumber number -> nodes.numberNode(number.bigDecimalValue());
      case JsonBoolean b -> nodes.booleanNode(b.value());
      case JsonNull ignored -> nodes.nullNode();
    };
  }

  /** The first problem of {@code payload} against the schema, as "{@code <JSON pointer>: <problem>}", or null. */
  @Nullable String problem(JsonNode payload) {
    List<Error> errors = schema.validate(payload, context -> context.executionConfig(config -> config.formatAssertionsEnabled(true)));
    if (errors.isEmpty()) {
      return null;
    }
    Error first = errors.getFirst();
    String at = pointer(first.getInstanceLocation());
    return (at.isEmpty() ? "/" : at) + ": " + first.getMessage();
  }

  /**
   * The first place in the schema {@code node} that points outside it or names another dialect or an
   * id, or null. Only keywords count: the names under {@link #NAMED_SCHEMAS} are names, and what
   * {@link #DATA} holds is data, so a payload property named {@code $ref} is no reference.
   */
  private static @Nullable String outside(JsonNode node, String at) {
    if (node.isObject()) {
      for (Map.Entry<String, JsonNode> member : node.properties()) {
        String key = member.getKey();
        JsonNode value = member.getValue();
        String here = at + "/" + escape(key);
        if (DATA.contains(key)) {
          continue;
        }
        if (NAMED_SCHEMAS.contains(key) && value.isObject()) {
          for (Map.Entry<String, JsonNode> named : value.properties()) {
            String inner = outside(named.getValue(), here + "/" + escape(named.getKey()));
            if (inner != null) {
              return inner;
            }
          }
          continue;
        }
        if (REFS.contains(key) && (!value.isString() || !value.stringValue().startsWith("#"))) {
          return here + ": " + key + " " + value + " points outside the schema";
        }
        if (key.equals("$id")) {
          return here + ": a payload schema names no $id";
        }
        if (key.equals("$schema") && (!value.isString() || !value.stringValue().equals(DIALECT))) {
          return here + ": $schema is " + DIALECT + " or absent";
        }
        String inner = outside(value, here);
        if (inner != null) {
          return inner;
        }
      }
    } else if (node.isArray()) {
      for (int i = 0; i < node.size(); i++) {
        String inner = outside(node.get(i), at + "/" + i);
        if (inner != null) {
          return inner;
        }
      }
    }
    return null;
  }

  private static String escape(String name) {
    return name.replace("~", "~0").replace("/", "~1");
  }

  private static String pointer(NodePath path) {
    StringBuilder pointer = new StringBuilder();
    for (int i = 0; i < path.getNameCount(); i++) {
      pointer.append('/').append(path.getName(i).replace("~", "~0").replace("/", "~1"));
    }
    return pointer.toString();
  }
}
