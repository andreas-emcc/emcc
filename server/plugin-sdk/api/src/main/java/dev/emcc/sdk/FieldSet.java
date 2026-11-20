package dev.emcc.sdk;

import dev.emcc.sdk.model.FieldRef;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * SDK 1.4.0: a field set a loaded plugin declares in its manifest's {@code fieldSets} (ADR-0050;
 * {@code context.fieldSets()}): a named group of that plugin's own declared fields, e.g. the fields
 * a protocol uses. Objects list the sets they carry in {@code MapObjectContent.fieldSets()}, by
 * {@link #id()}.
 *
 * <pre>{@code
 * FieldSet unit = new FieldSet("cot", "unit", "CoT unit", List.of("callsign", "role"));
 * unit.id();   // "cot.unit"
 * }</pre>
 *
 * @param plugin the declaring plugin
 * @param name the set's name within the plugin, lowercase words separated by hyphens, at most 64
 *     characters (the manifest's {@code id})
 * @param label shown as the group's heading and in editors' drop-downs, 1 to 128 characters
 * @param fields the names of the plugin's own declared fields in the set, 1 to 256, each once, in
 *     the order editors show them
 */
public record FieldSet(String plugin, String name, String label, List<String> fields) {

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");
  private static final Pattern FIELD = Pattern.compile("[a-z][a-zA-Z0-9]*");

  public FieldSet {
    Objects.requireNonNull(plugin, "plugin");
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(label, "label");
    Objects.requireNonNull(fields, "fields");
    if (!NAME.matcher(plugin).matches() || plugin.length() > 64) {
      throw new IllegalArgumentException("not a plugin id: " + plugin);
    }
    if (!NAME.matcher(name).matches() || name.length() > 64) {
      throw new IllegalArgumentException("a field set's name is lowercase words separated by hyphens: " + name);
    }
    if (label.isBlank() || label.length() > 128) {
      throw new IllegalArgumentException("a field set's label is 1..128 characters");
    }
    fields = List.copyOf(fields);
    if (fields.isEmpty() || fields.size() > 256 || new LinkedHashSet<>(fields).size() != fields.size()) {
      throw new IllegalArgumentException("a field set has 1..256 fields, each once: " + fields);
    }
    for (String f : fields) {
      if (!FIELD.matcher(f).matches() || f.length() > 64) {
        throw new IllegalArgumentException("not a field name: " + f);
      }
    }
  }

  /** Its full id, {@code <plugin>.<name>}, e.g. {@code cot.unit}: what objects list. */
  public String id() {
    return plugin + "." + name;
  }

  /** Its fields as references, {@code (plugin, field)}, e.g. for a change request's {@code fields}. */
  public List<FieldRef> refs() {
    return fields.stream().map(f -> new FieldRef(plugin, f)).toList();
  }
}
