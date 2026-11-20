package dev.emcc.plugins.nvg.mapping;

import dev.emcc.plugins.nvg.codec.Item;
import dev.emcc.plugins.nvg.codec.Kind;
import dev.emcc.plugins.nvg.codec.Ring;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.Text;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * One NVG item to the content of a map object (brief, section 3, "In"). Ordinary objects of the
 * data type of hand-made ones, {@code core.general} (owner, RK A); everything the model has no field
 * for goes to {@code extensions.nvg}, so that an export gives it back (ADR-0007). Never throws for
 * bad input: an item it cannot map is skipped with a counter.
 */
public final class ItemMapper {

  /** The extension namespace: the plugin id. */
  public static final String NAMESPACE = "nvg";

  /** The relation kind that links a composite's parts to its first part (owner, RL B). */
  public static final String PART_RELATION = "nvg.part";

  /** The attributes every item has, mapped or kept under their own key. */
  private static final Set<String> COMMON = Set.of("label", "href", "style", "symbol", "modifiers", "z", "minaltitude", "maxaltitude", "leg-type");

  private ItemMapper() {}

  /**
   * Where the objects go.
   *
   * @param dataSource {@code nvg-file} for an import, else the link's name (ADR-0023)
   * @param layerId the target layer, for new objects
   * @param fallbackLabel the label of items that carry none and whose document carries none: the link's or
   *     the import dialog's, else the server's default
   * @param classifications the server's orders, to refuse a label whose classification its policy does not know
   */
  public record Context(String dataSource, UUID layerId, SecurityLabel fallbackLabel, Classifications classifications) {
    public Context {
      Objects.requireNonNull(dataSource, "dataSource");
      Objects.requireNonNull(layerId, "layerId");
      Objects.requireNonNull(fallbackLabel, "fallbackLabel");
      Objects.requireNonNull(classifications, "classifications");
    }
  }

  /**
   * The outcome for one item.
   *
   * @param content the object's content (no relations yet: the writer adds a composite's), or {@code null} when skipped
   * @param skipped the counter of the reason it was skipped, or {@code null}
   * @param notes counters for values left out (e.g. {@code value out of range}); the rest of the item is used
   */
  public record Mapped(@Nullable MapObjectContent content, @Nullable String skipped, List<String> notes) {
    public Mapped {
      notes = List.copyOf(notes);
    }

    static Mapped skip(String counter) {
      return new Mapped(null, counter, List.of());
    }
  }

  public static Mapped map(Item item, Context ctx) {
    if (item.labelUnreadable()) {
      return Mapped.skip("label not understood");
    }
    SecurityLabel label = item.label() != null ? item.label() : ctx.fallbackLabel();
    if (item.label() != null && !ctx.classifications().order(label.policyIdentifier().name()).contains(label.classification())) {
      return Mapped.skip("label not understood");
    }
    List<String> notes = new ArrayList<>();
    try {
      return map(item, ctx, label, notes);
    } catch (Values.Bad bad) {
      return Mapped.skip(bad.counter);
    } catch (IllegalArgumentException e) {
      // A model record refused a value the checks above let through (e.g. a degenerate shape).
      return Mapped.skip("skipped: bad geometry");
    }
  }

  private static Mapped map(Item item, Context ctx, SecurityLabel label, List<String> notes) {
    JsonObject.Builder ext = JsonObject.builder();
    ext.put("element", JsonString.of(item.kind().element()));
    Css.In css = item.kind() == Kind.TEXT ? Css.readText(item.attribute("style")) : Css.read(item.attribute("style"), notes);
    Style style = css.style();
    putString(ext, "style", css.kept());
    putString(ext, "href", item.attribute("href"));
    putString(ext, "modifiers", item.attribute("modifiers"));
    putNumber(ext, "z", item.attribute("z"), notes);
    putNumber(ext, "minaltitude", item.attribute("minaltitude"), notes);
    putNumber(ext, "maxaltitude", item.attribute("maxaltitude"), notes);
    boolean rhumb = "rhumb-line".equals(item.attribute("leg-type"));
    if (rhumb) {
      ext.put("legType", JsonString.of("rhumb-line"));
    }
    putString(ext, "extendedData", item.extendedData());
    putString(ext, "extension", item.extension());
    putString(ext, "foreign", item.foreign());
    if (!item.groupPath().isEmpty()) {
      ext.put("groupPath", JsonArray.of(item.groupPath().stream().map(JsonString::of).toArray(JsonValue[]::new)));
    }
    if (item.compositeUri() != null) {
      ext.put("composite", JsonString.of(item.compositeUri()));
      putString(ext, "compositeSymbol", item.compositeSymbol());
    }

    Symbols.In symbol = Symbols.read(item.attribute("symbol"));
    putString(ext, "symbol", symbol.kept());

    String type;
    Geometry geometry;
    Symbol objectSymbol = null;
    Text text = null;
    Set<String> used;
    switch (item.kind()) {
      case POINT -> {
        geometry = new Geometry.Point(Values.position(item.attribute("x"), item.attribute("y")));
        Double speed = Values.optional(item.attribute("speed"), "speed", 0, 1e6, notes);
        Double course = Values.optional(item.attribute("course"), "course", 0, 360, notes);
        type = MapObjectContent.SYMBOL;
        objectSymbol = Symbols.withMotion(symbol.symbol(), speed, course);
        used = Set.of("x", "y", "speed", "course");
      }
      case TEXT -> {
        geometry = new Geometry.Point(Values.position(item.attribute("x"), item.attribute("y")));
        String value = item.content() == null ? "" : item.content();
        if (value.isBlank()) {
          return Mapped.skip("skipped: empty text");
        }
        if (value.length() > Text.MAX_LENGTH) {
          value = value.substring(0, Text.MAX_LENGTH);
          notes.add("value out of range");
        }
        Double rotation = Values.optional(item.attribute("rotation"), "rotation", 0, 360, notes);
        double clockwise = rotation == null ? 0 : Values.bearing(360 - rotation);
        text = new Text(value, clockwise == 0 ? null : clockwise, null);
        type = MapObjectContent.TEXT;
        used = Set.of("x", "y", "rotation");
      }
      case MULTIPOINT -> {
        geometry = new Geometry.MultiPoint(Values.points(item.attribute("points"), 1));
        type = graphicOrShape(symbol);
        objectSymbol = type.equals(MapObjectContent.MULTIPOINT) ? symbol.symbol() : null;
        used = Set.of("points");
      }
      case POLYLINE, ARROW -> {
        List<Position> points = Values.points(item.attribute("points"), 2);
        geometry = new Geometry.LineString(rhumb ? Geo.rhumb(points) : points);
        type = graphicOrShape(symbol);
        objectSymbol = type.equals(MapObjectContent.MULTIPOINT) ? symbol.symbol() : null;
        if (item.kind() == Kind.ARROW) {
          putNumber(ext, "width", item.attribute("width"), notes);
          if (type.equals(MapObjectContent.SHAPE)) {
            style = withArrowhead(style);
          }
        }
        used = Set.of("points", "width");
      }
      case POLYGON -> {
        List<Position> points = Values.points(item.attribute("points"), 3);
        List<List<Position>> rings = new ArrayList<>();
        rings.add(Geo.closed(rhumb ? Geo.rhumb(Geo.closed(points)) : points));
        type = graphicOrShape(symbol);
        if (type.equals(MapObjectContent.MULTIPOINT)) {
          objectSymbol = symbol.symbol();
        } else {
          rings.addAll(holes(item));
        }
        geometry = new Geometry.Polygon(rings);
        used = Set.of("points");
      }
      case CIRCLE -> {
        geometry = new Geometry.Circle(Values.center(item), Values.required(item.attribute("r"), "r", 0, 2e7));
        type = MapObjectContent.SHAPE;
        used = Set.of("cx", "cy", "r");
      }
      case ELLIPSE -> {
        geometry = ellipse(item);
        type = MapObjectContent.SHAPE;
        used = Set.of("cx", "cy", "rx", "ry", "rotation");
      }
      case RECT -> {
        List<List<Position>> rings = new ArrayList<>();
        rings.add(Geo.rectRing(Values.center(item), positive(item, "rx"), positive(item, "ry"), rotation(item, notes)));
        rings.addAll(holes(item));
        geometry = new Geometry.Polygon(rings);
        type = MapObjectContent.SHAPE;
        used = Set.of("cx", "cy", "rx", "ry", "rotation");
      }
      case CORRIDOR -> {
        List<Position> points = Values.points(item.attribute("points"), 2);
        geometry = new Geometry.Corridor(rhumb ? Geo.rhumb(points) : points, positive(item, "width"));
        type = MapObjectContent.SHAPE;
        used = Set.of("points", "width");
      }
      case ORBIT -> {
        List<Position> points = Values.points(item.attribute("points"), 2);
        geometry = new Geometry.Polygon(List.of(Geo.orbitRing(points.get(0), points.get(1), positive(item, "width"))));
        type = MapObjectContent.SHAPE;
        used = Set.of("points", "width");
      }
      case ARC -> {
        geometry = new Geometry.LineString(Geo.arc(Values.center(item), positive(item, "rx"), positive(item, "ry"), rotation(item, notes),
            Values.required(item.attribute("startangle"), "startangle", 0, 360), Values.required(item.attribute("endangle"), "endangle", 0, 360)));
        type = MapObjectContent.SHAPE;
        used = Set.of("cx", "cy", "rx", "ry", "rotation", "startangle", "endangle");
      }
      case ARCBAND -> {
        double minr = Values.required(item.attribute("minr"), "minr", 0, 2e7);
        double maxr = Values.required(item.attribute("maxr"), "maxr", 0, 2e7);
        if (!(minr < maxr)) {
          throw new Values.Bad("skipped: bad geometry", "minr is not below maxr");
        }
        geometry = new Geometry.ArcBand(Values.center(item), minr, maxr,
            Values.bearing(Values.required(item.attribute("startangle"), "startangle", 0, 360)),
            Values.bearing(Values.required(item.attribute("endangle"), "endangle", 0, 360)));
        type = MapObjectContent.SHAPE;
        used = Set.of("cx", "cy", "minr", "maxr", "startangle", "endangle");
      }
      default -> throw new IllegalStateException("unhandled kind " + item.kind());
    }
    if (item.kind() != Kind.POINT && item.kind() != Kind.TEXT && symbol.symbol() != null && objectSymbol == null && symbol.mapped()) {
      // A shape whose symbol the model cannot draw on it: kept, so that it goes out again.
      ext.put("symbol", JsonString.of(item.attribute("symbol")));
    }
    JsonObject.Builder others = JsonObject.builder();
    int otherCount = 0;
    for (Map.Entry<String, String> a : item.attributes().entrySet()) {
      if (!COMMON.contains(a.getKey()) && !used.contains(a.getKey())) {
        others.put(a.getKey(), JsonString.of(a.getValue()));
        otherCount++;
      }
    }
    if (otherCount > 0) {
      ext.put("attributes", others.build());
    }

    TimeAttributes time = time(item, notes);
    ObjectProperties properties = properties(item, notes);
    MapObjectContent content = new MapObjectContent(type, MapObjectContent.GENERAL, ctx.dataSource(), time, ctx.layerId(), geometry,
        objectSymbol, style, properties, label, Extensions.empty().with(NAMESPACE, ext.build()), List.of(), List.of(), text);
    return new Mapped(content, null, notes);
  }

  private static String graphicOrShape(Symbols.In symbol) {
    return symbol.mapped() && Symbols.isGraphic(symbol.symbol()) ? MapObjectContent.MULTIPOINT : MapObjectContent.SHAPE;
  }

  /**
   * An {@code ellipse}: {@code rx} and {@code ry} are the east-west and north-south semi-axes before
   * the counter-clockwise rotation. The larger is {@code semiMajor}; its bearing is (90 − rotation) mod
   * 180 when {@code rx >= ry}, else (360 − rotation) mod 180 (brief, section 3).
   */
  static Geometry.Ellipse ellipse(Item item) {
    double rx = positive(item, "rx");
    double ry = positive(item, "ry");
    double rotation = Values.required(item.attribute("rotation") == null ? "0" : item.attribute("rotation"), "rotation", 0, 360);
    double bearing = rx >= ry ? mod180(90 - rotation) : mod180(360 - rotation);
    return new Geometry.Ellipse(Values.center(item), Math.max(rx, ry), Math.min(rx, ry), bearing);
  }

  private static double mod180(double degrees) {
    double b = degrees % 180;
    return b < 0 ? b + 180 : b;
  }

  private static double positive(Item item, String name) {
    double value = Values.required(item.attribute(name), name, 0, 2e7);
    if (!(value > 0)) {
      throw new Values.Bad("skipped: bad geometry", name + " is not above 0");
    }
    return value;
  }

  private static double rotation(Item item, List<String> notes) {
    Double r = Values.optional(item.attribute("rotation"), "rotation", 0, 360, notes);
    return r == null ? 0 : r;
  }

  /** An area's holes; rings of other kinds than {@code linear-ring} are densified (brief, section 3). */
  private static List<List<Position>> holes(Item item) {
    List<List<Position>> holes = new ArrayList<>();
    for (Ring ring : item.excludes()) {
      Map<String, String> a = ring.attributes();
      switch (ring.element()) {
        case "linear-ring" -> {
          List<Position> points = Values.points(a.get("points"), 3);
          holes.add(Geo.closed("rhumb-line".equals(a.get("leg-type")) ? Geo.rhumb(Geo.closed(points)) : points));
        }
        case "circular-ring" -> {
          double r = ringPositive(a, "r");
          holes.add(Geo.ellipseRing(ringCenter(a), r, r, 0));
        }
        case "elliptic-ring" -> holes.add(Geo.ellipseRing(ringCenter(a), ringPositive(a, "rx"), ringPositive(a, "ry"), ringRotation(a)));
        case "rect-ring" -> holes.add(Geo.rectRing(ringCenter(a), ringPositive(a, "rx"), ringPositive(a, "ry"), ringRotation(a)));
        case "arcband-ring" -> holes.add(Geo.arcbandRing(ringCenter(a), Values.required(a.get("minr"), "minr", 0, 2e7), ringPositive(a, "maxr"),
            Values.required(a.get("startangle"), "startangle", 0, 360), Values.required(a.get("endangle"), "endangle", 0, 360)));
        default -> throw new Values.Bad("skipped: bad geometry", "an unknown ring: " + ring.element());
      }
    }
    return holes;
  }

  private static Position ringCenter(Map<String, String> a) {
    return Position.of(Values.required(a.get("cx"), "cx", -180, 180), Values.required(a.get("cy"), "cy", -90, 90));
  }

  private static double ringPositive(Map<String, String> a, String name) {
    double value = Values.required(a.get(name), name, 0, 2e7);
    if (!(value > 0)) {
      throw new Values.Bad("skipped: bad geometry", name + " is not above 0");
    }
    return value;
  }

  private static double ringRotation(Map<String, String> a) {
    return a.get("rotation") == null ? 0 : Values.required(a.get("rotation"), "rotation", 0, 360);
  }

  private static Style withArrowhead(@Nullable Style style) {
    Style s = style == null ? new Style(null, null, null, null, null, null) : style;
    return new Style(s.strokeColor(), s.strokeWidth(), s.strokeOpacity(), s.strokeDash(), s.fillColor(), s.fillOpacity(), s.fillPattern(),
        Style.Arrowhead.END, s.pointMarkers());
  }

  private static @Nullable TimeAttributes time(Item item, List<String> notes) {
    Instant observed = Values.time(item.timeStamp(), notes);
    Instant from = Values.time(item.timeBegin(), notes);
    Instant expires = Values.time(item.timeEnd(), notes);
    if (from != null && expires != null && from.isAfter(expires)) {
      notes.add("value out of range");
      from = null;
      expires = null;
    }
    TimeAttributes time = new TimeAttributes(observed, from, expires);
    return time.isEmpty() ? null : time;
  }

  private static @Nullable ObjectProperties properties(Item item, List<String> notes) {
    String name = item.attribute("label");
    String description = item.textInfo();
    if (name != null && name.length() > 256) {
      name = name.substring(0, 256);
      notes.add("value out of range");
    }
    if (description != null && description.length() > 4096) {
      description = description.substring(0, 4096);
      notes.add("value out of range");
    }
    ObjectProperties p = new ObjectProperties(name == null || name.isEmpty() ? null : name, description == null || description.isEmpty() ? null : description);
    return p.isEmpty() ? null : p;
  }

  private static void putString(JsonObject.Builder ext, String key, @Nullable String value) {
    if (value != null && !value.isEmpty()) {
      ext.put(key, JsonString.of(value));
    }
  }

  private static void putNumber(JsonObject.Builder ext, String key, @Nullable String value, List<String> notes) {
    Double d = Values.optional(value, key, -1e9, 1e9, notes);
    if (d != null) {
      ext.put(key, JsonNumber.of(d));
    }
  }
}
