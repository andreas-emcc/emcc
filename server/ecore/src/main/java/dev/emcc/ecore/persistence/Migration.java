package dev.emcc.ecore.persistence;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.Problem;
import dev.emcc.sdk.model.MapObjectContent;
import java.util.List;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The one-time migration of stored data from data model 0.1.0 (M0) to 1.0.0 (model README,
 * "Migration"; CR-0010): every object gets {@code dataType} {@code core.general} and {@code
 * dataSource} {@code manual}; nothing else changes, not the version, not {@code meta}. Layers are
 * unchanged.
 *
 * <p>Works on the JSON trees before they are validated, because 0.1.0 objects are not valid 1.0.0
 * documents. A 0.1.0 object is a 1.0.0 object without {@code dataType}, {@code dataSource} and
 * {@code time} (model README, "Changes in 1.0.0"; the model's own migration test checks the
 * examples the same way). So a tree that has one of them is not 0.1.0 data, and a migrated tree is
 * validated against the 1.0.0 schema afterwards: either way an invalid 0.1.0 document stops the
 * start (ACA review N6).
 */
final class Migration {

  /** The data model of stored data that does not name one: M0 wrote none. */
  static final String FROM = "0.1.0";

  private static final List<String> NEW_IN_1_0_0 = List.of("dataType", "dataSource", "time");

  private Migration() {}

  /**
   * A 0.1.0 map object as a 1.0.0 one, as a new tree.
   *
   * @throws InvalidDocumentException if it is not a 0.1.0 map object
   */
  static JsonNode object(JsonNode object) {
    if (!(object instanceof ObjectNode o)) {
      throw new InvalidDocumentException("not a 0.1.0 map object", List.of(new Problem("", "not a JSON object")));
    }
    for (String field : NEW_IN_1_0_0) {
      if (o.has(field)) {
        throw new InvalidDocumentException("not a 0.1.0 map object",
            List.of(new Problem("/" + field, field + " is not in data model " + FROM)));
      }
    }
    ObjectNode migrated = o.deepCopy();
    migrated.put("dataType", MapObjectContent.GENERAL);
    migrated.put("dataSource", MapObjectContent.MANUAL);
    return migrated;
  }

  /** A 0.1.0 change event as a 1.0.0 one: an object's {@code state} is migrated, everything else kept. */
  static JsonNode event(JsonNode event) {
    if (!(event instanceof ObjectNode e)) {
      throw new InvalidDocumentException("not a 0.1.0 change event", List.of(new Problem("", "not a JSON object")));
    }
    JsonNode type = e.get("entityType");
    JsonNode state = e.get("state");
    if (type == null || !type.isString() || !type.stringValue().equals("object") || state == null || state.isNull()) {
      return e;
    }
    ObjectNode migrated = e.deepCopy();
    migrated.set("state", object(state));
    return migrated;
  }
}
