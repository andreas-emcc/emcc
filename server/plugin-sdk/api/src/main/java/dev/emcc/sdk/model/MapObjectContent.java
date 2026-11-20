package dev.emcc.sdk.model;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * The fields of a map object that its creator controls. On update, these core fields are replaced
 * as a whole (model rule 5): send the complete content.
 *
 * <pre>{@code
 * new MapObjectContent("core.shape", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layerId,
 *     new Geometry.Circle(Position.of(11.9746, 57.7089), 2500),
 *     null, new Style("#A33A3A", 2.0, null, Style.Dash.DASH, null, null),
 *     new ObjectProperties("Restricted area", null), label, Extensions.empty())
 * }</pre>
 *
 * @param type what the object is on the map: {@code core.symbol}, {@code core.multipoint}, {@code core.shape}, from 1.6.0 {@code core.text}, or {@code <plugin-id>.<name>}
 * @param dataType what kind of information it is (ADR-0023): {@link #GENERAL} or a data type a plugin declares, {@code <plugin-id>.<name>}; it must be available when the object is created or its data type changed (model rule 14)
 * @param dataSource where it came from: {@link #MANUAL} for drawn objects, otherwise the stream's name, e.g. {@code tak-north}; fixed at creation (model rule 14)
 * @param time the time attributes, or {@code null} (an empty one becomes {@code null}, model rule 13)
 * @param layerId the layer
 * @param geometry the geometry
 * @param symbol the symbol; required for {@code core.symbol} and {@code core.multipoint}, absent for {@code core.shape}
 * @param style the style, or {@code null}
 * @param properties name and description, or {@code null}
 * @param label the security label
 * @param extensions plugin data; empty when there is none
 * @param fieldSets SDK 1.4.0: the field sets the object carries (ADR-0050), full ids {@code
 *     <plugin-id>.<set>}, each once, at most {@value #MAX_FIELD_SETS}; empty when absent. On update an
 *     empty list keeps the stored sets and a listed one is added; nothing removes a set (model rule
 *     5's third exception). A set a request adds must be declared (rule 18)
 * @param relations SDK 1.4.0: the relations to other objects (ADR-0051), each once, at most {@value
 *     Relation#MAX_PER_OBJECT}; empty when absent. Replaced as a whole on update (rule 5): keep the
 *     entries of other kinds, see {@link Relation#replace}. Kinds are checked by rule 17
 * @param text data model 1.6.0 (CR-0041 part A): for {@link #TEXT} its text, required; {@code null} for every other type
 * @param displayClass data model 1.6.0 (CR-0041 part D; T-182): one of {@link DisplayClass#ALL}, what the
 *     object is for the user's display filters, or {@code null} for none. Editors forward it
 */
public record MapObjectContent(
    String type,
    String dataType,
    String dataSource,
    @Nullable TimeAttributes time,
    UUID layerId,
    Geometry geometry,
    @Nullable Symbol symbol,
    @Nullable Style style,
    @Nullable ObjectProperties properties,
    SecurityLabel label,
    Extensions extensions,
    List<String> fieldSets,
    List<Relation> relations,
    @Nullable Text text,
    @Nullable String displayClass)
    implements EntityContent {

  public static final String SYMBOL = "core.symbol";
  public static final String MULTIPOINT = "core.multipoint";
  public static final String SHAPE = "core.shape";

  /** Data model 1.6.0 (CR-0041 part A): a text at a point, with {@link #text()}. */
  public static final String TEXT = "core.text";

  /** The built-in data type (ADR-0023 point 3). */
  public static final String GENERAL = "core.general";

  /** The data source of objects that users draw (ADR-0023 point 5). */
  public static final String MANUAL = "manual";

  /** SDK 1.4.0: the most field sets one object carries. */
  public static final int MAX_FIELD_SETS = 64;

  private static final Pattern DATA_SOURCE = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  private static final Pattern TYPE_NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public MapObjectContent {
    Objects.requireNonNull(type, "type");
    Objects.requireNonNull(dataType, "dataType");
    Objects.requireNonNull(dataSource, "dataSource");
    Objects.requireNonNull(layerId, "layerId");
    Objects.requireNonNull(geometry, "geometry");
    Objects.requireNonNull(label, "label");
    Objects.requireNonNull(extensions, "extensions");
    Objects.requireNonNull(fieldSets, "fieldSets");
    fieldSets = List.copyOf(fieldSets);
    if (fieldSets.size() > MAX_FIELD_SETS) {
      throw new IllegalArgumentException("an object carries at most " + MAX_FIELD_SETS + " field sets");
    }
    if (new LinkedHashSet<>(fieldSets).size() != fieldSets.size()) {
      throw new IllegalArgumentException("a field set is listed twice: " + fieldSets);
    }
    for (String set : fieldSets) {
      if (!TYPE_NAME.matcher(set).matches() || set.length() > 129) {
        throw new IllegalArgumentException("a field set's id must be '<plugin-id>.<set>': " + set);
      }
    }
    relations = Relation.checked(relations);
    if (!TYPE_NAME.matcher(type).matches() || type.length() > 129) {
      throw new IllegalArgumentException("type must be '<namespace>.<name>': " + type);
    }
    if (!TYPE_NAME.matcher(dataType).matches() || dataType.length() > 129) {
      throw new IllegalArgumentException("dataType must be '<namespace>.<name>': " + dataType);
    }
    if (!DATA_SOURCE.matcher(dataSource).matches() || dataSource.length() > 64) {
      throw new IllegalArgumentException("dataSource must be lowercase words separated by hyphens, at most 64 characters: " + dataSource);
    }
    if (time != null && time.isEmpty()) {
      time = null;
    }
    if (style != null && style.isEmpty()) {
      style = null;
    }
    if (properties != null && properties.isEmpty()) {
      properties = null;
    }
    switch (type) {
      case SYMBOL -> {
        if (symbol == null || !(geometry instanceof Geometry.Point)) {
          throw new IllegalArgumentException("a core.symbol needs a symbol and a Point");
        }
      }
      case MULTIPOINT -> {
        if (symbol == null || !(geometry instanceof Geometry.LineString || geometry instanceof Geometry.Polygon || geometry instanceof Geometry.MultiPoint)) {
          throw new IllegalArgumentException("a core.multipoint needs a symbol and a LineString, Polygon or MultiPoint");
        }
      }
      case SHAPE -> {
        if (symbol != null) {
          throw new IllegalArgumentException("a core.shape has no symbol");
        }
      }
      case TEXT -> {
        if (text == null || symbol != null || !(geometry instanceof Geometry.Point)) {
          throw new IllegalArgumentException("a core.text needs a text and a Point, and has no symbol");
        }
      }
      default -> {}
    }
    if (text != null && !type.equals(TEXT)) {
      throw new IllegalArgumentException("only a core.text has a text: " + type);
    }
    if (displayClass != null && !DisplayClass.ALL.contains(displayClass)) {
      throw new IllegalArgumentException("a display class is one of " + DisplayClass.ALL + ": " + displayClass);
    }
  }

  /** The 1.6.0 part A form, without a display class. */
  public MapObjectContent(String type, String dataType, String dataSource, @Nullable TimeAttributes time, UUID layerId, Geometry geometry,
      @Nullable Symbol symbol, @Nullable Style style, @Nullable ObjectProperties properties, SecurityLabel label, Extensions extensions,
      List<String> fieldSets, List<Relation> relations, @Nullable Text text) {
    this(type, dataType, dataSource, time, layerId, geometry, symbol, style, properties, label, extensions, fieldSets, relations, text, null);
  }

  /** The 1.4.0 form, without a text (data model 1.6.0). */
  public MapObjectContent(String type, String dataType, String dataSource, @Nullable TimeAttributes time, UUID layerId, Geometry geometry,
      @Nullable Symbol symbol, @Nullable Style style, @Nullable ObjectProperties properties, SecurityLabel label, Extensions extensions,
      List<String> fieldSets, List<Relation> relations) {
    this(type, dataType, dataSource, time, layerId, geometry, symbol, style, properties, label, extensions, fieldSets, relations, null, null);
  }

  /** The 1.3.0 form, without field sets or relations. */
  public MapObjectContent(String type, String dataType, String dataSource, @Nullable TimeAttributes time, UUID layerId, Geometry geometry,
      @Nullable Symbol symbol, @Nullable Style style, @Nullable ObjectProperties properties, SecurityLabel label, Extensions extensions) {
    this(type, dataType, dataSource, time, layerId, geometry, symbol, style, properties, label, extensions, List.of(), List.of());
  }

  /** SDK 1.4.0: a copy with these field sets instead. */
  public MapObjectContent withFieldSets(List<String> value) {
    return new MapObjectContent(type, dataType, dataSource, time, layerId, geometry, symbol, style, properties, label, extensions, value, relations, text, displayClass);
  }

  /** SDK 1.4.0: a copy that also carries {@code setId}, after its own sets; this one if it carries it already. */
  public MapObjectContent withFieldSet(String setId) {
    if (fieldSets.contains(setId)) {
      return this;
    }
    var all = new ArrayList<>(fieldSets);
    all.add(setId);
    return withFieldSets(all);
  }

  /** SDK 1.4.0: a copy with these relations instead (see {@link Relation#replace}). */
  public MapObjectContent withRelations(List<Relation> value) {
    return new MapObjectContent(type, dataType, dataSource, time, layerId, geometry, symbol, style, properties, label, extensions, fieldSets, value, text, displayClass);
  }

  /** SDK 1.6.0 (CR-0041 part D): a copy with this display class, or {@code null} for none. */
  public MapObjectContent withDisplayClass(@Nullable String value) {
    return new MapObjectContent(type, dataType, dataSource, time, layerId, geometry, symbol, style, properties, label, extensions, fieldSets, relations, text, value);
  }

  @Override
  public EntityType entityType() {
    return EntityType.OBJECT;
  }
}
