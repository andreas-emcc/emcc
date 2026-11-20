package dev.emcc.ecore.json;

import dev.emcc.ecore.json.ModelSchemas.Document;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Entity;
import dev.emcc.sdk.model.EntityContent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.Text;
import dev.emcc.sdk.model.TextModifier;
import dev.emcc.sdk.model.TimeAttributes;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.jspecify.annotations.Nullable;
import tools.jackson.core.JacksonException;
import tools.jackson.core.JsonGenerator;
import tools.jackson.core.JsonParser;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectReader;
import tools.jackson.databind.cfg.JsonNodeFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * ECore's JSON codec for the SDK's model types. Reading validates against the model's JSON Schema
 * first ({@link ModelSchemas}), then maps to the Java type; writing follows model rule 13 (empty
 * optional objects and arrays are left out). Numbers inside extensions keep their exact value
 * (ADR-0007); timestamps are written in UTC with milliseconds.
 *
 * <p>Thread-safe: one instance can be shared by every worker.
 */
public final class ModelJson {

  /**
   * The data model version this codec reads and writes ({@code model/package.json}). Documents do
   * not carry it; the persistence manager and the live picture protocol record it (model README,
   * "Versioning").
   */
  public static final String DATA_MODEL = "1.9.0";

  private static final DateTimeFormatter TIMESTAMP =
      DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

  private final ModelSchemas schemas;
  private final JsonMapper mapper;
  private final JsonNodeFactory nodes;
  /** For streams: one value at a time, so tokens after it are expected. */
  private final ObjectReader streamReader;
  /** {@link #parse(String, int)}'s mappers, one per nesting limit. */
  private final Map<Integer, JsonMapper> nestingMappers = new ConcurrentHashMap<>();

  public ModelJson() {
    this(new ModelSchemas());
  }

  public ModelJson(ModelSchemas schemas) {
    this.schemas = schemas;
    this.mapper = mapper(JsonMapper.builder());
    this.nodes = mapper.getNodeFactory();
    this.streamReader = mapper.reader().without(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
  }

  /** Exact numbers, one value only, no duplicate names. */
  private static JsonMapper mapper(JsonMapper.Builder builder) {
    return builder
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .enable(DeserializationFeature.USE_BIG_INTEGER_FOR_INTS)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
        .disable(JsonNodeFeature.STRIP_TRAILING_BIGDECIMAL_ZEROES)
        .build();
  }

  // ---- Reading ---------------------------------------------------------------------------------

  /** Parses, validates and maps a document. Throws {@link InvalidDocumentException} if it is invalid. */
  public Object read(Document document, String json) {
    return fromTree(document, parse(json));
  }

  public MapObject readMapObject(String json) {
    return (MapObject) read(Document.MAP_OBJECT, json);
  }

  public Layer readLayer(String json) {
    return (Layer) read(Document.LAYER, json);
  }

  public ChangeRequest readChangeRequest(String json) {
    return (ChangeRequest) read(Document.CHANGE_REQUEST, json);
  }

  public ChangeEvent readChangeEvent(String json) {
    return (ChangeEvent) read(Document.CHANGE_EVENT, json);
  }

  public ChangeRejection readChangeRejection(String json) {
    return (ChangeRejection) read(Document.CHANGE_REJECTION, json);
  }

  /** Parses JSON text into a tree, without validation. */
  public JsonNode parse(String json) {
    try {
      return mapper.readTree(json);
    } catch (JacksonException e) {
      throw new InvalidDocumentException("not valid JSON", List.of(new Problem("", e.getOriginalMessage())));
    }
  }

  /**
   * As {@link #parse(String)}, with arrays and objects nested at most {@code maxDepth} deep instead
   * of Jackson's default (500): a plugin's {@code POST} body, whose limit the SDK sets (CR-0026). A
   * deeper text throws {@link InvalidDocumentException}, as any other invalid one does.
   */
  public JsonNode parse(String json, int maxDepth) {
    JsonMapper deep = nestingMappers.computeIfAbsent(maxDepth, depth -> mapper(JsonMapper.builder(JsonFactory.builder()
        .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(depth).build())
        .build())));
    try {
      return deep.readTree(json);
    } catch (JacksonException e) {
      throw new InvalidDocumentException("not valid JSON", List.of(new Problem("", e.getOriginalMessage())));
    }
  }

  /** A streaming parser, e.g. to read a large file document by document. */
  public JsonParser parser(InputStream in) {
    return mapper.createParser(in);
  }

  /** Reads the value at the parser's current token as a tree (numbers exact, as in {@link #parse}). */
  public JsonNode readTree(JsonParser parser) {
    return streamReader.readTree(parser);
  }

  /** A streaming generator, e.g. to write a large file document by document. */
  public JsonGenerator generator(OutputStream out) {
    return mapper.createGenerator(out);
  }

  /** Validates a tree against the schema of {@code document}; empty if it is valid. */
  public List<Problem> validate(Document document, JsonNode json) {
    return schemas.validate(document, json);
  }

  /** Validates a tree against the schema of {@code document} and maps it. */
  public Object fromTree(Document document, JsonNode json) {
    List<Problem> problems = schemas.validate(document, json);
    if (!problems.isEmpty()) {
      throw new InvalidDocumentException("invalid " + document.schemaId(), problems);
    }
    try {
      return switch (document) {
        case MAP_OBJECT -> mapObject(json);
        case LAYER -> layer(json);
        case CHANGE_REQUEST -> changeRequest(json);
        case CHANGE_EVENT -> changeEvent(json);
        case CHANGE_REJECTION -> changeRejection(json);
        case PLUGIN_MANIFEST -> throw new IllegalArgumentException("manifests are not model types");
      };
    } catch (IllegalArgumentException | NullPointerException | DateTimeParseException | ArithmeticException e) {
      throw new InvalidDocumentException("invalid " + document.schemaId(), List.of(new Problem("", String.valueOf(e.getMessage()))));
    }
  }

  private MapObject mapObject(JsonNode n) {
    return new MapObject(uuid(n, "id"), n.get("version").longValue(), objectContent(n), meta(n.get("meta")));
  }

  private Layer layer(JsonNode n) {
    return new Layer(uuid(n, "id"), n.get("version").longValue(), layerContent(n), meta(n.get("meta")));
  }

  private MapObjectContent objectContent(JsonNode n) {
    return new MapObjectContent(
        text(n, "type"),
        text(n, "dataType"),
        text(n, "dataSource"),
        present(n, "time") ? time(n.get("time")) : null,
        uuid(n, "layerId"),
        geometry(n.get("geometry")),
        present(n, "symbol") ? symbol(n.get("symbol")) : null,
        present(n, "style") ? style(n.get("style")) : null,
        present(n, "properties") ? properties(n.get("properties")) : null,
        label(n.get("label")),
        extensions(n.get("extensions")),
        present(n, "fieldSets") ? strings(n.get("fieldSets")) : List.of(),
        present(n, "relations") ? relations(n.get("relations")) : List.of(),
        present(n, "text") ? textOf(n.get("text")) : null,
        optionalText(n, "displayClass")); // data model 1.6.0 (CR-0041 part D): the schema checked its value
  }

  /** Data model 1.6.0 (CR-0041 part A): a {@code core.text}'s text. */
  private static Text textOf(JsonNode t) {
    return new Text(text(t, "value"), optionalNumber(t, "rotation"), present(t, "size") ? t.get("size").intValue() : null);
  }

  /** Data model 1.4.0: an object's relations (CR-0031, ADR-0051), in their order. */
  private static List<Relation> relations(JsonNode array) {
    List<Relation> list = new ArrayList<>();
    for (JsonNode r : array) {
      list.add(new Relation(text(r, "kind"), uuid(r, "objectId")));
    }
    return list;
  }

  private static List<String> strings(JsonNode array) {
    List<String> list = new ArrayList<>();
    for (JsonNode v : array) {
      list.add(v.stringValue());
    }
    return list;
  }

  private static TimeAttributes time(JsonNode t) {
    return new TimeAttributes(optionalInstant(t, "observed"), optionalInstant(t, "validFrom"), optionalInstant(t, "expires"));
  }

  private static ExternalRef externalRef(JsonNode r) {
    return new ExternalRef(text(r, "system"), text(r, "id"));
  }

  /**
   * Data model 1.2.0: the {@code workspace} as written ({@code null} when absent; {@code core.view}
   * kept, R2). 1.3.0: {@code locked} as written ({@code null} when absent, so an update without it
   * keeps the stored lock; {@code false} kept, so an update can clear it).
   */
  private LayerContent layerContent(JsonNode n) {
    return new LayerContent(
        text(n, "name"), n.get("drawOrder").doubleValue(), n.get("visible").booleanValue(), label(n.get("label")),
        extensions(n.get("extensions")), optionalText(n, "workspace"), present(n, "locked") ? n.get("locked").booleanValue() : null);
  }

  private Geometry geometry(JsonNode g) {
    return switch (text(g, "type")) {
      case "Point" -> new Geometry.Point(position(g.get("coordinates")));
      case "MultiPoint" -> new Geometry.MultiPoint(positions(g.get("coordinates")));
      case "LineString" -> new Geometry.LineString(positions(g.get("coordinates")));
      case "Polygon" -> {
        List<List<Position>> rings = new ArrayList<>();
        for (JsonNode ring : g.get("coordinates")) {
          rings.add(positions(ring));
        }
        yield new Geometry.Polygon(rings);
      }
      case "Circle" -> new Geometry.Circle(position(g.get("center")), number(g, "radius"));
      case "Ellipse" -> new Geometry.Ellipse(
          position(g.get("center")), number(g, "semiMajorAxis"), number(g, "semiMinorAxis"), number(g, "rotation"));
      case "Corridor" -> new Geometry.Corridor(positions(g.get("coordinates")), number(g, "width"));
      case "ArcBand" -> new Geometry.ArcBand(
          position(g.get("center")), number(g, "innerRadius"), number(g, "outerRadius"), number(g, "startBearing"),
          number(g, "endBearing"));
      default -> throw new IllegalArgumentException("unknown geometry type: " + text(g, "type"));
    };
  }

  private static Position position(JsonNode p) {
    return new Position(p.get(0).doubleValue(), p.get(1).doubleValue(), p.size() > 2 ? p.get(2).doubleValue() : null);
  }

  private static List<Position> positions(JsonNode array) {
    List<Position> list = new ArrayList<>(array.size());
    for (JsonNode p : array) {
      list.add(position(p));
    }
    return list;
  }

  private static Symbol symbol(JsonNode s) {
    return new Symbol(
        SymbolStandard.fromJson(text(s, "standard")), text(s, "sidc"), present(s, "modifiers") ? modifiers(s.get("modifiers")) : null);
  }

  private static Modifiers modifiers(JsonNode m) {
    Map<TextModifier, String> texts = new EnumMap<>(TextModifier.class);
    Double direction = null;
    Double speed = null;
    List<Double> distances = List.of();
    List<Double> azimuths = List.of();
    for (Map.Entry<String, JsonNode> entry : m.properties()) {
      switch (entry.getKey()) {
        case "direction" -> direction = entry.getValue().doubleValue();
        case "speed" -> speed = entry.getValue().doubleValue();
        case "distances" -> distances = numbers(entry.getValue()); // data model 1.4.0: AM, metres
        case "azimuths" -> azimuths = numbers(entry.getValue()); // data model 1.4.0: AN, degrees
        default -> texts.put(TextModifier.fromJson(entry.getKey()), entry.getValue().stringValue());
      }
    }
    return new Modifiers(texts, direction, speed, distances, azimuths);
  }

  private static List<Double> numbers(JsonNode array) {
    List<Double> list = new ArrayList<>();
    for (JsonNode v : array) {
      list.add(v.doubleValue());
    }
    return list;
  }

  private static Style style(JsonNode s) {
    return new Style(
        optionalText(s, "strokeColor"), optionalNumber(s, "strokeWidth"), optionalNumber(s, "strokeOpacity"),
        present(s, "strokeDash") ? Style.Dash.fromJson(text(s, "strokeDash")) : null, optionalText(s, "fillColor"),
        optionalNumber(s, "fillOpacity"),
        // Data model 1.1.0 (CR-0014): read and written here, or an object passing through would lose them.
        present(s, "fillPattern") ? Style.FillPattern.fromJson(text(s, "fillPattern")) : null,
        present(s, "arrowhead") ? Style.Arrowhead.fromJson(text(s, "arrowhead")) : null,
        present(s, "pointMarkers") ? Style.PointMarkers.fromJson(text(s, "pointMarkers")) : null);
  }

  private static ObjectProperties properties(JsonNode p) {
    return new ObjectProperties(optionalText(p, "name"), optionalText(p, "description"));
  }

  private static SecurityLabel label(JsonNode l) {
    JsonNode policy = l.get("policyIdentifier");
    List<SecurityLabel.Category> categories = new ArrayList<>();
    if (present(l, "categories")) {
      for (JsonNode c : l.get("categories")) {
        List<String> values = new ArrayList<>();
        for (JsonNode v : c.get("values")) {
          values.add(v.stringValue());
        }
        categories.add(new SecurityLabel.Category(
            text(c, "tagName"), SecurityLabel.CategoryType.fromJson(text(c, "type")), optionalText(c, "uri"), values));
      }
    }
    return new SecurityLabel(
        new SecurityLabel.Policy(text(policy, "name"), optionalText(policy, "uri")), text(l, "classification"),
        categories, optionalInstant(l, "creationDateTime"), optionalInstant(l, "reviewDateTime"));
  }

  private static Extensions extensions(@Nullable JsonNode e) {
    if (e == null || e.isNull() || e.isEmpty()) {
      return Extensions.empty();
    }
    Map<String, JsonObject> namespaces = new LinkedHashMap<>();
    for (Map.Entry<String, JsonNode> entry : e.properties()) {
      namespaces.put(entry.getKey(), (JsonObject) toJsonValue(entry.getValue()));
    }
    return new Extensions(namespaces);
  }

  private static Meta meta(JsonNode m) {
    return new Meta(
        audit(m.get("created")), audit(m.get("modified")), present(m, "externalRef") ? externalRef(m.get("externalRef")) : null);
  }

  private static Meta.Audit audit(JsonNode a) {
    return new Meta.Audit(instant(a, "at"), actor(a.get("by")));
  }

  private static Actor actor(JsonNode a) {
    return new Actor(text(a, "plugin"), optionalText(a, "user"), optionalText(a, "system"));
  }

  private ChangeRequest changeRequest(JsonNode n) {
    EntityType entityType = EntityType.fromJson(text(n, "entityType"));
    return new ChangeRequest(
        uuid(n, "requestId"), entityType, Operation.fromJson(text(n, "operation")),
        uuid(n, "entityId"), optionalLong(n, "baseVersion"), present(n, "data") ? content(entityType, n.get("data")) : null,
        present(n, "externalRef") ? externalRef(n.get("externalRef")) : null, actor(n.get("source")),
        present(n, "fields") ? fieldValues(n.get("fields")) : List.of());
  }

  /** Data model 1.2.0: a change request's declared {@code fields} (ADR-0038); a JSON {@code null} value removes one. */
  private static List<FieldValue> fieldValues(JsonNode array) {
    List<FieldValue> fields = new ArrayList<>();
    for (JsonNode f : array) {
      JsonNode value = f.get("value");
      fields.add(new FieldValue(text(f, "plugin"), text(f, "name"), value == null || value.isNull() ? null : toJsonValue(value)));
    }
    return fields;
  }

  private EntityContent content(EntityType entityType, JsonNode data) {
    return entityType == EntityType.OBJECT ? objectContent(data) : layerContent(data);
  }

  private ChangeEvent changeEvent(JsonNode n) {
    EntityType entityType = EntityType.fromJson(text(n, "entityType"));
    Entity state = null;
    if (present(n, "state")) {
      state = entityType == EntityType.OBJECT ? mapObject(n.get("state")) : layer(n.get("state"));
    }
    return new ChangeEvent(
        n.get("sequenceNo").longValue(), uuid(n, "requestId"), entityType,
        Operation.fromJson(text(n, "operation")), uuid(n, "entityId"),
        n.get("version").longValue(), optionalLong(n, "previousVersion"), optionalLong(n, "baseVersion"), state,
        label(n.get("label")), instant(n, "at"), actor(n.get("by")));
  }

  private static ChangeRejection changeRejection(JsonNode n) {
    List<ChangeRejection.Detail> details = new ArrayList<>();
    if (present(n, "details")) {
      for (JsonNode d : n.get("details")) {
        details.add(new ChangeRejection.Detail(text(d, "path"), text(d, "problem")));
      }
    }
    return new ChangeRejection(
        uuid(n, "requestId"), EntityType.fromJson(text(n, "entityType")),
        Operation.fromJson(text(n, "operation")), uuid(n, "entityId"),
        ChangeRejection.Code.valueOf(text(n, "code")), text(n, "message"), details, instant(n, "at"));
  }

  // ---- Writing ---------------------------------------------------------------------------------

  /** Serializes a model value: a map object, layer, change request, change event, change rejection or security label. */
  public String write(Object value) {
    return toTree(value).toString();
  }

  /** The JSON tree of a model value, e.g. to embed it in a larger document. */
  public ObjectNode toTree(Object value) {
    return switch (value) {
      case MapObject o -> mapObjectNode(o);
      case Layer l -> layerNode(l);
      case ChangeRequest r -> changeRequestNode(r);
      case ChangeEvent e -> changeEventNode(e);
      case ChangeRejection r -> changeRejectionNode(r);
      case SecurityLabel l -> labelNode(l);
      default -> throw new IllegalArgumentException("not a model value: " + value.getClass().getName());
    };
  }

  private ObjectNode mapObjectNode(MapObject o) {
    ObjectNode n = nodes.objectNode();
    n.put("id", o.id().toString());
    putObjectContent(n, o.content());
    n.put("version", o.version());
    n.set("meta", metaNode(o.meta()));
    return n;
  }

  private ObjectNode layerNode(Layer l) {
    ObjectNode n = nodes.objectNode();
    n.put("id", l.id().toString());
    putLayerContent(n, l.content());
    n.put("version", l.version());
    n.set("meta", metaNode(l.meta()));
    return n;
  }

  private void putObjectContent(ObjectNode n, MapObjectContent c) {
    n.put("type", c.type());
    n.put("dataType", c.dataType());
    n.put("dataSource", c.dataSource());
    TimeAttributes time = c.time();
    if (time != null) {
      ObjectNode t = nodes.objectNode();
      putIfPresent(t, "observed", time.observed());
      putIfPresent(t, "validFrom", time.validFrom());
      putIfPresent(t, "expires", time.expires());
      n.set("time", t);
    }
    n.put("layerId", c.layerId().toString());
    n.set("geometry", geometryNode(c.geometry()));
    if (c.symbol() != null) {
      n.set("symbol", symbolNode(c.symbol()));
    }
    Text text = c.text();
    if (text != null) { // data model 1.6.0: only a core.text has one
      ObjectNode t = n.putObject("text").put("value", text.value());
      if (text.rotation() != null) {
        t.put("rotation", text.rotation());
      }
      if (text.size() != null) {
        t.put("size", text.size());
      }
    }
    if (c.style() != null) {
      n.set("style", styleNode(c.style()));
    }
    ObjectProperties p = c.properties();
    if (p != null) {
      ObjectNode props = nodes.objectNode();
      putIfPresent(props, "name", p.name());
      putIfPresent(props, "description", p.description());
      n.set("properties", props);
    }
    n.set("label", labelNode(c.label()));
    putExtensions(n, c.extensions());
    putIfPresent(n, "displayClass", c.displayClass()); // data model 1.6.0 (CR-0041 part D)
    // Data model 1.4.0 (ADR-0050, ADR-0051): written only when not empty (rule 13).
    if (!c.fieldSets().isEmpty()) {
      c.fieldSets().forEach(n.putArray("fieldSets")::add);
    }
    if (!c.relations().isEmpty()) {
      ArrayNode relations = n.putArray("relations");
      c.relations().forEach(r -> relations.addObject().put("kind", r.kind()).put("objectId", r.objectId().toString()));
    }
  }

  private void putLayerContent(ObjectNode n, LayerContent c) {
    n.put("name", c.name());
    n.put("drawOrder", c.drawOrder());
    n.put("visible", c.visible());
    n.set("label", labelNode(c.label()));
    putExtensions(n, c.extensions());
    putIfPresent(n, "workspace", c.workspace()); // data model 1.2.0; absent for View as the store keeps it (R2)
    if (c.locked() != null) {
      n.put("locked", c.locked()); // data model 1.3.0; the store keeps false as absent (ADR-0042)
    }
  }

  private ObjectNode geometryNode(Geometry geometry) {
    ObjectNode n = nodes.objectNode();
    n.put("type", geometry.typeName());
    switch (geometry) {
      case Geometry.Point p -> n.set("coordinates", positionNode(p.coordinates()));
      case Geometry.MultiPoint m -> n.set("coordinates", positionsNode(m.coordinates()));
      case Geometry.LineString l -> n.set("coordinates", positionsNode(l.coordinates()));
      case Geometry.Polygon p -> {
        ArrayNode rings = nodes.arrayNode();
        p.rings().forEach(ring -> rings.add(positionsNode(ring)));
        n.set("coordinates", rings);
      }
      case Geometry.Circle c -> {
        n.set("center", positionNode(c.center()));
        n.put("radius", c.radius());
      }
      case Geometry.Ellipse e -> {
        n.set("center", positionNode(e.center()));
        n.put("semiMajorAxis", e.semiMajorAxis());
        n.put("semiMinorAxis", e.semiMinorAxis());
        n.put("rotation", e.rotation());
      }
      case Geometry.Corridor c -> {
        n.set("coordinates", positionsNode(c.coordinates()));
        n.put("width", c.width());
      }
      case Geometry.ArcBand a -> {
        n.set("center", positionNode(a.center()));
        n.put("innerRadius", a.innerRadius());
        n.put("outerRadius", a.outerRadius());
        n.put("startBearing", a.startBearing());
        n.put("endBearing", a.endBearing());
      }
    }
    return n;
  }

  private ArrayNode positionNode(Position p) {
    ArrayNode a = nodes.arrayNode();
    a.add(p.longitude());
    a.add(p.latitude());
    if (p.altitude() != null) {
      a.add(p.altitude());
    }
    return a;
  }

  private ArrayNode positionsNode(List<Position> positions) {
    ArrayNode a = nodes.arrayNode();
    positions.forEach(p -> a.add(positionNode(p)));
    return a;
  }

  private ObjectNode symbolNode(Symbol s) {
    ObjectNode n = nodes.objectNode();
    n.put("standard", s.standard().json());
    n.put("sidc", s.sidc());
    Modifiers m = s.modifiers();
    if (m != null) {
      ObjectNode mods = nodes.objectNode();
      m.texts().forEach((modifier, text) -> mods.put(modifier.json(), text));
      if (m.direction() != null) {
        mods.put("direction", m.direction());
      }
      if (m.speed() != null) {
        mods.put("speed", m.speed());
      }
      // Data model 1.4.0: empty is absent (the schema wants at least one value).
      if (!m.distances().isEmpty()) {
        m.distances().forEach(mods.putArray("distances")::add);
      }
      if (!m.azimuths().isEmpty()) {
        m.azimuths().forEach(mods.putArray("azimuths")::add);
      }
      n.set("modifiers", mods);
    }
    return n;
  }

  private ObjectNode styleNode(Style s) {
    ObjectNode n = nodes.objectNode();
    putIfPresent(n, "strokeColor", s.strokeColor());
    putIfPresent(n, "strokeWidth", s.strokeWidth());
    putIfPresent(n, "strokeOpacity", s.strokeOpacity());
    if (s.strokeDash() != null) {
      n.put("strokeDash", s.strokeDash().json());
    }
    putIfPresent(n, "fillColor", s.fillColor());
    putIfPresent(n, "fillOpacity", s.fillOpacity());
    if (s.fillPattern() != null) {
      n.put("fillPattern", s.fillPattern().json());
    }
    if (s.arrowhead() != null) {
      n.put("arrowhead", s.arrowhead().json());
    }
    if (s.pointMarkers() != null) {
      n.put("pointMarkers", s.pointMarkers().json());
    }
    return n;
  }

  private ObjectNode labelNode(SecurityLabel l) {
    ObjectNode n = nodes.objectNode();
    ObjectNode policy = nodes.objectNode();
    policy.put("name", l.policyIdentifier().name());
    putIfPresent(policy, "uri", l.policyIdentifier().uri());
    n.set("policyIdentifier", policy);
    n.put("classification", l.classification());
    if (!l.categories().isEmpty()) {
      ArrayNode categories = nodes.arrayNode();
      for (SecurityLabel.Category c : l.categories()) {
        ObjectNode cn = nodes.objectNode();
        cn.put("tagName", c.tagName());
        cn.put("type", c.type().json());
        putIfPresent(cn, "uri", c.uri());
        ArrayNode values = nodes.arrayNode();
        c.values().forEach(values::add);
        cn.set("values", values);
        categories.add(cn);
      }
      n.set("categories", categories);
    }
    if (l.creationDateTime() != null) {
      n.put("creationDateTime", TIMESTAMP.format(l.creationDateTime()));
    }
    if (l.reviewDateTime() != null) {
      n.put("reviewDateTime", TIMESTAMP.format(l.reviewDateTime()));
    }
    return n;
  }

  private void putExtensions(ObjectNode n, Extensions extensions) {
    if (extensions.isEmpty()) {
      return; // rule 13: writers omit empty optional objects
    }
    ObjectNode e = nodes.objectNode();
    extensions.namespaces().forEach((namespace, value) -> e.set(namespace, toNode(value)));
    n.set("extensions", e);
  }

  private ObjectNode metaNode(Meta m) {
    ObjectNode n = nodes.objectNode();
    n.set("created", auditNode(m.created()));
    n.set("modified", auditNode(m.modified()));
    ExternalRef ref = m.externalRef();
    if (ref != null) {
      n.set("externalRef", externalRefNode(ref));
    }
    return n;
  }

  private ObjectNode externalRefNode(ExternalRef ref) {
    ObjectNode r = nodes.objectNode();
    r.put("system", ref.system());
    r.put("id", ref.id());
    return r;
  }

  private ObjectNode auditNode(Meta.Audit a) {
    ObjectNode n = nodes.objectNode();
    n.put("at", TIMESTAMP.format(a.at()));
    n.set("by", actorNode(a.by()));
    return n;
  }

  private ObjectNode actorNode(Actor a) {
    ObjectNode n = nodes.objectNode();
    n.put("plugin", a.plugin());
    putIfPresent(n, "user", a.user());
    putIfPresent(n, "system", a.system());
    return n;
  }

  private ObjectNode changeRequestNode(ChangeRequest r) {
    ObjectNode n = nodes.objectNode();
    n.put("requestId", r.requestId().toString());
    n.put("entityType", r.entityType().json());
    n.put("operation", r.operation().json());
    n.put("entityId", r.entityId().toString());
    if (r.baseVersion() != null) {
      n.put("baseVersion", r.baseVersion());
    }
    EntityContent data = r.data();
    if (data != null) {
      ObjectNode d = nodes.objectNode();
      switch (data) {
        case MapObjectContent c -> putObjectContent(d, c);
        case LayerContent c -> putLayerContent(d, c);
      }
      n.set("data", d);
    }
    ExternalRef ref = r.externalRef();
    if (ref != null) {
      n.set("externalRef", externalRefNode(ref));
    }
    n.set("source", actorNode(r.source()));
    if (!r.fields().isEmpty()) { // data model 1.2.0 (ADR-0038); rule 13: an empty list is left out
      ArrayNode fields = nodes.arrayNode();
      for (FieldValue f : r.fields()) {
        ObjectNode field = nodes.objectNode();
        field.put("plugin", f.plugin());
        field.put("name", f.name());
        JsonValue value = f.value();
        if (value == null) {
          field.putNull("value");
        } else {
          field.set("value", toNode(value));
        }
        fields.add(field);
      }
      n.set("fields", fields);
    }
    return n;
  }

  private ObjectNode changeEventNode(ChangeEvent e) {
    ObjectNode n = nodes.objectNode();
    n.put("sequenceNo", e.sequenceNo());
    n.put("requestId", e.requestId().toString());
    n.put("entityType", e.entityType().json());
    n.put("operation", e.operation().json());
    n.put("entityId", e.entityId().toString());
    n.put("version", e.version());
    if (e.previousVersion() == null) {
      n.putNull("previousVersion"); // required, null for a create
    } else {
      n.put("previousVersion", e.previousVersion());
    }
    if (e.baseVersion() != null) {
      n.put("baseVersion", e.baseVersion());
    }
    Entity state = e.state();
    if (state == null) {
      n.putNull("state"); // required, null for a delete
    } else {
      n.set("state", toTree(state));
    }
    n.set("label", labelNode(e.label()));
    n.put("at", TIMESTAMP.format(e.at()));
    n.set("by", actorNode(e.by()));
    return n;
  }

  private ObjectNode changeRejectionNode(ChangeRejection r) {
    ObjectNode n = nodes.objectNode();
    n.put("requestId", r.requestId().toString());
    n.put("entityType", r.entityType().json());
    n.put("operation", r.operation().json());
    n.put("entityId", r.entityId().toString());
    n.put("code", r.code().name());
    n.put("message", r.message());
    if (!r.details().isEmpty()) {
      ArrayNode details = nodes.arrayNode();
      for (ChangeRejection.Detail d : r.details()) {
        ObjectNode dn = nodes.objectNode();
        dn.put("path", d.path());
        dn.put("problem", d.problem());
        details.add(dn);
      }
      n.set("details", details);
    }
    n.put("at", TIMESTAMP.format(r.at()));
    return n;
  }

  // ---- Opaque JSON (extensions, settings) ----------------------------------------------------------

  /** Converts a Jackson tree to the SDK's JSON value, keeping numbers exact. */
  public static JsonValue toJsonValue(JsonNode node) {
    if (node.isObject()) {
      JsonObject.Builder builder = JsonObject.builder();
      for (Map.Entry<String, JsonNode> entry : node.properties()) {
        builder.put(entry.getKey(), toJsonValue(entry.getValue()));
      }
      return builder.build();
    }
    if (node.isArray()) {
      List<JsonValue> values = new ArrayList<>(node.size());
      node.values().forEach(v -> values.add(toJsonValue(v)));
      return new JsonArray(values);
    }
    if (node.isString()) {
      return JsonString.of(node.stringValue());
    }
    if (node.isNumber()) {
      return JsonNumber.of(node.isIntegralNumber() ? new BigDecimal(node.bigIntegerValue()) : node.decimalValue());
    }
    if (node.isBoolean()) {
      return JsonBoolean.of(node.booleanValue());
    }
    if (node.isNull()) {
      return JsonNull.INSTANCE;
    }
    throw new IllegalArgumentException("unsupported JSON node: " + node.getNodeType());
  }

  /** Converts the SDK's JSON value to a Jackson tree, keeping numbers exact. */
  public JsonNode toNode(JsonValue value) {
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

  // ---- Helpers ------------------------------------------------------------------------------------

  private static boolean present(JsonNode n, String name) {
    JsonNode v = n.get(name);
    return v != null && !v.isNull();
  }

  private static String text(JsonNode n, String name) {
    return n.get(name).stringValue();
  }

  private static @Nullable String optionalText(JsonNode n, String name) {
    return present(n, name) ? text(n, name) : null;
  }

  private static double number(JsonNode n, String name) {
    return n.get(name).doubleValue();
  }

  private static @Nullable Double optionalNumber(JsonNode n, String name) {
    return present(n, name) ? number(n, name) : null;
  }

  private static @Nullable Long optionalLong(JsonNode n, String name) {
    return present(n, name) ? n.get(name).longValue() : null;
  }

  private static UUID uuid(JsonNode n, String name) {
    return UUID.fromString(text(n, name));
  }

  private static Instant instant(JsonNode n, String name) {
    return Instant.parse(text(n, name));
  }

  private static @Nullable Instant optionalInstant(JsonNode n, String name) {
    return present(n, name) ? instant(n, name) : null;
  }

  private static void putIfPresent(ObjectNode n, String name, @Nullable String value) {
    if (value != null) {
      n.put(name, value);
    }
  }

  private static void putIfPresent(ObjectNode n, String name, @Nullable Instant value) {
    if (value != null) {
      n.put(name, TIMESTAMP.format(value));
    }
  }

  private static void putIfPresent(ObjectNode n, String name, @Nullable Double value) {
    if (value != null) {
      n.put(name, value);
    }
  }
}
