package dev.emcc.sdk.model;

import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * Data model 1.6.0 (CR-0041 part A; ADR-0055 point 4): the text of a {@code core.text} object, a
 * text placed at its {@code Point}. The map view draws it (`map-view-2d` function 45): centred on
 * the point, in {@code style.strokeColor} or the look's label colour, with the label halo.
 *
 * <pre>{@code
 * new Text("Bridge 12\nclosed", 30.0, 16)   // two lines, turned 30° clockwise from true north, 16 px
 * Text.of("Alpha")                          // upright, 14 px
 * }</pre>
 *
 * @param value 1 to {@link #MAX_LENGTH} characters; a line break starts a new line
 * @param rotation degrees clockwise from true north at the point, 0 to under 360; {@code null} means 0
 * @param size CSS pixels, {@link #MIN_SIZE} to {@link #MAX_SIZE}; {@code null} means {@link #DEFAULT_SIZE}
 */
public record Text(String value, @Nullable Double rotation, @Nullable Integer size) {

  /** The longest text. */
  public static final int MAX_LENGTH = 1024;
  public static final int MIN_SIZE = 8;
  public static final int MAX_SIZE = 48;
  public static final int DEFAULT_SIZE = 14;

  public Text {
    Objects.requireNonNull(value, "value");
    if (value.isEmpty() || value.length() > MAX_LENGTH) {
      throw new IllegalArgumentException("a text has 1 to " + MAX_LENGTH + " characters");
    }
    if (rotation != null && !(rotation >= 0 && rotation < 360)) {
      throw new IllegalArgumentException("a text's rotation is 0 to under 360 degrees: " + rotation);
    }
    if (size != null && (size < MIN_SIZE || size > MAX_SIZE)) {
      throw new IllegalArgumentException("a text's size is " + MIN_SIZE + " to " + MAX_SIZE + " px: " + size);
    }
  }

  /** An upright text of the default size. */
  public static Text of(String value) {
    return new Text(value, null, null);
  }
}
