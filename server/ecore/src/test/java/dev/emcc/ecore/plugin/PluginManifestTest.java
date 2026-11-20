package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class PluginManifestTest {

  private static final ModelJson JSON = new ModelJson();
  private static final Path EXAMPLES = Path.of("../../model/examples");

  @Test
  void readsTheCategoryAndNoneWhenTheManifestNamesNone() { // data model 1.6.0, CR-0041 part F
    assertThat(PluginManifest.read(EXAMPLES.resolve("valid/manifest-category-and-colour.json"), JSON).category()).isNotNull()
        .isIn("data-links", "geometoc", "map-and-symbols", "drawing", "simulation", "general");
    assertThat(PluginManifest.read(EXAMPLES.resolve("valid/manifest-basemap-osm.json"), JSON).category()).isNull();
  }

  @Test
  void readsTheIconAsWrittenAndNoneWhenTheManifestNamesNone() { // SDK 1.8.0, CR-0043 part D
    assertThat(PluginManifest.read(EXAMPLES.resolve("valid/manifest-settings-form-hints.json"), JSON).icon()).isEqualTo("Radar");
    assertThat(PluginManifest.read(EXAMPLES.resolve("valid/manifest-basemap-osm.json"), JSON).icon()).isNull();
  }

  @Test
  void readsTheExampleManifestWithItsSettingDefaults() {
    PluginManifest m = PluginManifest.read(EXAMPLES.resolve("valid/manifest-basemap-osm.json"), JSON);

    assertThat(m.id()).isEqualTo("basemap-osm");
    assertThat(m.sdkVersion()).isEqualTo("^1.0.0");
    assertThat(m.kind()).isEqualTo("background-map");
    assertThat(m.provides()).containsExactly("emc2.background-map");
    assertThat(m.internet()).isNotNull();
    assertThat(m.internet().hosts()).containsExactly("tile.openstreetmap.org");
    assertThat(m.internet().reason()).startsWith("Fetches OpenStreetMap tiles.");
    assertThat(m.entryClass()).isEqualTo("dev.emcc.plugins.basemaposm.BasemapOsmPlugin");
    assertThat(m.required()).isFalse();
    assertThat(m.web()).isNotNull();
    assertThat(m.web().entry()).isEqualTo("index.js");
    assertThat(m.web().shared()).containsEntry("react", "19.3.0");
    assertThat(m.settings().getString("upstreamUrl")).isEqualTo("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    assertThat(m.settings().getNumber("maxZoom").bigDecimalValue()).isEqualByComparingTo("19");
    assertThat(m.settings().names()).containsExactly("upstreamUrl", "maxZoom", "cacheTiles", "upstreamTimeoutSeconds");
  }

  @Test
  void readsTheDeclaredConnections() {
    PluginManifest m = PluginManifest.read(EXAMPLES.resolve("valid/manifest-connections.json"), JSON);

    assertThat(m.connections()).singleElement().satisfies(c -> {
      assertThat(c.kinds()).containsExactly("tcp-client", "udp", "multicast");
      assertThat(c.direction()).isEqualTo("both");
      assertThat(c.settings()).isEqualTo("/links");
      assertThat(c.reason()).startsWith("CoT to and from TAK Servers");
    });
    assertThat(PluginManifest.read(EXAMPLES.resolve("valid/manifest-basemap-osm.json"), JSON).connections()).isEmpty();
  }

  static Stream<Path> invalidManifests() throws IOException {
    try (Stream<Path> files = Files.list(EXAMPLES.resolve("invalid"))) {
      List<Path> manifests = files.filter(f -> f.getFileName().toString().startsWith("manifest-")).sorted().toList();
      assertThat(manifests).isNotEmpty();
      return manifests.stream();
    }
  }

  @ParameterizedTest
  @MethodSource("invalidManifests")
  void refusesTheInvalidExamples(Path file) {
    assertThatThrownBy(() -> PluginManifest.read(file, JSON)).isInstanceOf(InvalidDocumentException.class);
  }

  @Test
  void aMinimalWebOnlyManifestHasNoServerPartAndNoSettings(@org.junit.jupiter.api.io.TempDir Path dir) throws IOException {
    Path file = dir.resolve("plugin.json");
    Files.writeString(file, """
        {"id": "coordinates", "name": "Coordinates", "version": "0.1.0", "sdkVersion": "^1.0.0",
         "kind": "utility", "web": {"entry": "index.js"}}
        """);

    PluginManifest m = PluginManifest.read(file, JSON);

    assertThat(m.entryClass()).isNull();
    assertThat(m.settings().isEmpty()).isTrue();
    assertThat(m.dependsOn()).isEmpty();
    assertThat(m.web()).isEqualTo(new PluginManifest.WebPart("index.js", List.of(), Map.of()));
  }
}
