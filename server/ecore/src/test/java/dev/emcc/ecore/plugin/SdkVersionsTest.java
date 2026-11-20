package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;

class SdkVersionsTest {

  /** The cases ECore and the shell share (SDK v0 design, "Versioning"). */
  static Stream<Arguments> sharedCases() throws IOException {
    JsonNode cases = new ModelJson().parse(Files.readString(Path.of("../../model/examples/sdk-version-matching.json")));
    List<Arguments> arguments = new ArrayList<>();
    cases.get("cases").forEach(c ->
        arguments.add(Arguments.of(c.get("range").asString(), c.get("sdk").asString(), c.get("compatible").booleanValue())));
    assertThat(arguments).hasSizeGreaterThan(15);
    return arguments.stream();
  }

  @ParameterizedTest(name = "{0} with SDK {1}: {2}")
  @MethodSource("sharedCases")
  void matchesLikeTheShell(String range, String sdk, boolean compatible) {
    assertThat(SdkVersions.compatible(range, sdk)).isEqualTo(compatible);
  }

  @Test
  void ecoreImplementsTheSdkItIsBuiltAgainst() {
    assertThat(SdkVersions.SDK_VERSION).isEqualTo(dev.emcc.sdk.Sdk.VERSION).isEqualTo("1.9.0");
    assertThat(SdkVersions.compatible("^1.0.0", SdkVersions.SDK_VERSION)).isTrue();
    assertThat(SdkVersions.compatible("^0.1.0", SdkVersions.SDK_VERSION)).as("a plugin for SDK v0 (CR-0005)").isFalse();
    assertThat(SdkVersions.compatible("^1.1.0", SdkVersions.SDK_VERSION)).as("a plugin for SDK 1.1.0").isTrue();
    assertThat(SdkVersions.compatible("^1.2.0", SdkVersions.SDK_VERSION)).as("a plugin for SDK 1.2.0").isTrue();
    assertThat(SdkVersions.compatible("^1.6.0", SdkVersions.SDK_VERSION)).as("a plugin for SDK 1.6.0").isTrue();
    assertThat(SdkVersions.compatible("^1.7.0", SdkVersions.SDK_VERSION)).as("a plugin for SDK 1.7.0").isTrue();
    assertThat(SdkVersions.compatible("^1.8.0", SdkVersions.SDK_VERSION)).as("a plugin for SDK 1.8.0").isTrue();
    assertThat(SdkVersions.compatible("^1.9.0", SdkVersions.SDK_VERSION)).as("a plugin for SDK 1.9.0").isTrue();
    assertThat(SdkVersions.compatible("^1.10.0", SdkVersions.SDK_VERSION)).isFalse();
  }

  @Test
  void prereleasesCompareByTheirIdentifiers() {
    assertThat(SdkVersions.compatible(">=1.0.0-rc.2", "1.0.0")).isTrue();
    assertThat(SdkVersions.Version.parse("1.0.0-rc.2")).isLessThan(SdkVersions.Version.parse("1.0.0-rc.10"));
    assertThat(SdkVersions.Version.parse("1.0.0-1")).isLessThan(SdkVersions.Version.parse("1.0.0-alpha"));
    assertThat(SdkVersions.Version.parse("1.0.0-alpha")).isLessThan(SdkVersions.Version.parse("1.0.0-alpha.1"));
    assertThat(SdkVersions.Version.parse("1.0.0-alpha.1")).isLessThan(SdkVersions.Version.parse("1.0.0"));
  }

  @Test
  void malformedVersionsAreRefused() {
    assertThatThrownBy(() -> SdkVersions.compatible("^1.0", "1.0.0")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> SdkVersions.compatible("^1.0.0", "v1.0.0")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> SdkVersions.compatible("<2.0.0", "1.0.0")).isInstanceOf(IllegalArgumentException.class);
  }
}
