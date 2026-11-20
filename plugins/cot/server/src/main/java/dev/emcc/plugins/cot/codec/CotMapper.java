package dev.emcc.plugins.cot.codec;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * The mapping between a CoT event and the content of a map object (brief function 4; interop note
 * section 7). It is pure: the same event and placement always give the same content.
 *
 * <p>An event becomes a {@code core.symbol} with a point, an APP-6B symbol, a name and a
 * description, direction and speed, and time attributes. The callsign is the object's name and
 * also the symbol's {@code uniqueDesignation}, the text drawn next to it (owner, 2026-10-12). <b>Everything CoT has that the core has
 * no field for</b> stays in the plugin's own extension {@code cot}, so that the event can be
 * rebuilt: {@code type}, {@code how}, {@code version}, {@code access}, {@code qos}, {@code
 * opex}, {@code caveat}, {@code releasableTo}, {@code ce}, {@code le}, and {@code detail}: the
 * whole content of {@code <detail>} as XML text, unchanged. (It includes {@code contact}, {@code
 * remarks} and {@code track}, which also have core fields: they carry attributes such as {@code
 * endpoint} that have none.) No other namespace is written.
 *
 * <p>The way back, {@link #encode}, gives the CoT event for a symbol with a point (brief function
 * 17). An object that came from CoT and has not been changed gives the same event, apart from
 * {@code time}, {@code start} and {@code stale}.
 *
 * <pre>{@code
 * MapObjectContent content = CotMapper.toContent(event, new Placement("tak-north", layerId, label, null));
 * CotEvent again = CotMapper.encode(event.uid(), content, Instant.now(), Instant.now().plusSeconds(60)).event();
 * }</pre>
 */
public final class CotMapper {

  /** The plugin's id, its extension namespace, and the system of the objects' external identity. */
  public static final String NAMESPACE = "cot";

  /** The field set every object of this plugin carries (brief function 23; ADR-0050): its full id. */
  public static final String FIELD_SET = NAMESPACE + ".unit";

  /** CoT's "unknown" error, and the largest value the declared fields {@code ce} and {@code le} take. */
  private static final double MAX_ERROR = 9_999_999;

  /** The longest {@code how} and callsign the declared fields take. */
  private static final int MAX_HOW = 16;
  private static final int MAX_CALLSIGN = 64;

  /** The data type of every object the plugin creates. */
  public static final String DATA_TYPE = "cot.cot";

  private static final Pattern JSON_NUMBER = Pattern.compile("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?");

  private CotMapper() {}

  /**
   * The object content for {@code event}.
   *
   * @param placement the layer, data source, label and style; see {@link Placement}
   */
  public static MapObjectContent toContent(CotEvent event, Placement placement) {
    return toContent(event, placement, null);
  }

  /**
   * As {@link #toContent(CotEvent, Placement)} for an object that exists already: the declared
   * fields {@code team} and {@code role} that other plugins' editors may have set stay as they are
   * in {@code previous} (the stored {@code cot} extension), unless the event's {@code __group}
   * names one (brief function 16).
   */
  public static MapObjectContent toContent(CotEvent event, Placement placement, @Nullable JsonObject previous) {
    Double hae = event.hae();
    Position position = hae == null || hae >= CotEvent.UNKNOWN
        ? Position.of(event.lon(), event.lat())
        : Position.of(event.lon(), event.lat(), hae);
    Instant start = event.start();
    Instant stale = event.stale();
    if (start != null && stale != null && start.isAfter(stale)) {
      start = null; // the model refuses a validFrom after the expiry (rule 15); the event is still shown
    }
    MapObjectContent content = new MapObjectContent(
        MapObjectContent.SYMBOL,
        DATA_TYPE,
        placement.dataSource(),
        new TimeAttributes(event.time(), start, stale),
        placement.layerId(),
        new Geometry.Point(position),
        symbol(event),
        placement.style(),
        new ObjectProperties(cut(event.callsign(), 256), cut(event.remarks(), 4096)),
        placement.label(),
        Extensions.empty().with(NAMESPACE, extension(event, previous)));
    return content.withFieldSet(FIELD_SET);
  }

  /**
   * The content of an update to the object {@code stored}: {@code content} (from {@link #toContent}) with what an update would
   * otherwise lose or leave out. An update replaces the relations (model rule 5), so the stored ones are carried over; the stored
   * field sets come first and this plugin's set is added, so an object made before M5 gets it at its next event.
   */
  public static MapObjectContent updating(MapObjectContent content, MapObjectContent stored) {
    return content.withRelations(stored.relations()).withFieldSets(stored.fieldSets()).withFieldSet(FIELD_SET);
  }

  /** Why an object cannot be sent as CoT. */
  public enum Skip {
    /** Not a {@code core.symbol} with a point: shapes and the like are not sent in M3. */
    NOT_A_SYMBOL("not a symbol"),
    /** A symbol CoT has no type for: a tactical graphic, or a symbol set with no CoT battle dimension. */
    NO_COT_TYPE("no CoT type");

    private final String text;

    Skip(String text) {
      this.text = text;
    }

    /** The reason as the status shows it. */
    public String text() {
      return text;
    }
  }

  /** The result of {@link #encode}: the event, or why there is none. */
  public record Encoded(@Nullable CotEvent event, @Nullable Skip skip) {
    public Encoded {
      if ((event == null) == (skip == null)) {
        throw new IllegalArgumentException("an event or a reason, not both and not neither");
      }
    }
  }

  /**
   * The CoT event for an object (brief function 17), or why it cannot be sent. M3 sends symbols with a point.
   *
   * <ul>
   *   <li><b>type:</b> from the symbol ({@link CotSymbols#cotType}); an object that came from CoT, with its symbol
   *       unchanged, keeps the type it came with (the extension's {@code type});
   *   <li><b>position:</b> {@code [lon, lat]} and the altitude as {@code hae} (unknown: {@code 9999999.0});
   *   <li><b>detail:</b> for an object that came from CoT, the raw detail with the core values put over it
   *       ({@link DetailEditor}): callsign, remarks, course, speed, and the declared fields team and role as
   *       {@code __group}; for the others, built from the same values;
   *   <li>{@code how}, {@code ce}, {@code le}, {@code access}, {@code caveat} and the rest from the extension when
   *       the object came from CoT; {@code how} is {@code h-e} otherwise.
   * </ul>
   *
   * @param uid the event's uid: the {@code externalRef} id for objects that came from CoT, the object id for the others
   * @param time the sending time: {@code @time} and {@code @start}
   * @param stale {@code @stale}
   */
  public static Encoded encode(String uid, MapObjectContent content, Instant time, Instant stale) {
    if (!MapObjectContent.SYMBOL.equals(content.type()) || !(content.geometry() instanceof Geometry.Point point) || content.symbol() == null) {
      return new Encoded(null, Skip.NOT_A_SYMBOL);
    }
    JsonObject ext = content.extensions().get(NAMESPACE);
    boolean fromCot = ext != null && ext.get("type") instanceof JsonString;
    String type = typeOf(content.symbol(), fromCot ? ext : null);
    if (type == null) {
      return new Encoded(null, Skip.NO_COT_TYPE);
    }
    ObjectProperties properties = content.properties();
    Modifiers modifiers = content.symbol().modifiers();
    String callsign = callsignOf(ext, properties, modifiers);
    String remarks = properties == null ? null : properties.description();
    Double course = modifiers == null ? null : modifiers.direction();
    Double speed = modifiers == null ? null : modifiers.speed();
    String team = ext == null ? null : text(ext, "team");
    String role = ext == null ? null : text(ext, "role");
    var values = new DetailEditor.Values(callsign, remarks, course, speed, team, role, symbolOut(content.symbol(), callsign));
    String detail = DetailEditor.apply(fromCot ? text(ext, "detail") : null, values);
    String how = ext == null ? null : text(ext, "how");
    String version = ext == null ? null : text(ext, "version");
    Position at = point.coordinates();
    var event = new CotEvent(
        uid,
        type,
        how == null ? "h-e" : how,
        version == null ? "2.0" : version,
        time,
        time,
        stale,
        ext == null ? null : text(ext, "access"),
        ext == null ? null : text(ext, "qos"),
        ext == null ? null : text(ext, "opex"),
        ext == null ? null : text(ext, "caveat"),
        ext == null ? null : text(ext, "releasableTo"),
        at.latitude(),
        at.longitude(),
        at.altitude(),
        ext == null ? null : text(ext, "ce"),
        ext == null ? null : text(ext, "le"),
        callsign,
        remarks,
        course,
        speed,
        detail,
        CotGroup.of(team, role));
    return new Encoded(event, null);
  }

  /** An object that came from CoT, with its symbol unchanged, keeps its type; any other symbol gets the type of its SIDC. */
  private static @Nullable String typeOf(Symbol symbol, @Nullable JsonObject ext) {
    if (symbol.standard() == SymbolStandard.VESSEL) {
      return vesselType(symbol);
    }
    if (ext != null && ext.get("type") instanceof JsonString kept && symbol.standard() == SymbolStandard.APP_6B) {
      String sidc = kept.value().equals("b-m-p") || kept.value().startsWith("b-m-p-") ? CotSymbols.POINT_SIDC : CotSymbols.sidc(kept.value());
      if (sidc.equals(symbol.sidc())) {
        return kept.value();
      }
    }
    if (ext != null && ext.get("type") instanceof JsonString kept && symbol.standard() == SymbolStandard.APP_6D) {
      // a symbol that came from a 2525C code (function 26) and is still what that code gives: the type it came with (function 17)
      UnitModifiers.Read read = UnitModifiers.read(text(ext, "detail"));
      if (read != null && symbol.sidc().equals(Sidc2525c.toApp6d(read.code()))) {
        return kept.value();
      }
    }
    return CotSymbols.cotType(symbol);
  }

  /**
   * A vessel symbol (SDK 1.4.0, brief function 25) goes out as a surface unit of its identity, {@code a-<affiliation>-S}: the
   * affiliation from the code's second digit (APP-6D's standard identity, 0 to 6 as pending, unknown, assumed friend, friend,
   * neutral, suspect, hostile). The first digit, the context, is not sent.
   */
  private static @Nullable String vesselType(Symbol symbol) {
    String sidc = symbol.sidc();
    if (sidc.length() != 4) {
      return null;
    }
    return switch (sidc.charAt(1)) {
      case '0' -> "a-p-S";
      case '1' -> "a-u-S";
      case '2' -> "a-a-S";
      case '3' -> "a-f-S";
      case '4' -> "a-n-S";
      case '5' -> "a-s-S";
      case '6' -> "a-h-S";
      default -> null;
    };
  }

  /**
   * The symbol code and the amplifiers that go out in ATAK's form (brief function 28): {@code __milsym} and {@code __milicon} with the
   * 2525C code, and a {@code unitmodifier} for each text modifier of function 27's table that is set. An APP-6B code goes out as
   * stored; a vessel and a code that cannot be converted get neither. The unique designation is not sent while it is the callsign (that
   * is what an object without one has, function 24): ATAK would show the callsign twice.
   */
  private static DetailEditor.@Nullable SymbolOut symbolOut(Symbol symbol, @Nullable String callsign) {
    String id = switch (symbol.standard()) {
      case APP_6B -> symbol.sidc().length() == 15 && symbol.sidc().charAt(0) == 'S' ? symbol.sidc() : null;
      case APP_6D, APP_6E -> Sidc2525c.toSidc2525c(symbol.sidc());
      default -> null;
    };
    if (id == null) {
      return symbol.standard() == SymbolStandard.VESSEL ? DetailEditor.SymbolOut.NONE : null;
    }
    Modifiers modifiers = symbol.modifiers();
    List<Map.Entry<String, String>> amplifiers = UnitModifiers.out(m -> {
      String value = modifiers == null ? null : modifiers.text(m);
      return m == TextModifier.UNIQUE_DESIGNATION && value != null && value.equals(callsign) ? null : value;
    });
    return new DetailEditor.SymbolOut(id, amplifiers);
  }

  /** The callsign TAK shows (brief function 24): the field {@code cot.callsign}, else the Name, else the unique designation. */
  private static @Nullable String callsignOf(@Nullable JsonObject ext, @Nullable ObjectProperties properties, @Nullable Modifiers modifiers) {
    String own = ext == null ? null : text(ext, "callsign");
    if (own != null && !own.isEmpty()) {
      return own;
    }
    if (properties != null && properties.name() != null) {
      return properties.name();
    }
    return modifiers == null ? null : modifiers.text(TextModifier.UNIQUE_DESIGNATION);
  }

  /** The content of the {@code cot} extension for {@code event}. */
  static JsonObject extension(CotEvent event) {
    return extension(event, null);
  }

  /** The declared fields of the {@code cot} extension (brief function 16), set by the event or kept from {@code previous}. */
  private static void fields(JsonObject.Builder ext, CotEvent event, @Nullable JsonObject previous) {
    CotGroup group = event.group();
    field(ext, "callsign", event.callsign() == null || event.callsign().length() > MAX_CALLSIGN || event.callsign().isEmpty() ? null : event.callsign(), previous);
    field(ext, "team", group == null ? null : group.name(), previous);
    field(ext, "role", group == null ? null : group.role(), previous);
  }

  private static void field(JsonObject.Builder ext, String name, @Nullable String received, @Nullable JsonObject previous) {
    if (received != null) {
      ext.put(name, JsonString.of(received));
    } else if (previous != null && previous.get(name) instanceof JsonString kept) {
      ext.put(name, kept);
    }
  }

  private static JsonObject extension(CotEvent event, @Nullable JsonObject previous) {
    var ext = JsonObject.builder();
    ext.put("type", JsonString.of(event.type()));
    putUpTo(ext, "how", event.how(), MAX_HOW);
    put(ext, "version", event.version());
    put(ext, "access", event.access());
    put(ext, "qos", event.qos());
    put(ext, "opex", event.opex());
    put(ext, "caveat", event.caveat());
    put(ext, "releasableTo", event.releasableTo());
    putError(ext, "ce", event.ce());
    putError(ext, "le", event.le());
    put(ext, "detail", event.detail());
    fields(ext, event, previous);
    return ext.build();
  }

  /**
   * The symbol of an event (brief functions 26 and 27): the 2525C code in {@code __milsym}, {@code __milicon} or {@code mil2525c},
   * converted to APP-6D, with the amplifiers; without a code, or one that cannot be converted, the symbol of the CoT type (function 4).
   */
  private static Symbol symbol(CotEvent event) {
    UnitModifiers.Read read = event.isAtom() ? UnitModifiers.read(event.detail()) : null;
    String app6d = read == null ? null : Sidc2525c.toApp6d(read.code());
    if (app6d == null) {
      return CotSymbols.symbol(event, modifiers(event, Map.of()));
    }
    return new Symbol(SymbolStandard.APP_6D, app6d, modifiers(event, read.amplifiers()));
  }

  private static @Nullable Modifiers modifiers(CotEvent event, Map<TextModifier, String> amplifiers) {
    Modifiers.Builder modifiers = Modifiers.builder();
    String callsign = cut(event.callsign(), TextModifier.MAX_LENGTH);
    if (callsign != null) {
      modifiers.text(TextModifier.UNIQUE_DESIGNATION, callsign); // the text next to the symbol (owner, 2026-10-12)
    }
    for (Map.Entry<TextModifier, String> amplifier : amplifiers.entrySet()) {
      modifiers.text(amplifier.getKey(), amplifier.getValue()); // the unique designation (ATAK's T) wins over the callsign
    }
    Double course = event.course();
    if (course != null && Math.abs(course) < CotEvent.UNKNOWN) {
      modifiers.direction(((course % 360) + 360) % 360);
    }
    Double speed = event.speed();
    if (speed != null && speed >= 0 && speed < CotEvent.UNKNOWN) {
      modifiers.speed(speed);
    }
    Modifiers built = modifiers.build();
    return built.isEmpty() ? null : built;
  }

  private static void put(JsonObject.Builder ext, String name, @Nullable String value) {
    if (value != null) {
      ext.put(name, JsonString.of(value));
    }
  }

  /** A text the declared field takes (at most {@code max} characters); a longer one is left out, so that the field only holds values its declaration takes (editors and the store check them). */
  private static void putUpTo(JsonObject.Builder ext, String name, @Nullable String value, int max) {
    if (value != null && value.length() <= max) {
      ext.put(name, JsonString.of(value));
    }
  }

  /**
   * The declared fields {@code ce} and {@code le} are numbers from 0 to 9 999 999 (CoT's "unknown"): a value as it was written
   * (so {@code 9999999.0} stays exactly that); anything else is left out, so that the field only holds values its declaration takes.
   */
  private static void putError(JsonObject.Builder ext, String name, @Nullable String value) {
    if (value == null || !JSON_NUMBER.matcher(value).matches()) {
      return;
    }
    double number = Double.parseDouble(value);
    if (number >= 0 && number <= MAX_ERROR) {
      ext.put(name, JsonNumber.of(value));
    }
  }

  private static @Nullable String text(JsonObject ext, String name) {
    JsonValue value = ext.get(name);
    if (value instanceof JsonString s) {
      return s.value();
    }
    if (value instanceof JsonNumber n) {
      return n.text();
    }
    return null;
  }

  private static @Nullable String cut(@Nullable String text, int max) {
    return text == null || text.length() <= max ? text : text.substring(0, max);
  }
}
