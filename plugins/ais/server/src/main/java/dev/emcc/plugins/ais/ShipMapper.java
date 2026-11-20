package dev.emcc.plugins.ais;

import dev.emcc.plugins.ais.codec.AisClass;
import dev.emcc.plugins.ais.codec.AisMessage;
import dev.emcc.plugins.ais.codec.AisStatic;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Maps AIS to a ship object (brief section 3). Pure: no store, no clock. The position is
 * {@code [longitude, latitude]}. Only the extension {@code ais} is written.
 */
public final class ShipMapper {

  /** The plugin's id, its extension namespace, and the system of the objects' external identity. */
  public static final String NAMESPACE = "ais";

  /** The data type of every object the plugin creates. */
  public static final String DATA_TYPE = "ais.vessel";

  /** The field set every ship carries (brief section 10; ADR-0050). */
  public static final String FIELD_SET = "ais.ship";

  private ShipMapper() {}

  /**
   * Where an object goes and how it is marked.
   *
   * @param dataSource the link's name
   * @param layerId the link's layer
   * @param label the link's label, else the server's default
   * @param identity the link's standard identity
   * @param symbolType vessel symbols or APP-6D
   */
  public record Placement(String dataSource, UUID layerId, SecurityLabel label, StandardIdentity identity, SymbolType symbolType) {

    /** A placement with APP-6D symbols. */
    public Placement(String dataSource, UUID layerId, SecurityLabel label, StandardIdentity identity) {
      this(dataSource, layerId, label, identity, SymbolType.APP6);
    }
  }

  /** The MMSI as nine digits, leading zeros kept. */
  public static String mmsiText(int mmsi) {
    return String.format(Locale.ROOT, "%09d", mmsi);
  }

  public static ExternalRef externalRef(int mmsi) {
    return new ExternalRef(NAMESPACE, mmsiText(mmsi));
  }

  /**
   * The content for a position message. {@code statics} is everything known about the ship: what it
   * sent before, with this message's own fields over it.
   *
   * @param style the stored object's style on an update, else {@code null}
   */
  public static MapObjectContent position(Placement p, AisMessage.Position m, AisStatic statics, Instant observed, @Nullable Style style) {
    return content(p, m.mmsi(), m.lon(), m.lat(), m.course(), m.speedMetresPerSecond(), m.heading(), m.navStatus(), statics, observed, style);
  }

  /**
   * The content for a static message about a ship that exists: its position, time, layer, label and
   * style stay as stored; the name, the symbol and the extension follow {@code statics}.
   */
  public static MapObjectContent refresh(MapObjectContent stored, int mmsi, AisStatic statics, StandardIdentity identity) {
    return refresh(stored, mmsi, statics, identity, SymbolType.APP6);
  }

  /** As above, with the symbol type the ship's link now has. */
  public static MapObjectContent refresh(MapObjectContent stored, int mmsi, AisStatic statics, StandardIdentity identity, SymbolType symbolType) {
    Position at = ((Geometry.Point) stored.geometry()).coordinates();
    Modifiers m = stored.symbol() == null ? null : stored.symbol().modifiers();
    JsonObject own = stored.extensions().get(NAMESPACE);
    var placement = new Placement(stored.dataSource(), stored.layerId(), stored.label(), identity, symbolType);
    Instant observed = stored.time() == null ? null : stored.time().observed();
    return content(placement, mmsi, at.longitude(), at.latitude(), m == null ? null : m.direction(), m == null ? null : m.speed(),
        integer(own, "heading"), integer(own, "navStatus"), statics, observed, stored.style());
  }

  private static MapObjectContent content(
      Placement p, int mmsi, double lon, double lat, @Nullable Double direction, @Nullable Double speed, @Nullable Integer heading,
      @Nullable Integer navStatus, AisStatic st, @Nullable Instant observed, @Nullable Style style) {
    String id = mmsiText(mmsi);
    String name = st.name() != null ? st.name() : id;
    Modifiers.Builder modifiers = Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, name);
    if (direction != null) {
      modifiers.direction(direction);
    }
    if (speed != null) {
      modifiers.speed(speed);
    }
    Symbol symbol = p.symbolType() == SymbolType.VESSEL
        ? Symbol.vessel(Symbol.CONTEXT_REALITY, p.identity().digit() - '0', st.shipType() == null ? 0 : st.shipType(), modifiers.build())
        : new Symbol(SymbolStandard.APP_6D, sidc(p.identity(), st.shipType()), modifiers.build());
    var ext = JsonObject.builder();
    put(ext, "class", st.cls() == null ? null : JsonString.of(st.cls() == AisClass.A ? "A" : "B"));
    put(ext, "heading", number(heading));
    put(ext, "navStatus", number(navStatus));
    put(ext, "callSign", st.callSign() == null ? null : JsonString.of(st.callSign()));
    put(ext, "imo", number(st.imo()));
    put(ext, "shipType", number(st.shipType()));
    put(ext, "length", number(st.length()));
    put(ext, "beam", number(st.beam()));
    put(ext, "draught", st.draught() == null ? null : JsonNumber.of(st.draught()));
    put(ext, "destination", st.destination() == null ? null : JsonString.of(st.destination()));
    return new MapObjectContent(
        MapObjectContent.SYMBOL, DATA_TYPE, p.dataSource(), new TimeAttributes(observed, null, null), p.layerId(),
        new Geometry.Point(Position.of(lon, lat)), symbol, style, new ObjectProperties(name, null), p.label(),
        Extensions.empty().with(NAMESPACE, ext.build()));
  }

  /** The APP-6D SIDC of a ship: symbol set 30 (sea surface), the entity by ship type, status present. */
  public static String sidc(StandardIdentity identity, @Nullable Integer shipType) {
    return "100" + identity.digit() + "30" + "0" + "0" + "00" + entity(shipType) + "0000";
  }

  private static String entity(@Nullable Integer shipType) {
    if (shipType == null) {
      return "140000";
    }
    int t = shipType;
    if (t == 30) {
      return "140200"; // fishing vessel
    }
    if (t >= 60 && t <= 69) {
      return "140110"; // passenger ship
    }
    if (t >= 70 && t <= 79) {
      return "140100"; // merchant ship
    }
    if (t >= 80 && t <= 89) {
      return "140109"; // oiler/tanker
    }
    return "140000"; // civilian (generic)
  }

  /** The standard identity a stored ship's symbol shows, for a ship whose link is gone; unknown for anything else. */
  public static StandardIdentity identityOf(@Nullable Symbol symbol) {
    if (symbol == null) {
      return StandardIdentity.UNKNOWN;
    }
    if (symbol.isVessel()) {
      return StandardIdentity.ofDigit((char) ('0' + symbol.vesselIdentity()));
    }
    return symbol.sidc().length() < 4 ? StandardIdentity.UNKNOWN : StandardIdentity.ofDigit(symbol.sidc().charAt(3));
  }

  /** What the stored object knows about the ship, for a position message that arrives when the link has forgotten it. */
  public static AisStatic staticsOf(MapObjectContent stored) {
    JsonObject own = stored.extensions().get(NAMESPACE);
    String stored1 = stored.properties() == null ? null : stored.properties().name();
    String name = stored1 != null && stored1.matches("[0-9]{9}") ? null : stored1; // a name that is the MMSI is no name
    JsonValue cls = own == null ? null : own.get("class");
    JsonValue draught = own == null ? null : own.get("draught");
    return new AisStatic(
        name, text(own, "callSign"), integer(own, "imo"), integer(own, "shipType"), integer(own, "length"), integer(own, "beam"),
        draught instanceof JsonNumber n ? n.doubleValue() : null, text(own, "destination"),
        cls instanceof JsonString s ? ("A".equals(s.value()) ? AisClass.A : AisClass.B) : null);
  }

  private static void put(JsonObject.Builder ext, String name, @Nullable JsonValue value) {
    if (value != null) {
      ext.put(name, value);
    }
  }

  private static @Nullable JsonValue number(@Nullable Integer v) {
    return v == null ? null : JsonNumber.of(v.longValue());
  }

  private static @Nullable Integer integer(@Nullable JsonObject o, String name) {
    JsonValue v = o == null ? null : o.get(name);
    return v instanceof JsonNumber n ? (int) n.longValueExact() : null;
  }

  private static @Nullable String text(@Nullable JsonObject o, String name) {
    return o != null && o.get(name) instanceof JsonString s ? s.value() : null;
  }
}
