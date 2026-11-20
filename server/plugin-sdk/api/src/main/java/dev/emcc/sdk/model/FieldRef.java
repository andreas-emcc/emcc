package dev.emcc.sdk.model;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * SDK 1.2.0: names one declared field (ADR-0038): a key {@code name} in {@code
 * extensions.<plugin>} that the plugin {@code plugin} declares in its manifest's {@code fields}.
 * An output channel lists the fields its protocol uses ({@code ChannelInfo.fields}), so that a
 * sender can offer them.
 *
 * <pre>{@code
 * new FieldRef("cot", "callsign")
 * }</pre>
 *
 * @param plugin the declaring plugin's id
 * @param name the field's name, {@code ^[a-z][a-zA-Z0-9]*$}, at most 64 characters
 */
public record FieldRef(String plugin, String name) {

  private static final Pattern PLUGIN = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  private static final Pattern NAME = Pattern.compile("[a-z][a-zA-Z0-9]*");

  public FieldRef {
    Objects.requireNonNull(plugin, "plugin");
    Objects.requireNonNull(name, "name");
    if (!PLUGIN.matcher(plugin).matches() || plugin.length() > 64) {
      throw new IllegalArgumentException("not a plugin id: " + plugin);
    }
    if (!NAME.matcher(name).matches() || name.length() > 64) {
      throw new IllegalArgumentException("a field name is a lowercase letter, then letters and digits: " + name);
    }
  }
}
