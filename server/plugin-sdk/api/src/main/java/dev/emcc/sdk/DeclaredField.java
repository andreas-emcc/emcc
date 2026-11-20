package dev.emcc.sdk;

import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.FieldRef;
import java.math.BigDecimal;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: a field a loaded plugin declares in its manifest's {@code fields} (ADR-0038 point 1;
 * {@code context.declaredFields()}). Its value is {@code extensions.<plugin>.<name>}: a string for
 * text and choice, a number for number and integer, {@code true} or {@code false} for boolean.
 *
 * <p>{@link #problem} checks a value as the object store does, so that a plugin can check what it
 * sets before it sends it.
 *
 * @param plugin the declaring plugin
 * @param name the field's name, {@code ^[a-z][a-zA-Z0-9]*$}
 * @param type its type
 * @param label its label in editors, 1 to 128 characters
 * @param description a longer description, or {@code null}
 * @param unit for number and integer: the unit values are stored in (an SI unit where one exists,
 *     {@code deg} for angles), or {@code null}
 * @param minimum for number and integer: the smallest value, or {@code null}
 * @param maximum for number and integer: the largest value, or {@code null}
 * @param maxLength for text: the longest value in characters, or {@code null} for {@link
 *     #DEFAULT_MAX_LENGTH}
 * @param required the value may not be removed
 * @param choices for choice: the values and their labels; empty otherwise
 * @param editableByOthers whether users may set it through any plugin's editor
 * @param dataTypes the data types it belongs to; empty: every object
 */
public record DeclaredField(
    String plugin,
    String name,
    Type type,
    String label,
    @Nullable String description,
    @Nullable String unit,
    @Nullable BigDecimal minimum,
    @Nullable BigDecimal maximum,
    @Nullable Integer maxLength,
    boolean required,
    List<Choice> choices,
    boolean editableByOthers,
    List<String> dataTypes) {

  private static final java.util.regex.Pattern TYPE_NAME = java.util.regex.Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[a-z][a-z0-9]*(-[a-z0-9]+)*");

  /** The longest text value when the declaration names no {@code maxLength}. */
  public static final int DEFAULT_MAX_LENGTH = 1024;

  /** A field's type. */
  public enum Type {
    TEXT,
    NUMBER,
    INTEGER,
    CHOICE,
    BOOLEAN;

    /** The manifest's name, e.g. {@code text}. */
    public String json() {
      return name().toLowerCase(java.util.Locale.ROOT);
    }
  }

  /**
   * One value of a choice field.
   *
   * @param value the stored value, 1 to 64 characters
   * @param label its label in editors, 1 to 128 characters
   */
  public record Choice(String value, String label) {
    public Choice {
      Objects.requireNonNull(value, "value");
      Objects.requireNonNull(label, "label");
      if (value.isEmpty() || value.length() > 64 || label.isEmpty() || label.length() > 128) {
        throw new IllegalArgumentException("a choice has a value of 1..64 and a label of 1..128 characters");
      }
    }
  }

  public DeclaredField {
    new FieldRef(plugin, name); // the same checks
    Objects.requireNonNull(type, "type");
    Objects.requireNonNull(label, "label");
    if (label.isEmpty() || label.length() > 128) {
      throw new IllegalArgumentException("a field's label must be 1..128 characters");
    }
    if (description != null && (description.isEmpty() || description.length() > 1024)) {
      throw new IllegalArgumentException("a field's description must be 1..1024 characters");
    }
    if (unit != null && (unit.isEmpty() || unit.length() > 16)) {
      throw new IllegalArgumentException("a field's unit must be 1..16 characters");
    }
    choices = List.copyOf(choices);
    dataTypes = List.copyOf(dataTypes);
    if (choices.size() > 256) {
      throw new IllegalArgumentException("at most 256 choices: " + name);
    }
    if (new HashSet<>(dataTypes).size() != dataTypes.size() || !dataTypes.stream().allMatch(t -> TYPE_NAME.matcher(t).matches() && t.length() <= 129)) {
      throw new IllegalArgumentException("data types are type names, each once: " + dataTypes);
    }
    boolean numeric = type == Type.NUMBER || type == Type.INTEGER;
    if (!numeric && (unit != null || minimum != null || maximum != null)) {
      throw new IllegalArgumentException("only number and integer fields have a unit, a minimum or a maximum: " + name);
    }
    if (minimum != null && maximum != null && minimum.compareTo(maximum) > 0) {
      throw new IllegalArgumentException("minimum is above maximum: " + name);
    }
    if (type != Type.TEXT && maxLength != null) {
      throw new IllegalArgumentException("only text fields have a maxLength: " + name);
    }
    if (maxLength != null && (maxLength < 1 || maxLength > 4096)) {
      throw new IllegalArgumentException("maxLength must be 1..4096: " + maxLength);
    }
    if ((type == Type.CHOICE) == choices.isEmpty()) {
      throw new IllegalArgumentException("a choice field has choices, and only a choice field: " + name);
    }
    if (new HashSet<>(choices.stream().map(Choice::value).toList()).size() != choices.size()) {
      throw new IllegalArgumentException("a choice is listed twice: " + name);
    }
  }

  /** A field with only a name, a type and a label: not required, not editable by others, for every object. */
  public static DeclaredField of(String plugin, String name, Type type, String label) {
    return new DeclaredField(plugin, name, type, label, null, null, null, null, null, false, List.of(), false, List.of());
  }

  /** This field's reference. */
  public FieldRef ref() {
    return new FieldRef(plugin, name);
  }

  /**
   * Whether it belongs to objects of {@code dataType}: it names that data type, or names none. The
   * shared editor shows at once only the fields that <b>name</b> the data type; one that names none
   * belongs to every object and is offered through the editor's "+".
   */
  public boolean belongsTo(String dataType) {
    return dataTypes.isEmpty() || dataTypes.contains(dataType);
  }

  /**
   * What is wrong with {@code value} for this field, as the object store says it; {@code null} if
   * nothing. {@code null} as the value removes the field, which a required field refuses. A number
   * no double holds ({@code 1e999999999}) "must be a number", as in the web SDK.
   */
  public @Nullable String problem(@Nullable JsonValue value) {
    if (value == null || value instanceof dev.emcc.sdk.json.JsonNull) {
      return required ? label + " is required" : null;
    }
    return switch (type) {
      case TEXT -> value instanceof JsonString s
          ? s.value().codePointCount(0, s.value().length()) > (maxLength == null ? DEFAULT_MAX_LENGTH : maxLength) ? label + " is too long" : null
          : label + " must be text";
      case CHOICE -> value instanceof JsonString s
          ? choices.stream().anyMatch(c -> c.value().equals(s.value())) ? null : label + " has no choice " + s.value()
          : label + " must be one of its choices";
      case BOOLEAN -> value instanceof JsonBoolean ? null : label + " must be yes or no";
      case NUMBER, INTEGER -> numberProblem(value);
    };
  }

  private @Nullable String numberProblem(JsonValue value) {
    if (!(value instanceof JsonNumber n)) {
      return label + " must be a number";
    }
    // A number no double holds (1e999999999) is refused, as the web SDK refuses an infinite one.
    if (!Double.isFinite(n.doubleValue())) {
      return label + " must be a number";
    }
    BigDecimal v = n.bigDecimalValue();
    if (type == Type.INTEGER && v.stripTrailingZeros().scale() > 0) {
      return label + " must be a whole number";
    }
    if (minimum != null && v.compareTo(minimum) < 0) {
      return label + " is below " + minimum.toPlainString() + (unit == null ? "" : " " + unit);
    }
    if (maximum != null && v.compareTo(maximum) > 0) {
      return label + " is above " + maximum.toPlainString() + (unit == null ? "" : " " + unit);
    }
    return null;
  }
}
