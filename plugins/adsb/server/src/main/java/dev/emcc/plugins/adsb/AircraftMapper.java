package dev.emcc.plugins.adsb;

import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

/**
 * Maps an aircraft's state to the map object it is shown as (the brief's mapping table). Pure: the
 * worker gives the layer, the data source and the label, and sends what this returns.
 */
final class AircraftMapper {

  /** The data type the manifest declares (ADR-0023). */
  static final String DATA_TYPE = "adsb.aircraft";

  /** The namespace of the ICAO 24-bit address in {@code externalRef} (model rule 16). */
  static final String EXTERNAL_SYSTEM = "icao24";

  /** The extension namespace: this plugin's id. */
  static final String NAMESPACE = "adsb";

  /** Knots to metres per second. */
  static final double KNOTS_TO_METRES_PER_SECOND = 0.514444;

  private AircraftMapper() {}

  /** The identity of an aircraft: its address in the external system. */
  static ExternalRef externalRef(String icao24) {
    return new ExternalRef(EXTERNAL_SYSTEM, icao24);
  }

  /**
   * The object of an aircraft with a position. Longitude comes first in the geometry: the SBS-1
   * fields carry latitude first, and the mapper is where they are swapped.
   *
   * @throws IllegalStateException without a position: the worker sends only aircraft that have one
   */
  static MapObjectContent content(
      Aircraft aircraft, UUID layerId, String dataSource, SecurityLabel label, Identity identity, Instant observed) {
    if (!aircraft.hasPosition()) {
      throw new IllegalStateException("no position for " + aircraft.icao24());
    }
    String name = aircraft.callsign() != null ? aircraft.callsign() : aircraft.icao24();
    Modifiers.Builder modifiers = Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, name);
    if (aircraft.altitudeFt() != null) {
      modifiers.text(TextModifier.ALTITUDE_DEPTH, flightLevel(aircraft.altitudeFt()));
    }
    if (aircraft.trackDegrees() != null) {
      modifiers.direction(aircraft.trackDegrees() >= 360 ? 0 : aircraft.trackDegrees());
    }
    if (aircraft.groundSpeedKt() != null) {
      modifiers.speed(aircraft.groundSpeedKt() * KNOTS_TO_METRES_PER_SECOND);
    }
    return new MapObjectContent(
        MapObjectContent.SYMBOL,
        DATA_TYPE,
        dataSource,
        new TimeAttributes(observed, null, null),
        layerId,
        new Geometry.Point(Position.of(aircraft.longitude(), aircraft.latitude())),
        new Symbol(SymbolStandard.APP_6D, identity.sidc(), modifiers.build()),
        null,
        new ObjectProperties(name, null),
        label,
        Extensions.empty().with(NAMESPACE, extension(aircraft)));
  }

  /**
   * The flight level of a barometric altitude: the hundreds of feet, in three digits ({@code FL350},
   * {@code FL025}). Below zero it is {@code FL000}.
   */
  static String flightLevel(int altitudeFt) {
    return String.format(Locale.ROOT, "FL%03d", Math.max(0, altitudeFt) / 100);
  }

  /** The values the table of the brief keeps in the extension: only those the aircraft has. */
  private static JsonObject extension(Aircraft aircraft) {
    JsonObject.Builder data = JsonObject.builder();
    if (aircraft.altitudeFt() != null) {
      data.put("altitudeFt", JsonNumber.of(aircraft.altitudeFt()));
    }
    if (aircraft.verticalRateFpm() != null) {
      data.put("verticalRateFpm", JsonNumber.of(aircraft.verticalRateFpm()));
    }
    if (aircraft.squawk() != null) {
      data.put("squawk", JsonString.of(aircraft.squawk()));
    }
    if (aircraft.emergency() != null) {
      data.put("emergency", JsonBoolean.of(aircraft.emergency()));
    }
    if (aircraft.onGround() != null) {
      data.put("onGround", JsonBoolean.of(aircraft.onGround()));
    }
    return data.build();
  }
}
