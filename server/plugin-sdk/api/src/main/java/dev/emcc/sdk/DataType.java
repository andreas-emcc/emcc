package dev.emcc.sdk;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * An available data type (ADR-0023): the built-in {@code core.general}, or one that a loaded
 * plugin declares in its manifest's {@code dataTypes}. The list is fixed while the server runs.
 *
 * <pre>{@code
 * for (DataType type : context.dataTypes()) { ... }   // core.general first
 * }</pre>
 *
 * @param id {@code core.general} or {@code <plugin-id>.<name>}
 * @param name the display name
 * @param description a description, or {@code null}
 * @param declaredBy the declaring plugin's id, or {@code null} for {@code core.general}
 * @param defaults the default behaviour from the manifest; ECore's settings per data type may override it
 * @param fieldSets SDK 1.5.0 (CR-0038 point 2): the full ids ({@code <plugin-id>.<id>}) of the
 *     field sets objects of this type carry, in the manifest's order, at most 8, each once and of
 *     the declaring plugin; empty when there are none, and always for {@code core.general}. The
 *     object store adds them to a {@code core.symbol} object on a create and on a data type change
 *     (model rule 21; symbols only in 1.5.0, owner NO A).
 * @param manual SDK 1.5.0 (CR-0038 point 6): whether users make objects of this type by hand;
 *     editors leave a type with {@code false} out of their data type select. The store does not
 *     check it.
 * @param sensorReport SDK 1.5.0 (CR-0039 point 6; T-151, owner Q4): whether its objects are sensor
 *     reports, which the map view draws with {@code symbology}'s sensor report symbol instead of
 *     their APP-6 symbol; {@code false} by default. The store does not check it
 */
public record DataType(String id, String name, @Nullable String description, @Nullable String declaredBy, Defaults defaults,
    List<String> fieldSets, boolean manual, boolean sensorReport) {

  /** The most field sets a data type names (data model 1.5.0). */
  public static final int MAX_FIELD_SETS = 8;

  /** The id of the built-in data type. */
  public static final String GENERAL = "core.general";

  private static final Pattern ID = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public DataType {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(defaults, "defaults");
    if (!ID.matcher(id).matches() || id.length() > 129) {
      throw new IllegalArgumentException("data type id must be '<namespace>.<name>': " + id);
    }
    if (declaredBy == null ? !id.equals(GENERAL) : !id.startsWith(declaredBy + ".")) {
      throw new IllegalArgumentException("data type " + id + " must be core.general or start with its plugin's id: " + declaredBy);
    }
    fieldSets = List.copyOf(Objects.requireNonNull(fieldSets, "fieldSets"));
    if (fieldSets.size() > MAX_FIELD_SETS || new LinkedHashSet<>(fieldSets).size() != fieldSets.size()) {
      throw new IllegalArgumentException("a data type names at most " + MAX_FIELD_SETS + " field sets, each once: " + fieldSets);
    }
    for (String set : fieldSets) {
      if (declaredBy == null || !set.startsWith(declaredBy + ".") || !ID.matcher(set).matches()) {
        throw new IllegalArgumentException("data type " + id + " names a field set that is not its plugin's: " + set);
      }
    }
  }

  /**
   * A data type without field sets that users make by hand, as before SDK 1.5.0.
   *
   * @param id {@code core.general} or {@code <plugin-id>.<name>}
   * @param name the display name
   * @param description a description, or {@code null}
   * @param declaredBy the declaring plugin's id, or {@code null} for {@code core.general}
   * @param defaults the default behaviour from the manifest
   */
  public DataType(String id, String name, @Nullable String description, @Nullable String declaredBy, Defaults defaults) {
    this(id, name, description, declaredBy, defaults, List.of(), true, false);
  }

  /**
   * The SDK 1.5.0 part 1 data type, not a sensor report (CR-0039: kept, so the change is compatible).
   *
   * @param id {@code core.general} or {@code <plugin-id>.<name>}
   * @param name the display name
   * @param description a description, or {@code null}
   * @param declaredBy the declaring plugin's id, or {@code null} for {@code core.general}
   * @param defaults the default behaviour from the manifest
   * @param fieldSets the full ids of its field sets
   * @param manual whether users make its objects by hand
   */
  public DataType(String id, String name, @Nullable String description, @Nullable String declaredBy, Defaults defaults, List<String> fieldSets, boolean manual) {
    this(id, name, description, declaredBy, defaults, fieldSets, manual, false);
  }

  /**
   * SDK 1.5.0: this data type with the field sets it names.
   *
   * @param ids the full ids, {@code <plugin-id>.<id>}
   * @return a copy with {@link #fieldSets()} replaced
   */
  public DataType withFieldSets(String... ids) {
    return new DataType(id, name, description, declaredBy, defaults, List.of(ids), manual, sensorReport);
  }

  /**
   * SDK 1.5.0: this data type with {@link #manual()} set.
   *
   * @param value whether users make its objects by hand
   * @return a copy with {@link #manual()} replaced
   */
  public DataType withManual(boolean value) {
    return new DataType(id, name, description, declaredBy, defaults, fieldSets, value, sensorReport);
  }

  /**
   * SDK 1.5.0 (CR-0039 point 6): this data type with {@link #sensorReport()} set.
   *
   * @param value whether its objects are sensor reports
   * @return a copy with {@link #sensorReport()} replaced
   */
  public DataType withSensorReport(boolean value) {
    return new DataType(id, name, description, declaredBy, defaults, fieldSets, manual, value);
  }

  /** The built-in data type. */
  public static DataType general() {
    return new DataType(GENERAL, "General", "The built-in data type, for everything without a more specific one.", null, Defaults.NONE);
  }

  /**
   * Default behaviour of objects of a data type (manifest {@code dataTypes[].defaults}, model rule
   * 15). Absent values mean: never expires, not faded, never removed.
   *
   * @param expiresAfterSeconds for objects without {@code time.expires}: seconds after {@code time.observed} until they expire, or {@code null}; from SDK 1.5.0 an object without {@code time.observed} does not expire by its data type (model rule 15, CR-0038 point 9)
   * @param fadeWhenExpired whether expired objects are drawn faded
   * @param removeAfterExpirySeconds seconds after the expiry when ECore deletes the object, or {@code null} for never
   */
  public record Defaults(@Nullable Long expiresAfterSeconds, boolean fadeWhenExpired, @Nullable Long removeAfterExpirySeconds) {

    /** Never expires, not faded, never removed. */
    public static final Defaults NONE = new Defaults(null, false, null);

    public Defaults {
      if (expiresAfterSeconds != null && expiresAfterSeconds < 1) {
        throw new IllegalArgumentException("expiresAfterSeconds must be >= 1");
      }
      if (removeAfterExpirySeconds != null && removeAfterExpirySeconds < 0) {
        throw new IllegalArgumentException("removeAfterExpirySeconds must be >= 0");
      }
    }
  }
}
