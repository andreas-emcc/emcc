package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * M9, D3 (gap G1): the stand-alone plugin parent ({@code plugin-sdk/plugin-parent/pom.xml}) repeats
 * server/pom.xml's versions, since it inherits nothing. This keeps them equal, and its SDK version
 * the SDK's. It reads the POMs from the repository, so it runs only there, which is where they can
 * drift.
 */
class ParentPomTest {

  /** The properties both POMs pin, which must be equal. */
  private static final List<String> SHARED =
      List.of(
          "maven.compiler.release",
          "slf4j.version",
          "jspecify.version",
          "junit.version",
          "assertj.version",
          "archunit.version",
          "maven-enforcer-plugin.version",
          "maven-clean-plugin.version",
          "maven-resources-plugin.version",
          "maven-compiler-plugin.version",
          "maven-surefire-plugin.version",
          "maven-jar-plugin.version",
          "maven-install-plugin.version",
          "maven-deploy-plugin.version",
          "maven-site-plugin.version");

  private static String read(String path) throws IOException {
    return Files.readString(Path.of(path)); // the test runs in the test kit's module folder
  }

  private static String property(String pom, String name) {
    Matcher m = Pattern.compile("<" + Pattern.quote(name) + ">([^<]+)</" + Pattern.quote(name) + ">").matcher(pom);
    assertThat(m.find()).as(name).isTrue();
    return m.group(1).trim();
  }

  /** The first {@code <version>} after the project's own {@code <artifactId>}. */
  private static String projectVersion(String pom, String artifactId) {
    Matcher m = Pattern.compile("<artifactId>" + Pattern.quote(artifactId) + "</artifactId>\\s*(?:<!--.*?-->\\s*)*<version>([^<]+)</version>", Pattern.DOTALL).matcher(pom);
    assertThat(m.find()).as(artifactId).isTrue();
    return m.group(1).trim();
  }

  @Test
  void thePluginParentPinsWhatTheServerPins() throws IOException {
    String server = read("../../pom.xml");
    String parent = read("../plugin-parent/pom.xml");
    for (String name : SHARED) {
      assertThat(property(parent, name)).as(name).isEqualTo(property(server, name));
    }
  }

  @Test
  void itsVersionAndItsSdkAreTheSdks() throws IOException {
    String sdk = projectVersion(read("../pom.xml"), "emc2-plugin-sdk-parent");
    String parent = read("../plugin-parent/pom.xml");
    assertThat(projectVersion(parent, "emc2-plugin-parent")).isEqualTo(sdk);
    assertThat(property(parent, "emcc.sdk.version")).isEqualTo(sdk);
    assertThat(parent).doesNotContain("<parent>");
    // and server/pom.xml manages the same SDK and test kit for ECore and the repository's plugins
    String server = read("../../pom.xml");
    assertThat(projectVersion(server, "emc2-plugin-sdk")).isEqualTo(sdk);
    assertThat(projectVersion(server, "emc2-plugin-sdk-testkit")).isEqualTo(sdk);
  }
}
