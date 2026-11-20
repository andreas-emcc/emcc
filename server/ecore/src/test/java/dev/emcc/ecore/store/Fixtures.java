package dev.emcc.ecore.store;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Builders for store tests. Every position has longitude ≠ latitude (CLAUDE.md section 4). */
final class Fixtures {

  static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  static final Actor DRAW = Actor.plugin("draw-symbols");
  static final Actor LAYERS = Actor.plugin("layer-panel");
  /** A request from a browser: the server has set the user (model rule 8). */
  static final Actor EDITOR = new Actor("draw-symbols", "3f2c9a10-5d7e-4b8a-9c41-2e6f8d0a7b15", null);

  private Fixtures() {}

  static LayerContent layer(String name) {
    return new LayerContent(name, 1.0, true, LABEL, Extensions.empty());
  }

  static MapObjectContent symbol(UUID layerId, double lon, double lat) {
    return symbol(layerId, lon, lat, Extensions.empty());
  }

  static MapObjectContent symbol(UUID layerId, double lon, double lat, Extensions extensions) {
    return new MapObjectContent(
        MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId, new Geometry.Point(Position.of(lon, lat)),
        new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null, LABEL, extensions);
  }

  static MapObjectContent shape(UUID layerId, Geometry geometry) {
    return new MapObjectContent(
        MapObjectContent.SHAPE, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId, geometry, null, new Style("#1F6F8B", 1.5, null, null, null, null), null,
        LABEL, Extensions.empty());
  }

  static Geometry.Polygon polygon(double[]... lonLat) {
    return new Geometry.Polygon(List.of(ring(lonLat)));
  }

  static List<Position> ring(double[]... lonLat) {
    return java.util.Arrays.stream(lonLat).map(p -> Position.of(p[0], p[1])).toList();
  }

  static double[] p(double lon, double lat) {
    return new double[] {lon, lat};
  }

  static Extensions ext(String namespace, String key, String value) {
    return new Extensions(Map.of(namespace, JsonObject.of(Map.of(key, JsonString.of(value)))));
  }

  static Extensions ext(Map<String, JsonObject> namespaces) {
    return new Extensions(namespaces);
  }

  static JsonObject value(String key, String value) {
    return JsonObject.of(Map.of(key, JsonString.of(value)));
  }

  static JsonObject number(String key, String exactText) {
    return JsonObject.of(Map.of(key, JsonNumber.of(exactText)));
  }

  static ChangeRequest create(UUID id, LayerContent content, Actor by) {
    return ChangeRequest.create(UUID.randomUUID(), id, content, by);
  }

  static ChangeRequest create(UUID id, MapObjectContent content, Actor by) {
    return ChangeRequest.create(UUID.randomUUID(), id, content, by);
  }

  static ChangeRequest update(UUID id, long baseVersion, MapObjectContent content, Actor by) {
    return ChangeRequest.update(UUID.randomUUID(), id, baseVersion, content, by);
  }

  static ChangeRequest update(UUID id, long baseVersion, LayerContent content, Actor by) {
    return ChangeRequest.update(UUID.randomUUID(), id, baseVersion, content, by);
  }

  static ChangeRequest delete(UUID id, EntityType type, Actor by) {
    return ChangeRequest.delete(UUID.randomUUID(), type, id, null, by);
  }
}
