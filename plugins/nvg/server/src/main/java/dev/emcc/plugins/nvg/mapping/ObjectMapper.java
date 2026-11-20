package dev.emcc.plugins.nvg.mapping;

import dev.emcc.plugins.nvg.codec.Item;
import dev.emcc.plugins.nvg.codec.Kind;
import dev.emcc.plugins.nvg.codec.Ring;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * One map object to an NVG item (brief, section 3, "Out", and "Everything in a layer is written
 * out"): {@code core.symbol} as {@code point}, {@code core.multipoint} with its graphic's code,
 * {@code core.text} as {@code text}, and {@code core.shape} and any other type by its geometry. What
 * {@code extensions.nvg} kept from an import goes back as it came.
 */
public final class ObjectMapper {

  /** The elements that may carry {@code minaltitude} and {@code maxaltitude}. */
  private static final Set<Kind> ALTITUDES = Set.of(Kind.POLYGON, Kind.CIRCLE, Kind.ELLIPSE, Kind.RECT, Kind.ARCBAND, Kind.CORRIDOR, Kind.ORBIT);

  private ObjectMapper() {}

  /**
   * The item's {@code uri}: the {@code externalRef} id of an object that came from NVG, else {@code
   * urn:uuid:<object id>}, so it stays the same across documents (ADR-0055 point 2).
   */
  public static String uri(MapObject object) {
    var ref = object.meta().externalRef();
    if (ref != null && object.content().extensions().get(ItemMapper.NAMESPACE) != null) {
      return ref.id();
    }
    return "urn:uuid:" + object.id();
  }

  public static Item toItem(MapObject object) {
    MapObjectContent c = object.content();
    JsonObject ext = c.extensions().get(ItemMapper.NAMESPACE);
    String keptElement = string(ext, "element");
    String keptSymbol = string(ext, "symbol");
    Item.Builder b;
    Kind kind;
    switch (c.type()) {
      case MapObjectContent.SYMBOL -> {
        Position p = point(c.geometry());
        kind = Kind.POINT;
        b = Item.builder(kind, uri(object)).attribute("x", Values.coordinate(p.longitude())).attribute("y", Values.coordinate(p.latitude()));
        Symbol s = c.symbol();
        if (s != null) {
          b.attribute("symbol", Symbols.write(s, keptSymbol));
          Modifiers m = s.modifiers();
          if (m != null && m.speed() != null) {
            b.attribute("speed", Values.number(m.speed() * 3.6));
          }
          if (m != null && m.direction() != null) {
            b.attribute("course", Values.number(m.direction()));
          }
        }
      }
      case MapObjectContent.TEXT -> {
        Position p = point(c.geometry());
        kind = Kind.TEXT;
        b = Item.builder(kind, uri(object)).attribute("x", Values.coordinate(p.longitude())).attribute("y", Values.coordinate(p.latitude()));
        if (c.text() != null) {
          b.content(c.text().value());
          Double clockwise = c.text().rotation();
          if (clockwise != null && clockwise != 0) {
            b.attribute("rotation", Values.number(Values.bearing(360 - clockwise)));
          }
        }
      }
      default -> {
        kind = kindOf(c, keptElement);
        b = geometry(Item.builder(kind, uri(object)), kind, c.geometry(), number(ext, "width"));
        if (c.symbol() != null) {
          b.attribute("symbol", Symbols.write(c.symbol(), keptSymbol));
        } else if (keptSymbol != null) {
          b.attribute("symbol", keptSymbol);
        } else if (kind == Kind.POINT) {
          b.attribute("symbol", Symbols.NVG_UNKNOWN);
        }
      }
    }
    if (c.properties() != null) {
      if (c.properties().name() != null) {
        b.attribute("label", c.properties().name());
      }
      b.textInfo(c.properties().description());
    }
    b.attribute("style", kind == Kind.TEXT
        ? Css.writeText(c.style(), string(ext, "style"))
        : Css.write(c.style(), string(ext, "style")));
    b.attribute("href", string(ext, "href"));
    if (kind != Kind.TEXT) {
      b.attribute("modifiers", string(ext, "modifiers"));
    }
    if (kind == Kind.POINT) {
      putNumber(b, "z", ext);
    }
    if (ALTITUDES.contains(kind)) {
      putNumber(b, "minaltitude", ext);
      putNumber(b, "maxaltitude", ext);
    }
    if (ext != null && kind.element().equals(keptElement) && ext.get("attributes") instanceof JsonObject others) {
      for (Map.Entry<String, JsonValue> a : others.members().entrySet()) {
        if (a.getValue() instanceof JsonString s) {
          b.attribute(a.getKey(), s.value());
        }
      }
    }
    if (c.time() != null) {
      b.timeStamp(c.time().observed() == null ? null : c.time().observed().toString());
      b.timeSpan(c.time().validFrom() == null ? null : c.time().validFrom().toString(), c.time().expires() == null ? null : c.time().expires().toString());
    }
    b.label(c.label());
    b.extendedData(string(ext, "extendedData"));
    String extension = string(ext, "extension");
    String foreign = string(ext, "foreign");
    b.extension(extension == null ? foreign : foreign == null ? extension : extension + foreign);
    return b.build();
  }

  /** The element of a shape or a graphic, by its geometry; a line that came as an {@code arrow} or has an arrowhead is an {@code arrow}. */
  private static Kind kindOf(MapObjectContent c, @Nullable String keptElement) {
    return switch (c.geometry()) {
      case Geometry.Point p -> Kind.POINT;
      case Geometry.MultiPoint m -> Kind.MULTIPOINT;
      case Geometry.LineString l -> {
        boolean arrowhead = c.style() != null && c.style().arrowhead() == Style.Arrowhead.END;
        boolean cameAsArrow = "arrow".equals(keptElement) && c.type().equals(MapObjectContent.MULTIPOINT);
        yield arrowhead || cameAsArrow ? Kind.ARROW : Kind.POLYLINE;
      }
      case Geometry.Polygon p -> Kind.POLYGON;
      case Geometry.Circle ci -> Kind.CIRCLE;
      case Geometry.Ellipse e -> Kind.ELLIPSE;
      case Geometry.Corridor co -> Kind.CORRIDOR;
      case Geometry.ArcBand a -> Kind.ARCBAND;
    };
  }

  private static Item.Builder geometry(Item.Builder b, Kind kind, Geometry g, @Nullable Double width) {
    switch (g) {
      case Geometry.Point p -> b.attribute("x", Values.coordinate(p.coordinates().longitude())).attribute("y", Values.coordinate(p.coordinates().latitude()));
      case Geometry.MultiPoint m -> b.attribute("points", Values.points(m.coordinates()));
      case Geometry.LineString l -> {
        b.attribute("points", Values.points(l.coordinates()));
        if (kind == Kind.ARROW) {
          b.attribute("width", Values.number(width == null ? 0 : width));
        }
      }
      case Geometry.Polygon p -> {
        b.attribute("points", Values.points(Geo.open(p.rings().getFirst())));
        for (List<Position> hole : p.rings().subList(1, p.rings().size())) {
          b.exclude(new Ring("linear-ring", Map.of("points", Values.points(Geo.open(hole)))));
        }
      }
      case Geometry.Circle c -> center(b, c.center()).attribute("r", Values.number(c.radius()));
      case Geometry.Ellipse e -> center(b, e.center())
          .attribute("rx", Values.number(e.semiMajorAxis()))
          .attribute("ry", Values.number(e.semiMinorAxis()))
          .attribute("rotation", Values.number(Values.bearing(90 - e.rotation())));
      case Geometry.Corridor co -> b.attribute("points", Values.points(co.coordinates())).attribute("width", Values.number(co.width()));
      case Geometry.ArcBand a -> center(b, a.center())
          .attribute("minr", Values.number(a.innerRadius()))
          .attribute("maxr", Values.number(a.outerRadius()))
          .attribute("startangle", Values.number(a.startBearing()))
          .attribute("endangle", Values.number(a.endBearing()));
    }
    return b;
  }

  private static Item.Builder center(Item.Builder b, Position c) {
    return b.attribute("cx", Values.coordinate(c.longitude())).attribute("cy", Values.coordinate(c.latitude()));
  }

  private static Position point(Geometry g) {
    if (g instanceof Geometry.Point p) {
      return p.coordinates();
    }
    throw new IllegalArgumentException("not a Point: " + g.typeName());
  }

  private static void putNumber(Item.Builder b, String name, @Nullable JsonObject ext) {
    Double d = number(ext, name);
    if (d != null) {
      b.attribute(name, Values.number(d));
    }
  }

  private static @Nullable String string(@Nullable JsonObject ext, String key) {
    return ext != null && ext.get(key) instanceof JsonString s ? s.value() : null;
  }

  private static @Nullable Double number(@Nullable JsonObject ext, String key) {
    return ext != null && ext.get(key) instanceof JsonNumber n ? n.doubleValue() : null;
  }
}
