package dev.emcc.ecore.persistence;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** Valid change events for persistence tests: layers, and objects created, updated and deleted. */
final class Events {

  static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  static final Actor BY = Actor.plugin("layer-panel");
  static final Instant AT = Instant.parse("2026-10-07T10:00:00.123Z");
  /** More digits than a double holds: must survive storage exactly (ADR-0007). */
  static final String EXACT = "0.10000000000000000555111512312578270211815834045410156250001";

  private Events() {}

  static ChangeEvent layerCreated(long sequenceNo) {
    return layerCreated(sequenceNo, "Layer " + sequenceNo);
  }

  static ChangeEvent layerCreated(long sequenceNo, String name) {
    UUID id = UUID.randomUUID();
    Extensions extensions = new Extensions(Map.of("layer-panel", JsonObject.of(Map.of("n", JsonNumber.of(EXACT)))));
    Layer layer = new Layer(id, 1, new LayerContent(name, sequenceNo, true, LABEL, extensions),
        new Meta(new Meta.Audit(AT, BY), new Meta.Audit(AT, BY), null));
    return new ChangeEvent(sequenceNo, UUID.randomUUID(), EntityType.LAYER, Operation.CREATE, id, 1, null, null, layer,
        LABEL, AT, BY);
  }

  /** The layer the objects of these events are in; the picture does not check it. */
  static final UUID OBJECT_LAYER = UUID.fromString("0199b2c4-0000-7000-8000-000000000001");

  /** A symbol at a place that depends on {@code version}, with latitude != longitude. */
  static MapObject object(UUID id, long version) {
    MapObjectContent content = new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL,
        null, OBJECT_LAYER, new Geometry.Point(Position.of(15 + version * 0.01, 60 + version * 0.001, 100.0 * version)),
        new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null, LABEL, Extensions.empty());
    return new MapObject(id, version, content, new Meta(new Meta.Audit(AT, BY), new Meta.Audit(AT, BY), null));
  }

  static ChangeEvent objectCreated(long sequenceNo, UUID id) {
    return new ChangeEvent(sequenceNo, UUID.randomUUID(), EntityType.OBJECT, Operation.CREATE, id, 1, null, null, object(id, 1),
        LABEL, AT, BY);
  }

  /** The update that brings object {@code id} to {@code version}. */
  static ChangeEvent objectUpdated(long sequenceNo, UUID id, long version) {
    return new ChangeEvent(sequenceNo, UUID.randomUUID(), EntityType.OBJECT, Operation.UPDATE, id, version, version - 1, null,
        object(id, version), LABEL, AT, BY);
  }

  /** The delete of object {@code id}, which had {@code previousVersion}. */
  static ChangeEvent objectDeleted(long sequenceNo, UUID id, long previousVersion) {
    return new ChangeEvent(sequenceNo, UUID.randomUUID(), EntityType.OBJECT, Operation.DELETE, id, previousVersion + 1,
        previousVersion, null, null, LABEL, AT, BY);
  }
}
