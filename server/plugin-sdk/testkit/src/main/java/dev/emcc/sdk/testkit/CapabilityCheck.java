package dev.emcc.sdk.testkit;

import dev.emcc.sdk.capability.Capability;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.EnumSet;
import java.util.Set;
import java.util.TreeSet;

/**
 * SDK 1.4.0 (ADR-0044 point 4, CR-0030 part 4): the check ECore makes of a server part at load, for
 * a plugin's own tests (owner, Q11, 2026-11-06: every declared capability is implemented by at
 * least one part, and a part implements only declared ones):
 * <ul>
 *   <li>every declared id is known;
 *   <li>the {@code Plugin} class implements only declared capabilities;
 *   <li>a declared capability the class does not implement is a fault only for a manifest without
 *       a {@code web} part; otherwise the web part may implement it, which the shell reports.
 * </ul>
 *
 * <p>{@code assertMatches} reads the manifest file itself: that is the test kit's file read in a
 * test, not plugin file I/O, which ADR-0049 governs at runtime (the ACA's R3 on part 4).
 *
 * <pre>{@code
 * @Test
 * void declaresWhatItImplements() {
 *   CapabilityCheck.assertMatches(HistoryPlugin.class, Path.of("plugin.json"));
 * }
 * }</pre>
 */
public final class CapabilityCheck {

  private CapabilityCheck() {}

  /**
   * Fails with the reason ECore gives, which names each capability, when the manifest at {@code
   * manifest} and {@code pluginClass} do not agree.
   */
  public static void assertMatches(Class<?> pluginClass, Path manifest) {
    String problem = problem(pluginClass, read(manifest));
    if (problem != null) {
      throw new AssertionError(problem);
    }
  }

  /** The mismatch ECore would report for {@code pluginClass} and the manifest JSON, or {@code null}. */
  public static String problem(Class<?> pluginClass, JsonValue manifest) {
    var declared = EnumSet.noneOf(Capability.class);
    var unknown = new TreeSet<String>();
    if (manifest instanceof JsonObject o && o.get("capabilities") instanceof JsonArray list) {
      for (JsonValue v : list.values()) {
        String id = v instanceof JsonString s ? s.value() : String.valueOf(v);
        Capability.fromId(id).ifPresentOrElse(declared::add, () -> unknown.add(id));
      }
    }
    if (!unknown.isEmpty()) {
      return "unknown capability " + String.join(", ", unknown) + " (ADR-0044 point 5)";
    }
    Set<Capability> implemented = Capability.implementedBy(pluginClass);
    var notImplemented = EnumSet.copyOf(declared.isEmpty() ? EnumSet.noneOf(Capability.class) : declared);
    notImplemented.removeAll(implemented);
    var notDeclared = implemented.isEmpty() ? EnumSet.noneOf(Capability.class) : EnumSet.copyOf(implemented);
    notDeclared.removeAll(declared);
    boolean hasWeb = manifest instanceof JsonObject o && o.get("web") != null;
    if (!notImplemented.isEmpty() && !hasWeb) {
      return "capability " + ids(notImplemented) + " declared but not implemented by " + pluginClass.getName() + " (ADR-0044 point 4)";
    }
    if (!notDeclared.isEmpty()) {
      return "capability " + ids(notDeclared) + " implemented by " + pluginClass.getName() + " but not declared (ADR-0044 point 4)";
    }
    return null;
  }

  private static String ids(Set<Capability> set) {
    return String.join(", ", set.stream().map(Capability::id).toList());
  }

  private static JsonValue read(Path manifest) {
    try {
      return TestJson.parse(Files.readString(manifest, StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
