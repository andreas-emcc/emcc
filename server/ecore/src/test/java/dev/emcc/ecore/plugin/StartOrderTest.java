package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonObject;
import java.util.List;
import org.junit.jupiter.api.Test;

class StartOrderTest {

  static PluginManifest manifest(String id, List<String> dependsOn, List<String> provides, List<String> requires) {
    return PluginManifest.of(id, id, "0.1.0", "^1.0.0", "general", dependsOn, provides, requires, false, null,
        null, null, JsonObject.empty());
  }

  private static PluginManifest dependsOn(String id, String... ids) {
    return manifest(id, List.of(ids), List.of(), List.of());
  }

  private static List<String> ids(StartOrder order) {
    return order.order().stream().map(PluginManifest::id).toList();
  }

  @Test
  void dependenciesStartFirstAndTiesGoById() {
    StartOrder order = StartOrder.of(List.of(dependsOn("c", "a"), dependsOn("b"), dependsOn("a"), dependsOn("d", "c", "b")));

    assertThat(ids(order)).containsExactly("a", "b", "c", "d");
    assertThat(order.rejected()).isEmpty();
  }

  @Test
  void providersOfRequiredServicesStartFirst() {
    PluginManifest map = manifest("map-view-2d", List.of(), List.of("emc2.map-view"), List.of("emc2.background-map"));
    PluginManifest osm = manifest("basemap-osm", List.of(), List.of("emc2.background-map"), List.of());
    PluginManifest draw = manifest("draw-symbols", List.of(), List.of(), List.of("emc2.map-view"));

    assertThat(ids(StartOrder.of(List.of(draw, map, osm)))).containsExactly("basemap-osm", "map-view-2d", "draw-symbols");
  }

  @Test
  void aMissingDependencyRejectsThePluginAndItsDependents() {
    StartOrder order = StartOrder.of(List.of(dependsOn("a", "gone"), dependsOn("b", "a"), dependsOn("c")));

    assertThat(ids(order)).containsExactly("c");
    assertThat(order.rejected()).containsEntry("a", "depends on gone, which is not installed")
        .containsEntry("b", "depends on a, which is left out");
  }

  /** A manifest with {@code uses}, read as ECore reads one. */
  private static PluginManifest using(java.nio.file.Path dir, String id, List<String> provides, List<String> uses) throws Exception {
    java.nio.file.Path file = dir.resolve(id + ".json");
    String quoted = "[" + String.join(",", provides.stream().map(k -> "\"" + k + "\"").toList()) + "]";
    String usedQuoted = "[" + String.join(",", uses.stream().map(k -> "\"" + k + "\"").toList()) + "]";
    java.nio.file.Files.writeString(file, "{\"id\":\"" + id + "\",\"name\":\"" + id + "\",\"version\":\"0.1.0\",\"sdkVersion\":\"^1.0.0\","
        + "\"kind\":\"general\",\"server\":{\"entryClass\":\"x.Plugin\"},\"provides\":" + quoted + ",\"uses\":" + usedQuoted + "}");
    return PluginManifest.read(file, new dev.emcc.ecore.json.ModelJson());
  }

  @Test
  void providersOfUsedServicesStartFirstAndACycleThroughUsesRejectsAsTheShellDoes(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir)
      throws Exception { // the PDA's D4 review; owner: as plan.ts
    PluginManifest map = using(dir, "map-view-2d", List.of("emc2.map-view"), List.of("emc2.symbols"));
    PluginManifest symbology = manifest("symbology", List.of(), List.of("emc2.symbols"), List.of());
    PluginManifest lonely = using(dir, "lonely", List.of(), List.of("emc2.nobody"));
    assertThat(ids(StartOrder.of(List.of(map, symbology, lonely)))).as("a missing provider of a used key is no reason")
        .containsExactly("lonely", "symbology", "map-view-2d");

    PluginManifest a = using(dir, "a", List.of("emc2.a"), List.of("emc2.b"));
    PluginManifest b = manifest("b", List.of(), List.of("emc2.b"), List.of("emc2.a"));
    StartOrder cycle = StartOrder.of(List.of(a, b, symbology));
    assertThat(ids(cycle)).containsExactly("symbology");
    assertThat(cycle.rejected().get("a")).isEqualTo("part of a cycle of dependsOn, requires and uses among [a, b]");

    // Only the cycle's members are refused; one that only uses a key of theirs, or lists itself, starts (as plan.ts)
    PluginManifest user = using(dir, "user", List.of(), List.of("emc2.a"));
    PluginManifest self = dependsOn("self", "self");
    StartOrder behind = StartOrder.of(List.of(a, b, user, self));
    assertThat(behind.rejected()).containsOnlyKeys("a", "b");
    assertThat(ids(behind)).containsExactly("self", "user");
  }

  @Test
  void aCycleRejectsItsMembersAndTheirDependentsButNotTheOthers() {
    PluginManifest a = manifest("a", List.of("b"), List.of(), List.of());
    PluginManifest b = manifest("b", List.of(), List.of("emc2.x"), List.of("emc2.y"));
    PluginManifest c = manifest("c", List.of(), List.of("emc2.y"), List.of());
    PluginManifest d = manifest("d", List.of("a"), List.of(), List.of());
    PluginManifest loop = manifest("loop", List.of(), List.of("emc2.y"), List.of("emc2.x")); // b needs y, loop needs x
    StartOrder order = StartOrder.of(List.of(a, b, c, d, loop));

    assertThat(ids(order)).containsExactly("c");
    assertThat(order.rejected()).containsOnlyKeys("a", "b", "d", "loop");
    assertThat(order.rejected().get("b")).contains("cycle");
  }
}
