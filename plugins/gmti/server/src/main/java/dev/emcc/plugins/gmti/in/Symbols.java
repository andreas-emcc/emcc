package dev.emcc.plugins.gmti.in;

import dev.emcc.sdk.model.Symbol;
import org.jspecify.annotations.Nullable;

/**
 * The APP-6D symbols of what a link writes (brief section 3): 20-digit SIDCs, version 10, status
 * present. Digit 3 is the context from {@code P7}, digit 4 the standard identity.
 *
 * <p>The entity codes are milsymbol's (the renderer {@code symbology} uses) and APP-6D's; the README
 * lists them. Generic vehicles have no entity of their own in APP-6D, so a tracked or wheeled one is
 * a land equipment frame with its mobility amplifier (digits 9 and 10: 33 tracked, 31 wheeled).
 */
public final class Symbols {

  /** Land equipment, no entity: a ground track. */
  public static final String GROUND_TRACK = "15" + "00" + "000000";
  /** Land equipment, mobility tracked. */
  public static final String TRACKED = "15" + "33" + "000000";
  /** Land equipment, mobility wheeled (limited cross country). */
  public static final String WHEELED = "15" + "31" + "000000";
  /** Air, military rotary wing. */
  public static final String ROTARY_WING = "01" + "00" + "110200";
  /** Air, military fixed wing. */
  public static final String FIXED_WING = "01" + "00" + "110100";
  /** Sea surface, no entity: a surface vessel. */
  public static final String SURFACE_VESSEL = "30" + "00" + "000000";
  /** Land equipment, sensor: a ground based sensor platform. */
  public static final String GROUND_SENSOR = "15" + "00" + "220100";
  /** Air, no entity: a platform of unknown type. */
  public static final String UNKNOWN_PLATFORM = "01" + "00" + "000000";

  private Symbols() {}

  /** The APP-6D context (digit 3) of {@code P7}: 0 reality, 1 and 2 simulation, 128 to 130 exercise; reserved values as reality. */
  public static int context(int exercise) {
    if (exercise == 1 || exercise == 2) {
      return Symbol.CONTEXT_SIMULATION;
    }
    if (exercise >= 128 && exercise <= 130) {
      return Symbol.CONTEXT_EXERCISE;
    }
    return Symbol.CONTEXT_REALITY;
  }

  /** A detection's SIDC: unknown identity, by its class (the brief's Q8). */
  public static String detection(int context, @Nullable Integer classification) {
    String part = switch (Classes.kind(classification)) {
      case TRACKED -> TRACKED;
      case WHEELED -> WHEELED;
      case ROTARY_WING -> ROTARY_WING;
      case FIXED_WING -> FIXED_WING;
      case SURFACE_VESSEL -> SURFACE_VESSEL;
      case GROUND_TRACK -> GROUND_TRACK;
    };
    return sidc(context, StandardIdentity.UNKNOWN, part);
  }

  /**
   * The platform's SIDC: the link's {@code platformSymbol} with this context and identity, else the
   * default for {@code M3}: fixed wing for the aircraft types, a ground sensor for 13 to 15 (UGS and
   * ground based), unknown for 0, 255 and none (reference 4.1).
   */
  public static String platform(int context, StandardIdentity identity, @Nullable String linkSymbol, @Nullable Integer platformType) {
    if (linkSymbol != null && linkSymbol.length() == 20) {
      return linkSymbol.substring(0, 2) + context + identity.digit() + linkSymbol.substring(4);
    }
    String part;
    if (platformType == null || platformType == 0 || platformType == 255) {
      part = UNKNOWN_PLATFORM;
    } else if (platformType >= 13 && platformType <= 15) {
      part = GROUND_SENSOR;
    } else {
      part = FIXED_WING;
    }
    return sidc(context, identity, part);
  }

  /** {@code part}: symbol set (2), amplifier (2), entity (6). */
  private static String sidc(int context, StandardIdentity identity, String part) {
    return "10" + context + identity.digit() + part.substring(0, 2) + "0" + "0" + part.substring(2, 4) + part.substring(4) + "0000";
  }
}
