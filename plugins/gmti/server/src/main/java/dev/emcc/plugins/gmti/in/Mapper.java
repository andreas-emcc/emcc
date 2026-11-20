package dev.emcc.plugins.gmti.in;

import dev.emcc.plugins.gmti.format.JobDefinition;
import dev.emcc.plugins.gmti.format.Mission;
import dev.emcc.plugins.gmti.format.PacketHeader;
import dev.emcc.plugins.gmti.format.TargetReport;
import dev.emcc.plugins.gmti.in.Receiver.AreaFix;
import dev.emcc.plugins.gmti.in.Receiver.CoverageFix;
import dev.emcc.plugins.gmti.in.Receiver.DetectionFix;
import dev.emcc.plugins.gmti.in.Receiver.PlatformFix;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.DisplayClass;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Maps what a {@link Receiver} makes to map objects (brief section 3). Pure: no store, no clock.
 * Positions are {@code [longitude, latitude, altitude]}; only the extension {@code gmti} is written.
 *
 * <ul>
 *   <li>the <b>platform</b>: a {@code core.symbol} of data type {@code gmti.platform}, named {@code P8};
 *   <li>its <b>dwell area</b>: a {@code core.shape} of data type {@code gmti.dwell-area} (from M7 RC2,
 *       T-192; before, {@code gmti.platform}), which fades in steps by {@code dwellAreaFade}, a solid outline of
 *       {@value #AREA_WIDTH} px (owner QL C, 2026-11-11) in the colour of {@code dwellAreaColour}, by
 *       default the identity's, no fill, with the display class {@code dwell-area} (SDK 1.6.0, T-182);
 *   <li>its <b>coverage</b> (T-158): a {@code core.shape} of data type {@code gmti.platform}, the job's bounding
 *       area as a dashed outline of {@value #COVERAGE_WIDTH} px in the colour of {@code coverageColour},
 *       by default the identity's, no fill, with the display class {@code sensor-coverage};
 *   <li>each <b>detection</b>: a {@code core.symbol} of data type {@code gmti.detection}, its symbol by
 *       class, with the field set {@code gmti.report}; never updated. It fades in steps by {@code
 *       detectionFade}, which the map view draws (T-192). Platforms and detections have no
 *       display class.
 * </ul>
 *
 * An update keeps the stored object's layer, style and relations (ADR-0051 point 3).
 */
public final class Mapper {

  /** The plugin's id: its extension namespace and the external system of its objects. */
  public static final String NAMESPACE = "gmti";
  public static final String DETECTION = "gmti.detection";
  public static final String PLATFORM = "gmti.platform";
  /**
   * The dwell areas' data type (M7 RC2, T-192; CR-0042 option A), so that they fade in steps by
   * {@code dwellAreaFade}, apart from the platform and its coverage; from M8 (T-195) it also removes
   * them, at its expiry.
   */
  public static final String DWELL_AREA = "gmti.dwell-area";
  public static final String FIELD_SET = "gmti.report";
  public static final String PAIRING = "gmti.pairing";

  /** A name for a platform whose {@code P8} is all spaces. */
  static final String NO_PLATFORM_ID = "GMTI platform";

  /** The dwell area's line, in screen pixels: 2 px from M7 (owner QL C, 2026-11-11; 3 px in M5 and M6). */
  public static final double AREA_WIDTH = 2.0;
  /** The coverage's dashed line, in screen pixels (T-158; brief, Q26 A and Q27 A). */
  public static final double COVERAGE_WIDTH = 1.5;

  private Mapper() {}

  /**
   * Where a link's objects go and how they are marked.
   *
   * @param link the link's name: the data source and the start of every external id
   * @param layerId the link's layer, for creates
   * @param label the packet's label ({@link LabelRule})
   * @param identity the link's {@code platformIdentity}
   * @param platformSymbol the link's {@code platformSymbol}, or {@code null} for the default from {@code M3}
   * @param colours the outlines' colours, the plugin's settings (T-181, T-185)
   */
  public record Placement(String link, UUID layerId, SecurityLabel label, StandardIdentity identity, @Nullable String platformSymbol,
      Colours colours) {
    public Placement {
      Objects.requireNonNull(link, "link");
      Objects.requireNonNull(layerId, "layerId");
      Objects.requireNonNull(label, "label");
      Objects.requireNonNull(identity, "identity");
      Objects.requireNonNull(colours, "colours");
    }

    /** With the outlines' default colours (from M8 fixed, T-189). */
    public Placement(String link, UUID layerId, SecurityLabel label, StandardIdentity identity, @Nullable String platformSymbol) {
      this(link, layerId, label, identity, platformSymbol, Colours.DEFAULTS);
    }
  }

  /** The platform's external id: {@code <link>/<P8>}. */
  public static String platformId(String link, String platformId) {
    return link + "/" + platformId;
  }

  /**
   * A dwell area's external id (M8, T-195): {@code <link>/<P8>/area/<dwell time, UTC ms>/<D2>/<D3>}, one
   * per dwell. (M6 and M7 had {@code <link>/<P8>/area} for dwell 0 and {@code .../area/<D3>} for the others.)
   */
  public static String areaId(String link, AreaFix fix) {
    return link + "/" + fix.platformId() + "/area/" + fix.dwellTime() + "/" + fix.revisitIndex() + "/" + fix.dwellIndex();
  }

  /** The coverage's external id: {@code <link>/<P8>/coverage} (T-158). */
  public static String coverageId(String link, String platformId) {
    return link + "/" + platformId + "/coverage";
  }

  /** A detection's external id: {@code <link>/<the fix's key>}. */
  public static String detectionId(String link, DetectionFix fix) {
    return link + "/" + fix.key();
  }

  // ------------------------------------------------------------------- platform

  public static MapObjectContent platform(Placement p, PlatformFix f, @Nullable MapObject stored) {
    PacketHeader h = f.header();
    int context = Symbols.context(h.exercise());
    String name = f.platformId().isEmpty() ? NO_PLATFORM_ID : f.platformId();
    Modifiers.Builder modifiers = Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, name);
    if (f.direction() != null) {
      modifiers.direction(f.direction());
    }
    if (f.speed() != null && f.speed() >= 0) {
      modifiers.speed(f.speed());
    }
    Mission m = f.mission();
    var symbol = new Symbol(SymbolStandard.APP_6D, Symbols.platform(context, p.identity(), p.platformSymbol(), m.platformType()), modifiers.build());

    JsonObject old = stored == null ? null : stored.content().extensions().get(NAMESPACE);
    var ext = JsonObject.builder();
    ext.put("platformId", JsonString.of(f.platformId()));
    ext.put("nationality", JsonString.of(h.nationality()));
    ext.put("missionId", JsonNumber.of(h.missionId()));
    ext.put("codeWords", JsonNumber.of(h.securityCode()));
    ext.put("exercise", JsonNumber.of(h.exercise()));
    ext.put("version", JsonString.of(h.version()));
    ext.put("platformType", JsonNumber.of(m.platformType()));
    putText(ext, "missionPlan", m.missionPlan());
    putText(ext, "flightPlan", m.flightPlan());
    putText(ext, "platformConfiguration", m.platformConfiguration());
    if (h.jobId() != 0) {
      ext.put("jobId", JsonNumber.of(h.jobId()));
    } else if (old != null && old.get("jobId") != null) {
      ext.put("jobId", old.get("jobId"));
    }
    JsonValue job = f.job() != null ? job(f.job()) : old == null ? null : old.get("job");
    if (job != null) {
      ext.put("job", job);
    }
    var content = new MapObjectContent(
        MapObjectContent.SYMBOL, PLATFORM, p.link(), new TimeAttributes(f.time(), null, null), layer(p, stored),
        new Geometry.Point(f.position()), symbol, stored == null ? null : stored.content().style(), new ObjectProperties(name, null), p.label(),
        extensions(stored, ext.build()));
    return content.withRelations(relations(stored));
  }

  /** The job definition as the platform's description (brief section 3): metres, m/s, seconds; "no statement" left out. */
  static JsonObject job(JobDefinition j) {
    var o = JsonObject.builder();
    o.put("sensorType", JsonNumber.of(j.sensorType()));
    putText(o, "sensorModel", j.sensorModel());
    o.put("radarMode", JsonNumber.of(j.radarMode()));
    o.put("priority", JsonNumber.of(j.priority()));
    var corners = new ArrayList<JsonValue>();
    for (Position c : j.boundingArea()) {
      corners.add(JsonArray.of(JsonNumber.of(c.longitude()), JsonNumber.of(c.latitude())));
    }
    o.put("boundingArea", new JsonArray(corners));
    o.put("revisitInterval", JsonNumber.of(j.revisitInterval() / 10.0));
    stated16(o, "alongTrackError", j.alongTrackError(), 10);
    stated16(o, "crossTrackError", j.crossTrackError(), 10);
    stated16(o, "altitudeError", j.altitudeError(), 10);
    if (j.trackError() != JobDefinition.NONE_8) {
      o.put("trackError", JsonNumber.of(j.trackError()));
    }
    stated16(o, "speedError", j.speedError(), 1_000);
    stated16(o, "slantRangeError", j.slantRangeError(), 100);
    if (j.crossRangeError() != JobDefinition.NO_CROSS_RANGE_ERROR) {
      o.put("crossRangeError", JsonNumber.of(j.crossRangeError()));
    }
    stated16(o, "radialVelocityError", j.radialVelocityError(), 100);
    if (j.minimumDetectableVelocity() != JobDefinition.NONE_8) {
      o.put("minimumDetectableVelocity", JsonNumber.of(j.minimumDetectableVelocity() / 10.0));
    }
    if (j.detectionProbability() != JobDefinition.NONE_8) {
      o.put("detectionProbability", JsonNumber.of(j.detectionProbability()));
    }
    if (j.falseAlarmDensity() != JobDefinition.NONE_8) {
      o.put("falseAlarmDensity", JsonNumber.of(j.falseAlarmDensity()));
    }
    o.put("terrainModel", JsonNumber.of(j.terrainModel()));
    o.put("geoidModel", JsonNumber.of(j.geoidModel()));
    return o.build();
  }

  // ------------------------------------------------------------------- area

  /**
   * One dwell's area (M8, T-195): written once, so {@code stored} is {@code null} from M8. It has no
   * name (owner, 2026-11-13): a name is a map label, and a sensor leaves many areas.
   */
  public static MapObjectContent area(Placement p, AreaFix f, @Nullable MapObject stored) {
    Geometry area = f.area();
    var ext = JsonObject.builder()
        .put("platformId", JsonString.of(f.platformId()))
        .put("jobId", JsonNumber.of(f.jobId()))
        .put("revisitIndex", JsonNumber.of(f.revisitIndex()))
        .put("dwellIndex", JsonNumber.of(f.dwellIndex()))
        .build();
    var style = new Style(p.colours().dwellArea().of(p.identity()), AREA_WIDTH, null, null, null, 0.0);
    var content = new MapObjectContent(
        MapObjectContent.SHAPE, DWELL_AREA, p.link(), new TimeAttributes(f.time(), null, null), layer(p, stored), area, null, style,
        null, p.label(), extensions(stored, ext));
    return content.withRelations(relations(stored)).withDisplayClass(DisplayClass.DWELL_AREA);
  }

  // ------------------------------------------------------------------- coverage

  /**
   * The coverage's content (T-158; brief section 3, "The coverage"): the job's bounding area as a
   * {@code Polygon}, dashed, no fill; {@code f.coverage()} must not be {@code null} (a coverage that
   * encloses no area is not written).
   */
  public static MapObjectContent coverage(Placement p, CoverageFix f, @Nullable MapObject stored) {
    Geometry.Polygon shape = Objects.requireNonNull(f.coverage(), "a coverage without an area is not written");
    var ext = JsonObject.builder()
        .put("platformId", JsonString.of(f.platformId()))
        .put("jobId", JsonNumber.of(f.jobId()))
        .build();
    String name = (f.platformId().isEmpty() ? NO_PLATFORM_ID : f.platformId()) + " coverage";
    var style = new Style(p.colours().coverage().of(p.identity()), COVERAGE_WIDTH, null, Style.Dash.DASH, null, 0.0);
    var content = new MapObjectContent(
        MapObjectContent.SHAPE, PLATFORM, p.link(), new TimeAttributes(f.time(), null, null), layer(p, stored), shape, null, style,
        new ObjectProperties(name, null), p.label(), extensions(stored, ext));
    return content.withRelations(relations(stored)).withDisplayClass(DisplayClass.SENSOR_COVERAGE);
  }

  // ------------------------------------------------------------------- detection

  /** A detection without its pairing; see {@link #detection(Placement, DetectionFix, UUID)}. */
  public static MapObjectContent detection(Placement p, DetectionFix f) {
    return detection(p, f, null);
  }

  /**
   * A detection: its own object, never updated; the field set {@code gmti.report} listed in its
   * content, and one relation {@code gmti.pairing} to its platform's object (brief section 3;
   * ADR-0051 point 8), which ends with the detection's expiry.
   *
   * @param platform the platform object's id ({@code ObjectWriter.objectId}), or {@code null} for no pairing
   */
  public static MapObjectContent detection(Placement p, DetectionFix f, @Nullable UUID platform) {
    TargetReport r = f.report();
    int context = Symbols.context(f.header().exercise());
    var symbol = new Symbol(SymbolStandard.APP_6D, Symbols.detection(context, r.classification()), null);
    Position at = r.height() != null ? Position.of(r.longitude(), r.latitude(), r.height()) : Position.of(r.longitude(), r.latitude());
    JobDefinition job = f.job();
    var ext = JsonObject.builder();
    putNumber(ext, "radialVelocity", r.radialVelocity());
    putNumber(ext, "wrapVelocity", r.wrapVelocity());
    putNumber(ext, "snr", r.snr() == null ? null : r.snr().doubleValue());
    if (r.classification() != null) {
      ext.put("classification", JsonString.of(Classes.name(r.classification(), f.header().version())));
    }
    putNumber(ext, "classProbability", r.classificationProbability() == null ? null : r.classificationProbability().doubleValue());
    Double slant = r.slantRangeError();
    if (slant == null && job != null && job.slantRangeError() != JobDefinition.NONE_16) {
      slant = job.slantRangeError() / 100.0; // a detection without its own errors gets the job's (brief section 3)
    }
    putNumber(ext, "slantRangeError", slant);
    putNumber(ext, "crossRangeError", r.crossRangeError());
    putNumber(ext, "heightError", r.heightError() == null ? null : r.heightError().doubleValue());
    Double radialError = r.radialVelocityError();
    if (radialError == null && job != null && job.radialVelocityError() != JobDefinition.NONE_16) {
      radialError = job.radialVelocityError() / 100.0;
    }
    putNumber(ext, "radialVelocityError", radialError);
    putNumber(ext, "rcs", r.rcs());
    if (r.truthApplication() != null || r.truthEntity() != null) {
      ext.put("truthTag", JsonString.of(r.truthApplication() + "/" + r.truthEntity()));
    }
    ext.put("jobId", JsonNumber.of(f.header().jobId()));
    ext.put("revisitIndex", JsonNumber.of(f.dwell().revisitIndex()));
    ext.put("dwellIndex", JsonNumber.of(f.dwell().dwellIndex()));
    if (r.index() != null) {
      ext.put("reportIndex", JsonNumber.of(r.index()));
    }
    ext.put("platformId", JsonString.of(f.platformId()));
    var content = new MapObjectContent(
        MapObjectContent.SYMBOL, DETECTION, p.link(), new TimeAttributes(f.time(), null, null), p.layerId(), new Geometry.Point(at), symbol,
        null, null, p.label(), Extensions.empty().with(NAMESPACE, ext.build()));
    content = content.withFieldSet(FIELD_SET);
    return platform == null ? content : content.withRelations(List.of(new Relation(PAIRING, platform)));
  }

  // ------------------------------------------------------------------- helpers

  private static UUID layer(Placement p, @Nullable MapObject stored) {
    return stored != null ? stored.content().layerId() : p.layerId();
  }

  private static List<Relation> relations(@Nullable MapObject stored) {
    return stored != null ? stored.content().relations() : List.of();
  }

  /** The stored object's other namespaces forwarded untouched (ADR-0007), {@code gmti}'s replaced. */
  private static Extensions extensions(@Nullable MapObject stored, JsonObject own) {
    Extensions base = stored != null ? stored.content().extensions() : Extensions.empty();
    return base.with(NAMESPACE, own);
  }

  private static void putText(JsonObject.Builder o, String name, String value) {
    if (!value.isEmpty()) {
      o.put(name, JsonString.of(value));
    }
  }

  private static void putNumber(JsonObject.Builder o, String name, @Nullable Double value) {
    if (value != null) {
      o.put(name, JsonNumber.of(value));
    }
  }

  private static void stated16(JsonObject.Builder o, String name, int value, double divisor) {
    if (value != JobDefinition.NONE_16) {
      o.put(name, JsonNumber.of(value / divisor));
    }
  }
}
