package dev.emcc.ecore.plugin;

import com.networknt.schema.Error;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.dialect.Dialect;
import com.networknt.schema.dialect.Dialects;
import com.networknt.schema.keyword.AnnotationKeyword;
import com.networknt.schema.path.NodePath;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.Problem;
import dev.emcc.sdk.json.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/**
 * A plugin's settings schema from its manifest (JSON Schema draft 2020-12), compiled once at start.
 * ECore validates configured settings against it before they reach the plugin (SDK v1 design,
 * "Plugin manifest").
 *
 * <p>ECore never fetches a schema's references: a schema may refer only within itself ({@code $ref} and
 * {@code $dynamicRef} starting with {@code #}), may not set {@code $id}, and names no other dialect
 * than 2020-12; the validator's remote fetching is off as well.
 *
 * <p>Thread-safe: the compiled schema is immutable.
 */
final class SettingsSchema {

  private static final String DIALECT = "https://json-schema.org/draft/2020-12/schema";

  /**
   * JSON Schema 2020-12 with the SDK's annotation {@code x-emc2} (SDK 1.2.0: the layer picker,
   * ADR-0037 point 2) declared, so that it compiles as an annotation without a warning for each
   * plugin that uses it; other unknown keywords are left as they were.
   */
  static final Dialect SETTINGS_DIALECT = Dialect.builder(Dialects.getDraft202012()).keyword(new AnnotationKeyword("x-emc2")).build();

  private final Schema schema;
  private final JsonNode tree;

  private SettingsSchema(Schema schema, JsonNode tree) {
    this.schema = schema;
    this.tree = tree;
  }

  /**
   * Compiles the settings schema of {@code pluginId}.
   *
   * @throws IllegalArgumentException with the reason, if it refers outside itself or does not compile
   */
  static SettingsSchema compile(String pluginId, JsonNode schema) {
    return compile(pluginId, schema, SETTINGS_DIALECT);
  }

  /** With another dialect (tests: a strict one shows which keywords the settings dialect knows). */
  static SettingsSchema compile(String pluginId, JsonNode schema, Dialect dialect) {
    String outside = outsideReference(schema, "");
    if (outside != null) {
      throw new IllegalArgumentException("the settings schema may refer only within itself: " + outside);
    }
    String id = "urn:emc2:settings:" + pluginId;
    try {
      SchemaRegistry registry = SchemaRegistry.withDefaultDialect(dialect,
          builder -> builder.schemas(Map.of(id, schema.toString())).schemaLoader(loader -> loader.fetchRemoteResources(false)));
      Schema compiled = registry.getSchema(SchemaLocation.of(id));
      compiled.initializeValidators();
      return new SettingsSchema(compiled, schema);
    } catch (RuntimeException e) {
      throw new IllegalArgumentException("the settings schema does not compile: " + e.getMessage(), e);
    }
  }

  /** The schema as the manifest has it (for the settings view). */
  JsonNode tree() {
    return tree;
  }

  /** The problems of {@code values}; empty if they are valid settings. */
  List<Problem> validate(JsonObject values, ModelJson json) {
    List<Error> errors = schema.validate(json.toNode(values), context -> context.executionConfig(c -> c.formatAssertionsEnabled(true)));
    List<Problem> problems = new ArrayList<>(errors.size());
    for (Error error : errors) {
      problems.add(new Problem(pointer(error.getInstanceLocation()), error.getMessage()));
    }
    return problems;
  }

  /**
   * Checks the manifest's {@code network} pointers against this schema: each must lead, through
   * declared {@code properties}, to an object that declares {@code host} and {@code port}, or to an
   * array whose {@code items} do. Returns the reason if one does not, else null.
   */
  @Nullable String checkEndpoints(List<String> pointers) {
    for (String pointer : pointers) {
      JsonNode node = tree;
      for (String name : pointer.substring(1).split("/")) {
        JsonNode next = node.path("properties").get(name);
        if (next == null) {
          return "network endpoint " + pointer + ": the settings schema declares no " + name;
        }
        node = next;
      }
      JsonNode target = node.has("items") ? node.get("items") : node;
      if (!target.path("properties").has("host") || !target.path("properties").has("port")) {
        return "network endpoint " + pointer + " must be an object with host and port, or an array of them";
      }
    }
    return null;
  }

  /**
   * What is wrong with a declared folder's {@code setting} (SDK 1.4.0, model rule 19), or null: the
   * pointer names a property of {@code type} {@code string}, through the schema's {@code properties}.
   */
  @Nullable String checkFolderSetting(String folderId, String pointer) {
    JsonNode node = tree;
    for (String name : pointer.substring(1).split("/")) {
      JsonNode next = node.path("properties").get(name);
      if (next == null) {
        return "the folder " + folderId + "'s setting " + pointer + ": the settings schema declares no " + name;
      }
      node = next;
    }
    JsonNode type = node.get("type");
    if (type == null || !type.isString() || !type.stringValue().equals("string")) {
      return "the folder " + folderId + "'s setting " + pointer + " must be a property of type string";
    }
    return null;
  }

  /** The first reference out of the schema, as "path: value", or null if there is none. */
  private static @Nullable String outsideReference(JsonNode node, String path) {
    if (node.isObject()) {
      for (Map.Entry<String, JsonNode> e : node.properties()) {
        String key = e.getKey();
        JsonNode value = e.getValue();
        boolean reference = (key.equals("$ref") || key.equals("$dynamicRef")) && !(value.isString() && value.stringValue().startsWith("#"));
        boolean dialect = key.equals("$schema") && !(value.isString() && value.stringValue().equals(DIALECT));
        if (reference || dialect || key.equals("$id")) {
          return path + "/" + key + ": " + value;
        }
        String found = outsideReference(value, path + "/" + key);
        if (found != null) {
          return found;
        }
      }
    } else if (node.isArray()) {
      for (int i = 0; i < node.size(); i++) {
        String found = outsideReference(node.get(i), path + "/" + i);
        if (found != null) {
          return found;
        }
      }
    }
    return null;
  }

  private static String pointer(NodePath path) {
    StringBuilder pointer = new StringBuilder();
    for (int i = 0; i < path.getNameCount(); i++) {
      pointer.append('/').append(path.getName(i).replace("~", "~0").replace("/", "~1"));
    }
    return pointer.toString();
  }
}
