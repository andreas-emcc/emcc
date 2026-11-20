package dev.emcc.sdk;

import dev.emcc.sdk.model.Style;
import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.4.0: a kind of relation a loaded plugin declares in its manifest's {@code relationKinds}
 * (ADR-0051 point 2, CR-0031; {@code context.relationKinds()}), with how the map view draws its
 * lines and whether the user's switch is on by default.
 *
 * <pre>{@code
 * new RelationKind("gmti.pairing", "GMTI Pairing", RelationKind.Line.of("#FFFF00"), false)
 * }</pre>
 *
 * @param id {@code <plugin-id>.<name>}, e.g. {@code gmti.pairing}
 * @param label shown at the user's switch, 1 to 64 characters
 * @param line how the line to the other object is drawn
 * @param defaultOn the default of the user's switch
 */
public record RelationKind(String id, String label, Line line, boolean defaultOn) {

  private static final Pattern TYPE_NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[a-z][a-z0-9]*(-[a-z0-9]+)*");
  private static final Pattern COLOR = Pattern.compile("#[0-9A-Fa-f]{6}");

  private static final Pattern POINTER = Pattern.compile("(/[A-Za-z0-9_-]+)+");

  public RelationKind {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(label, "label");
    Objects.requireNonNull(line, "line");
    if (!TYPE_NAME.matcher(id).matches() || id.length() > 129) {
      throw new IllegalArgumentException("a relation kind's id must be '<plugin-id>.<name>': " + id);
    }
    if (label.isBlank() || label.length() > 64) {
      throw new IllegalArgumentException("a relation kind's label is 1..64 characters");
    }
  }

  /** The declaring plugin: the id's namespace. */
  public String plugin() {
    return id.substring(0, id.indexOf('.'));
  }

  /**
   * How a relation's line is drawn, in the shape style's words.
   *
   * @param strokeColor {@code #RRGGBB}
   * @param strokeWidth screen pixels, 0.5 to 10 (default 1)
   * @param strokeDash solid, dash or dot (default solid)
   * @param arrowhead {@code NONE} or {@code END}, at the other object (default none)
   * @param strokeColorSetting SDK 1.6.0 (CR-0041 part C; T-181): a JSON Pointer into the declaring
   *     plugin's settings to a {@code #RRGGBB} string that gives the line's colour, e.g. {@code
   *     /pairingColour}; {@code strokeColor} is the fallback. {@code null}: the colour is {@code strokeColor}
   */
  public record Line(String strokeColor, double strokeWidth, Style.Dash strokeDash, Style.Arrowhead arrowhead, @Nullable String strokeColorSetting) {
    public Line {
      Objects.requireNonNull(strokeColor, "strokeColor");
      Objects.requireNonNull(strokeDash, "strokeDash");
      Objects.requireNonNull(arrowhead, "arrowhead");
      if (!COLOR.matcher(strokeColor).matches()) {
        throw new IllegalArgumentException("a colour is #RRGGBB: " + strokeColor);
      }
      if (!(strokeWidth >= 0.5 && strokeWidth <= 10)) {
        throw new IllegalArgumentException("a relation line's width is 0.5..10 pixels: " + strokeWidth);
      }
      if (strokeColorSetting != null && (!POINTER.matcher(strokeColorSetting).matches() || strokeColorSetting.length() > 256)) {
        throw new IllegalArgumentException("strokeColorSetting is a JSON Pointer such as /pairingColour: " + strokeColorSetting);
      }
    }

    /** The 1.4.0 form, its colour fixed. */
    public Line(String strokeColor, double strokeWidth, Style.Dash strokeDash, Style.Arrowhead arrowhead) {
      this(strokeColor, strokeWidth, strokeDash, arrowhead, null);
    }

    /** SDK 1.6.0: a copy whose colour comes from the plugin's setting at {@code pointer}. */
    public Line withStrokeColorSetting(String pointer) {
      return new Line(strokeColor, strokeWidth, strokeDash, arrowhead, Objects.requireNonNull(pointer, "pointer"));
    }

    /** A solid line of width 1 without an arrowhead, in {@code strokeColor}. */
    public static Line of(String strokeColor) {
      return new Line(strokeColor, 1, Style.Dash.SOLID, Style.Arrowhead.NONE);
    }

    /** The manifest's line with its defaults applied for absent members. */
    public static Line of(String strokeColor, @Nullable Double strokeWidth, Style.@Nullable Dash strokeDash, Style.@Nullable Arrowhead arrowhead) {
      return new Line(strokeColor, strokeWidth == null ? 1 : strokeWidth, strokeDash == null ? Style.Dash.SOLID : strokeDash,
          arrowhead == null ? Style.Arrowhead.NONE : arrowhead);
    }
  }
}
