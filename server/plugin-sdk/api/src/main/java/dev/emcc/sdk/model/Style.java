package dev.emcc.sdk.model;

import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * How a {@code core.shape} is drawn. Every field is optional.
 *
 * <pre>{@code
 * new Style("#A33A3A", 2.0, null, Style.Dash.DASH, "#FF8080", 0.2)
 * new Style("#1F3A93", 2.0, null, null, "#1F3A93", 0.6, Style.FillPattern.HATCH, null, null)  // data model 1.1.0
 * }</pre>
 *
 * @param strokeColor {@code #RRGGBB}
 * @param strokeWidth screen pixels, 0 to 50
 * @param strokeOpacity 0 to 1
 * @param strokeDash the line pattern
 * @param fillColor {@code #RRGGBB}
 * @param fillOpacity 0 to 1
 * @param fillPattern data model 1.1.0: how an area is filled; absent means {@link FillPattern#SOLID}
 * @param arrowhead data model 1.1.0: an arrowhead at a line's last point; absent means {@link Arrowhead#NONE}
 * @param pointMarkers data model 1.1.0: markers at every point of a line; absent means {@link PointMarkers#NONE}
 */
public record Style(
    @Nullable String strokeColor,
    @Nullable Double strokeWidth,
    @Nullable Double strokeOpacity,
    @Nullable Dash strokeDash,
    @Nullable String fillColor,
    @Nullable Double fillOpacity,
    @Nullable FillPattern fillPattern,
    @Nullable Arrowhead arrowhead,
    @Nullable PointMarkers pointMarkers) {

  private static final Pattern COLOR = Pattern.compile("#[0-9A-Fa-f]{6}");

  public Style {
    checkColor(strokeColor, "strokeColor");
    checkColor(fillColor, "fillColor");
    checkRange(strokeWidth, 0, 50, "strokeWidth");
    checkRange(strokeOpacity, 0, 1, "strokeOpacity");
    checkRange(fillOpacity, 0, 1, "fillOpacity");
  }

  /**
   * The style of data model 1.0.0: the 1.1.0 fields are absent (CR-0014 keeps this constructor).
   * Rebuilding a received style with it drops those fields on the next update, because an update
   * replaces {@code style} as a whole (model rule 5): copy the received {@code Style} instead.
   */
  public Style(
      @Nullable String strokeColor,
      @Nullable Double strokeWidth,
      @Nullable Double strokeOpacity,
      @Nullable Dash strokeDash,
      @Nullable String fillColor,
      @Nullable Double fillOpacity) {
    this(strokeColor, strokeWidth, strokeOpacity, strokeDash, fillColor, fillOpacity, null, null, null);
  }

  public boolean isEmpty() {
    return strokeColor == null
        && strokeWidth == null
        && strokeOpacity == null
        && strokeDash == null
        && fillColor == null
        && fillOpacity == null
        && fillPattern == null
        && arrowhead == null
        && pointMarkers == null;
  }

  /** The line pattern. */
  public enum Dash {
    SOLID("solid"),
    DASH("dash"),
    DOT("dot");

    private final String json;

    Dash(String json) {
      this.json = json;
    }

    public String json() {
      return json;
    }

    public static Dash fromJson(String value) {
      for (Dash d : values()) {
        if (d.json.equals(value)) {
          return d;
        }
      }
      throw new IllegalArgumentException("unknown strokeDash: " + value);
    }
  }

  /** How an area is filled (data model 1.1.0). {@code HATCH}: diagonal lines in the fill colour, the rest transparent. */
  public enum FillPattern {
    SOLID("solid"),
    HATCH("hatch");

    private final String json;

    FillPattern(String json) {
      this.json = json;
    }

    public String json() {
      return json;
    }

    public static FillPattern fromJson(String value) {
      for (FillPattern p : values()) {
        if (p.json.equals(value)) {
          return p;
        }
      }
      throw new IllegalArgumentException("unknown fillPattern: " + value);
    }
  }

  /** An arrowhead on a line (data model 1.1.0). {@code END}: at the last point, along the last segment. */
  public enum Arrowhead {
    NONE("none"),
    END("end");

    private final String json;

    Arrowhead(String json) {
      this.json = json;
    }

    public String json() {
      return json;
    }

    public static Arrowhead fromJson(String value) {
      for (Arrowhead a : values()) {
        if (a.json.equals(value)) {
          return a;
        }
      }
      throw new IllegalArgumentException("unknown arrowhead: " + value);
    }
  }

  /** Markers at a line's points, as for a route (data model 1.1.0). */
  public enum PointMarkers {
    NONE("none"),
    CIRCLE("circle");

    private final String json;

    PointMarkers(String json) {
      this.json = json;
    }

    public String json() {
      return json;
    }

    public static PointMarkers fromJson(String value) {
      for (PointMarkers m : values()) {
        if (m.json.equals(value)) {
          return m;
        }
      }
      throw new IllegalArgumentException("unknown pointMarkers: " + value);
    }
  }

  private static void checkColor(@Nullable String color, String name) {
    if (color != null && !COLOR.matcher(color).matches()) {
      throw new IllegalArgumentException(name + " must be #RRGGBB: " + color);
    }
  }

  private static void checkRange(@Nullable Double value, double min, double max, String name) {
    if (value != null && !(value >= min && value <= max)) {
      throw new IllegalArgumentException(name + " must be " + min + ".." + max + ": " + value);
    }
  }
}
