package dev.emcc.plugins.nvg.mapping;

import dev.emcc.sdk.model.Style;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * An item's {@code style}, inline CSS, and the model's {@link Style} (brief, section 3): {@code
 * stroke}, {@code stroke-width}, {@code stroke-opacity}, {@code stroke-dasharray}, {@code fill} and
 * {@code fill-opacity} map; every other property is kept, with the CSS text, so that it is written
 * back <b>[spec check: the CSS properties NVG defines]</b>.
 */
final class Css {

  /** The properties the model has fields for. */
  static final Set<String> MAPPED = Set.of("stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "fill", "fill-opacity");

  private static final Pattern HEX6 = Pattern.compile("#[0-9A-Fa-f]{6}");
  private static final Pattern HEX3 = Pattern.compile("#[0-9A-Fa-f]{3}");

  private Css() {}

  /**
   * What a {@code style} gives.
   *
   * @param style the mapped properties, or {@code null}
   * @param kept the CSS text when it has properties that are not mapped (or values that do not map), else {@code null}
   */
  record In(@Nullable Style style, @Nullable String kept) {}

  static In read(@Nullable String css, List<String> notes) {
    if (css == null || css.isBlank()) {
      return new In(null, null);
    }
    Map<String, String> props = parse(css);
    boolean unmapped = false;
    String stroke = null;
    Double width = null;
    Double strokeOpacity = null;
    Style.Dash dash = null;
    String fill = null;
    Double fillOpacity = null;
    for (var e : props.entrySet()) {
      String v = e.getValue();
      switch (e.getKey()) {
        case "stroke" -> {
          stroke = colour(v);
          unmapped |= stroke == null && !v.equalsIgnoreCase("none");
        }
        case "stroke-width" -> {
          width = Values.optional(v.replaceAll("(?i)px$", ""), "stroke-width", 0, 50, notes);
          unmapped |= width == null;
        }
        case "stroke-opacity" -> {
          strokeOpacity = Values.optional(v, "stroke-opacity", 0, 1, notes);
          unmapped |= strokeOpacity == null;
        }
        case "stroke-dasharray" -> {
          dash = dash(v);
          unmapped |= dash == null;
        }
        case "fill" -> {
          fill = colour(v);
          unmapped |= fill == null && !v.equalsIgnoreCase("none");
        }
        case "fill-opacity" -> {
          fillOpacity = Values.optional(v, "fill-opacity", 0, 1, notes);
          unmapped |= fillOpacity == null;
        }
        default -> unmapped = true;
      }
    }
    Style style = new Style(stroke, width, strokeOpacity, dash, fill, fillOpacity);
    return new In(style.isEmpty() ? null : style, unmapped ? css.strip() : null);
  }

  /**
   * A {@code text}'s {@code style} (owner, 2026-11-12): its {@code fill}, the colour of its letters
   * as in SVG, is the {@code core.text}'s colour, {@code style.strokeColor} (data model 1.6.0).
   * Everything else, its own {@code stroke} included, is kept <b>[spec check: a text's colour]</b>.
   */
  static In readText(@Nullable String css) {
    if (css == null || css.isBlank()) {
      return new In(null, null);
    }
    Map<String, String> props = parse(css);
    String fill = props.containsKey("fill") ? colour(props.get("fill")) : null;
    boolean unmapped = props.size() > (fill == null ? 0 : 1);
    return new In(fill == null ? null : new Style(fill, null, null, null, null, null), unmapped ? css.strip() : null);
  }

  /** A {@code text}'s {@code style} to write: its colour as {@code fill}, then the kept properties. */
  static @Nullable String writeText(@Nullable Style style, @Nullable String kept) {
    Map<String, String> out = new LinkedHashMap<>();
    if (style != null && style.strokeColor() != null) {
      out.put("fill", style.strokeColor());
    }
    if (kept != null) {
      parse(kept).forEach((name, value) -> {
        // A fill colour was the text's colour, read into its style; any other fill (none) is kept.
        if (!(name.equals("fill") && colour(value) != null)) {
          out.putIfAbsent(name, value);
        }
      });
    }
    if (out.isEmpty()) {
      return null;
    }
    StringBuilder b = new StringBuilder();
    out.forEach((name, value) -> b.append(b.isEmpty() ? "" : ";").append(name).append(':').append(value));
    return b.toString();
  }

  /** The {@code style} to write: the object's style, then the kept properties the model has no field for. */
  static @Nullable String write(@Nullable Style style, @Nullable String kept) {
    Map<String, String> out = new LinkedHashMap<>();
    if (style != null) {
      if (style.strokeColor() != null) {
        out.put("stroke", style.strokeColor());
      }
      if (style.strokeWidth() != null) {
        out.put("stroke-width", Values.number(style.strokeWidth()));
      }
      if (style.strokeOpacity() != null) {
        out.put("stroke-opacity", Values.number(style.strokeOpacity()));
      }
      if (style.strokeDash() == Style.Dash.DASH) {
        out.put("stroke-dasharray", "8,4");
      } else if (style.strokeDash() == Style.Dash.DOT) {
        out.put("stroke-dasharray", "2,4");
      }
      if (style.fillColor() != null) {
        out.put("fill", style.fillColor());
      }
      if (style.fillOpacity() != null) {
        out.put("fill-opacity", Values.number(style.fillOpacity()));
      }
    }
    if (kept != null) {
      parse(kept).forEach((name, value) -> {
        if (!MAPPED.contains(name)) {
          out.putIfAbsent(name, value);
        }
      });
    }
    if (out.isEmpty()) {
      return null;
    }
    StringBuilder b = new StringBuilder();
    out.forEach((name, value) -> b.append(b.isEmpty() ? "" : ";").append(name).append(':').append(value));
    return b.toString();
  }

  /** {@code name: value; ...}, names in lower case, in order; the last of a repeated name wins. */
  static Map<String, String> parse(String css) {
    Map<String, String> props = new LinkedHashMap<>();
    for (String declaration : css.split(";")) {
      int colon = declaration.indexOf(':');
      if (colon <= 0) {
        continue;
      }
      String name = declaration.substring(0, colon).strip().toLowerCase(Locale.ROOT);
      String value = declaration.substring(colon + 1).strip();
      if (!name.isEmpty() && !value.isEmpty()) {
        props.put(name, value);
      }
    }
    return props;
  }

  private static @Nullable String colour(String value) {
    String v = value.strip();
    if (HEX6.matcher(v).matches()) {
      return v.toUpperCase(Locale.ROOT);
    }
    if (HEX3.matcher(v).matches()) {
      return ("#" + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2) + v.charAt(3) + v.charAt(3)).toUpperCase(Locale.ROOT);
    }
    return null;
  }

  /** Dashes or dots: a pattern whose first mark is at most 3 long is dots (brief: dashes → dash, dots → dot). */
  private static Style.@Nullable Dash dash(String value) {
    String v = value.strip();
    if (v.equalsIgnoreCase("none")) {
      return Style.Dash.SOLID;
    }
    String[] parts = v.split("[,\\s]+");
    Double first = parts.length == 0 ? null : Values.parse(parts[0].replaceAll("(?i)px$", ""));
    if (first == null) {
      return null;
    }
    return first <= 3 ? Style.Dash.DOT : Style.Dash.DASH;
  }
}
