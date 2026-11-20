package dev.emcc.ecore.json;

import com.networknt.schema.Error;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import com.networknt.schema.path.NodePath;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;

/**
 * The normative JSON Schemas of the data model (owned by the PDA, in {@code model/schemas}),
 * packaged into ECore at build time. Schemas refer to each other by URN ({@code
 * urn:emc2:schema:<name>}), so nothing is ever downloaded. Format keywords ({@code uuid}, {@code
 * date-time}) are asserted, as in the model's own tests.
 *
 * <p>Thread-safe: the compiled schemas are immutable and can be used from any worker.
 */
public final class ModelSchemas {

  /** The documents ECore validates, with their schema names. */
  public enum Document {
    MAP_OBJECT("map-object"),
    LAYER("layer"),
    CHANGE_REQUEST("change-request"),
    CHANGE_EVENT("change-event"),
    CHANGE_REJECTION("change-rejection"),
    PLUGIN_MANIFEST("plugin-manifest");

    private final String schemaName;

    Document(String schemaName) {
      this.schemaName = schemaName;
    }

    public String schemaId() {
      return "urn:emc2:schema:" + schemaName;
    }
  }

  private static final List<String> ALL = List.of(
      "common", "geometry", "security-label", "map-object", "layer", "change-request", "change-event",
      "change-rejection", "plugin-manifest");
  private static final String RESOURCES = "/dev/emcc/ecore/json/schemas/";

  private final Map<Document, Schema> schemas = new EnumMap<>(Document.class);

  /** Loads and compiles every schema; fails at once if one is missing or broken. */
  public ModelSchemas() {
    Map<String, String> byId = new LinkedHashMap<>();
    for (String name : ALL) {
      byId.put("urn:emc2:schema:" + name, resource(name + ".schema.json"));
    }
    SchemaRegistry registry = SchemaRegistry.withDefaultDialect(
        SpecificationVersion.DRAFT_2020_12, builder -> builder.schemas(byId));
    for (Document document : Document.values()) {
      schemas.put(document, registry.getSchema(SchemaLocation.of(document.schemaId())));
    }
  }

  /** The problems of {@code json} against the schema of {@code document}; empty if it is valid. */
  public List<Problem> validate(Document document, JsonNode json) {
    List<Error> errors = schemas.get(document).validate(
        json, context -> context.executionConfig(config -> config.formatAssertionsEnabled(true)));
    List<Problem> problems = new ArrayList<>(errors.size());
    for (Error error : errors) {
      problems.add(new Problem(pointer(error.getInstanceLocation()), error.getMessage()));
    }
    return problems;
  }

  /** The instance location as a JSON Pointer (RFC 6901). */
  private static String pointer(NodePath path) {
    StringBuilder pointer = new StringBuilder();
    for (int i = 0; i < path.getNameCount(); i++) {
      pointer.append('/').append(path.getName(i).replace("~", "~0").replace("/", "~1"));
    }
    return pointer.toString();
  }

  private static String resource(String file) {
    try (InputStream in = ModelSchemas.class.getResourceAsStream(RESOURCES + file)) {
      if (in == null) {
        throw new IllegalStateException("schema " + file + " is not packaged into ECore");
      }
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
