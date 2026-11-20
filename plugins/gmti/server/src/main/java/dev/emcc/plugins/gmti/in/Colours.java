package dev.emcc.plugins.gmti.in;

import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * The outline colours of the dwell areas and the coverage (brief section 5, from M7; T-181, T-185;
 * owner QM A, QR A): top-level settings beside {@code links}, set by an admin and the same for every
 * user and link. Each is one fixed colour or the platform identity's colour, as in M6. From M8 (T-189;
 * owner SU A, SV A) both are fixed by default: the dwell areas {@value #DWELL_AREA_DEFAULT}, the
 * coverage, the 4607 job's bounding area, {@value #COVERAGE_DEFAULT}; the identity's stays selectable.
 *
 * @param dwellArea the setting {@code dwellAreaColour}
 * @param coverage the setting {@code coverageColour}
 */
public record Colours(Colour dwellArea, Colour coverage) {

  /** A colour as the settings schema allows it, {@code #RRGGBB}; before the defaults, which it checks. */
  private static final Pattern HEX = Pattern.compile("#[0-9A-Fa-f]{6}");
  /** The dwell areas' default colour (M8, T-189), the schema's. */
  public static final String DWELL_AREA_DEFAULT = "#7EF26A";
  /** The coverage's default colour (M8, T-189), the schema's. */
  public static final String COVERAGE_DEFAULT = "#BDCF3D";

  /** The defaults from M8: both outlines fixed (T-189). */
  public static final Colours DEFAULTS = new Colours(new Colour(DWELL_AREA_DEFAULT), new Colour(COVERAGE_DEFAULT));
  /** Both outlines in the platform identity's colour: M7's default, still selectable. */
  public static final Colours IDENTITY = new Colours(Colour.IDENTITY, Colour.IDENTITY);


  public Colours {
    Objects.requireNonNull(dwellArea, "dwellArea");
    Objects.requireNonNull(coverage, "coverage");
  }

  /**
   * One outline's colour.
   *
   * @param fixed the admin's {@code #RRGGBB}, or {@code null} for the platform identity's colour
   */
  public record Colour(@Nullable String fixed) {

    public static final Colour IDENTITY = new Colour(null);

    public Colour {
      if (fixed != null && !HEX.matcher(fixed).matches()) {
        throw new IllegalArgumentException("a colour is #RRGGBB");
      }
    }

    /** The colour of a platform with this identity. */
    public String of(StandardIdentity identity) {
      return fixed != null ? fixed : identity.colour();
    }
  }

  /**
   * Reads both from the plugin's settings, with the schema's defaults (from M8, T-189): an absent
   * setting, or one without {@code use}, is fixed; a fixed one without {@code colour} has its
   * setting's default colour.
   *
   * @throws IllegalArgumentException with a problem an admin can act on
   */
  public static Colours from(JsonObject settings) {
    return new Colours(colour(settings, "dwellAreaColour", DWELL_AREA_DEFAULT), colour(settings, "coverageColour", COVERAGE_DEFAULT));
  }

  private static Colour colour(JsonObject settings, String key, String byDefault) {
    JsonValue value = settings.get(key);
    if (value == null) {
      return new Colour(byDefault);
    }
    if (!(value instanceof JsonObject o)) {
      throw new IllegalArgumentException(key + " is {\"use\": \"fixed\" or \"identity\", \"colour\": \"#RRGGBB\"}");
    }
    String use = o.get("use") instanceof JsonString s ? s.value() : "fixed";
    return switch (use) {
      case "identity" -> Colour.IDENTITY;
      case "fixed" -> {
        JsonValue colour = o.get("colour");
        if (colour == null) {
          yield new Colour(byDefault);
        }
        if (!(colour instanceof JsonString c) || !HEX.matcher(c.value()).matches()) {
          throw new IllegalArgumentException(key + ": a fixed colour is #RRGGBB");
        }
        yield new Colour(c.value());
      }
      default -> throw new IllegalArgumentException(key + ": use is fixed or identity");
    };
  }
}
