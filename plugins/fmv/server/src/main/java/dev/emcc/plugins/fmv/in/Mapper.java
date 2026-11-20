package dev.emcc.plugins.fmv.in;

import dev.emcc.plugins.fmv.klv.Metadata;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Maps one ST 0601 set to the camera and its field of view (brief section 3, ADR-0057 point 3). Pure:
 * no store, no clock. Positions are longitude first. Only the extension {@code fmv} is written, on the
 * camera; the arc has none.
 */
public final class Mapper {

  /** The plugin's id: its extension namespace and the external system of its objects. */
  public static final String NAMESPACE = "fmv";
  public static final String CAMERA = "fmv.camera";
  /** The arc's data type. The brief says {@code fmv.fieldOfView}, which the model refuses (type names are lowercase words joined by hyphens): the same as gmti's {@code gmti.dwell-area} (owner, 2026-11-12). */
  public static final String FIELD_OF_VIEW = "fmv.field-of-view";
  public static final String FIELD_SET = "fmv.camera";
  public static final String VIEW = "fmv.view";

  /** The arc's line, in screen pixels (brief section 3). */
  public static final double ARC_WIDTH = 2.0;

  /** The least width of the arc: a width of 0 would make its two bearings equal, which is a full ring. */
  static final double MIN_WIDTH = 0.01;

  private Mapper() {}

  /** Which clock {@code time.observed} follows (F4). */
  public enum TimeSource {
    RECEIVED, STREAM;

    public static TimeSource fromJson(String value) {
      return "stream".equals(value) ? STREAM : RECEIVED;
    }
  }

  /**
   * Where a link's objects go and how they are marked.
   *
   * @param dataSource the data source of a new object: lowercase words joined by hyphens (the model's rule), the link's name as a key; a stored object keeps its own
   * @param linkName the name an admin gave the link: the last fallback for the objects' names
   * @param label the set's label ({@link LabelRule})
   * @param identity the link's {@code cameraIdentity}
   * @param cameraSymbol the link's {@code cameraSymbol}, a 20-digit APP-6D code
   * @param fovColour the arc's line, {@code #RRGGBB}
   * @param time which clock {@code time.observed} follows
   */
  public record Placement(String dataSource, String linkName, SecurityLabel label, StandardIdentity identity, String cameraSymbol, String fovColour, TimeSource time) {
    public Placement {
      Objects.requireNonNull(dataSource, "dataSource");
      Objects.requireNonNull(linkName, "linkName");
      Objects.requireNonNull(label, "label");
      Objects.requireNonNull(identity, "identity");
      Objects.requireNonNull(cameraSymbol, "cameraSymbol");
      Objects.requireNonNull(fovColour, "fovColour");
      Objects.requireNonNull(time, "time");
    }
  }

  /** The default camera symbol: air, military unmanned aircraft, photographic reconnaissance (owner, 2026-11-14). */
  public static final String DEFAULT_CAMERA_SYMBOL = "10030100001103002000";

  /** The arc: from where, which way, how far and how wide. */
  public record Arc(Position center, double bearing, double length, double width) {

    /** The start of the arc, clockwise to {@link #end()}: a bearing in 0 inclusive to 360 exclusive. */
    public double start() {
      return normal(bearing - width / 2);
    }

    public double end() {
      return normal(bearing + width / 2);
    }

    /**
     * The arc a set gives, or {@code null} when it gives none: it needs the sensor's position, a width
     * (tag 16), a direction and a length above 0. The direction and length are the bearing and ground
     * distance to the frame centre when the set has it (tags 23 and 24; S9: tag 18 was the true
     * bearing there), else heading plus relative azimuth (tags 5 and 18) and the slant range (tag 21).
     */
    public static @Nullable Arc of(Metadata m) {
      if (!m.hasSensorPosition() || m.horizontalFov() == null) {
        return null;
      }
      var center = new Position(m.sensorLongitude(), m.sensorLatitude(), null);
      double bearing = Double.NaN;
      double length = Double.NaN;
      if (m.hasFrameCenter()) {
        GeodesicLeg leg = Geodesy.inverse(center, new Position(m.frameCenterLongitude(), m.frameCenterLatitude(), null));
        if (leg.distanceMetres() > 0) {
          bearing = normal(leg.initialAzimuth());
          length = leg.distanceMetres();
        }
      }
      if (Double.isNaN(bearing) && m.heading() != null && m.relativeAzimuth() != null && m.slantRange() != null && m.slantRange() > 0) {
        bearing = normal(m.heading() + m.relativeAzimuth());
        length = m.slantRange();
      }
      if (Double.isNaN(bearing)) {
        return null;
      }
      return new Arc(center, bearing, length, Math.max(MIN_WIDTH, Math.min(m.horizontalFov(), 359.99)));
    }
  }

  /** A bearing in 0 inclusive to 360 exclusive. */
  static double normal(double degrees) {
    double d = degrees % 360;
    if (d < 0) {
      d += 360;
    }
    return d >= 360 ? 0 : d;
  }

  /** {@code time.observed}: the set's own time (tag 2) when asked for and present, else when it arrived. */
  public static Instant time(Placement p, Metadata m, Instant received) {
    if (p.time() == TimeSource.STREAM && m.timeMicros() != null) {
      long micros = m.timeMicros();
      return Instant.ofEpochSecond(Math.floorDiv(micros, 1_000_000L), Math.floorMod(micros, 1_000_000L) * 1000);
    }
    return received;
  }

  /** The name of both objects: tag 10, else tag 3, else the link's name. */
  public static String name(Placement p, Metadata m) {
    if (m.platformDesignation() != null) {
      return m.platformDesignation();
    }
    if (m.missionId() != null) {
      return m.missionId();
    }
    return p.linkName();
  }

  /** The camera's external id and the arc's: {@code {fmv, <link>/camera}} and {@code {fmv, <link>/fov}}. */
  public static String cameraId(String link) {
    return link + "/camera";
  }

  public static String fovId(String link) {
    return link + "/fov";
  }

  /**
   * The camera's content, or {@code null} when the set has no sensor position (nothing is written and the
   * camera keeps its last state).
   *
   * @param videoFormat the stream's format as the panel names it, or {@code null} before it is known
   * @param stored the camera as last stored, or {@code null}; its layer stays, and what this set does not
   *     carry stays as it was
   */
  public static @Nullable MapObjectContent camera(
      Placement p, Metadata m, Instant received, @Nullable String videoFormat, @Nullable MapObject stored, UUID layerId) {
    if (!m.hasSensorPosition()) {
      return null;
    }
    String name = name(p, m);
    Modifiers.Builder modifiers = Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, name);
    if (m.heading() != null) {
      modifiers.direction(normal(m.heading()));
    }
    var symbol = new Symbol(SymbolStandard.APP_6D, sidc(p), modifiers.build());
    var content = new MapObjectContent(
        MapObjectContent.SYMBOL, CAMERA, dataSource(p, stored), new TimeAttributes(time(p, m, received), null, null), stored != null ? stored.content().layerId() : layerId,
        new Geometry.Point(new Position(m.sensorLongitude(), m.sensorLatitude(), null)), symbol, stored == null ? null : stored.content().style(),
        new ObjectProperties(name, null), p.label(), extensions(stored, own(p, m, received, videoFormat, stored)));
    return stored == null ? content : content.withRelations(stored.content().relations());
  }

  /**
   * The arc's content, or {@code null} when the set gives none ({@link Arc#of}).
   *
   * @param camera the camera's object id, for the relation
   */
  public static @Nullable MapObjectContent fieldOfView(
      Placement p, Metadata m, Instant received, UUID camera, @Nullable MapObject stored, UUID layerId) {
    Arc arc = Arc.of(m);
    if (arc == null) {
      return null;
    }
    var geometry = new Geometry.ArcBand(arc.center(), 0, arc.length(), arc.start(), arc.end());
    var style = new Style(p.fovColour(), ARC_WIDTH, null, null, null, 0.0);
    var content = new MapObjectContent(
        MapObjectContent.SHAPE, FIELD_OF_VIEW, dataSource(p, stored), new TimeAttributes(time(p, m, received), null, null),
        stored != null ? stored.content().layerId() : layerId, geometry, null, style, new ObjectProperties(name(p, m) + " field of view", null),
        p.label(), stored == null ? Extensions.empty() : stored.content().extensions());
    return content.withRelations(List.of(new Relation(VIEW, camera)));
  }

  /** An object's data source is fixed when it is made (model rule 14): a stored object's stays, whatever the link is called now. */
  private static String dataSource(Placement p, @Nullable MapObject stored) {
    return stored != null ? stored.content().dataSource() : p.dataSource();
  }

  /** The camera's APP-6D code: the link's, with the reality context and the link's standard identity. */
  static String sidc(Placement p) {
    String s = p.cameraSymbol();
    return s.substring(0, 2) + "0" + p.identity().digit() + s.substring(4);
  }

  /** The extension {@code fmv}: what this set carries, over what was stored (a sparse feed keeps the last values). */
  private static JsonObject own(Placement p, Metadata m, Instant received, @Nullable String videoFormat, @Nullable MapObject stored) {
    JsonObject old = stored == null ? null : stored.content().extensions().get(NAMESPACE);
    var o = JsonObject.builder();
    o.put("link", JsonString.of(p.linkName()));
    text(o, old, "mission", m.missionId());
    text(o, old, "platformDesignation", m.platformDesignation());
    text(o, old, "imageSourceSensor", m.imageSourceSensor());
    number(o, old, "sensorAltitude", m.sensorAltitude());
    number(o, old, "verticalFov", m.verticalFov());
    number(o, old, "relativeAzimuth", m.relativeAzimuth());
    number(o, old, "relativeElevation", m.relativeElevation());
    number(o, old, "slantRange", m.slantRange());
    number(o, old, "frameCenterLatitude", m.frameCenterLatitude());
    number(o, old, "frameCenterLongitude", m.frameCenterLongitude());
    number(o, old, "frameCenterElevation", m.frameCenterElevation());
    text(o, old, "videoFormat", videoFormat);
    Metadata.Security s = m.security();
    text(o, old, "classifyingCountry", s == null ? null : s.country());
    text(o, old, "releasingInstructions", s == null ? null : s.releasing());
    if (m.version() != null) {
      o.put("version", JsonNumber.of(m.version().intValue()));
    } else if (old != null && old.get("version") instanceof JsonNumber kept) {
      o.put("version", kept);
    }
    o.put("lastSet", JsonString.of(received.toString()));
    return o.build();
  }

  private static void text(JsonObject.Builder o, @Nullable JsonObject old, String name, @Nullable String value) {
    if (value != null) {
      o.put(name, JsonString.of(value));
    } else if (old != null && old.get(name) instanceof JsonString kept) {
      o.put(name, kept);
    }
  }

  private static void number(JsonObject.Builder o, @Nullable JsonObject old, String name, @Nullable Double value) {
    if (value != null) {
      o.put(name, JsonNumber.of(value));
    } else if (old != null) {
      JsonValue kept = old.get(name);
      if (kept instanceof JsonNumber) {
        o.put(name, kept);
      }
    }
  }

  /** The stored object's other namespaces forwarded untouched (ADR-0007), {@code fmv}'s replaced. */
  private static Extensions extensions(@Nullable MapObject stored, JsonObject own) {
    Extensions base = stored != null ? stored.content().extensions() : Extensions.empty();
    return base.with(NAMESPACE, own);
  }
}
