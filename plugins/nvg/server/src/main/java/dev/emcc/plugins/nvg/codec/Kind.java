package dev.emcc.plugins.nvg.codec;

import org.jspecify.annotations.Nullable;

/** The NVG 2.0 shapes this plugin maps, by element name ({@code content-item} has no geometry and is skipped). */
public enum Kind {
  TEXT("text", false),
  POINT("point", false),
  MULTIPOINT("multipoint", false),
  CIRCLE("circle", true),
  ELLIPSE("ellipse", true),
  RECT("rect", true),
  POLYLINE("polyline", false),
  ARROW("arrow", false),
  CORRIDOR("corridor", false),
  ORBIT("orbit", false),
  POLYGON("polygon", true),
  ARC("arc", false),
  ARCBAND("arcband", true);

  private final String element;
  private final boolean area;

  Kind(String element, boolean area) {
    this.element = element;
    this.area = area;
  }

  /** The element's local name, e.g. {@code arcband}. */
  public String element() {
    return element;
  }

  /** Whether the element is an area ({@code AreaContentType}), which may {@code exclude} rings. */
  public boolean isArea() {
    return area;
  }

  /** The kind of an element's local name, or {@code null} for another element. */
  public static @Nullable Kind of(String element) {
    for (Kind k : values()) {
      if (k.element.equals(element)) {
        return k;
      }
    }
    return null;
  }
}
