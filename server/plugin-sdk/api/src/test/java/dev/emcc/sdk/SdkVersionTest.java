package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** One SDK version everywhere (CR-0005): the Java constant, the web SDK and the Maven artifact. */
class SdkVersionTest {

  /** Surefire runs in the module folder, server/plugin-sdk/api. */
  static final Path WEB_SDK_VERSION = Path.of("../../../web/plugin-sdk/src/version.ts");

  @Test
  void equalsTheWebSdkVersion() throws IOException {
    var m = Pattern.compile("export const SDK_VERSION = '([^']+)';").matcher(Files.readString(WEB_SDK_VERSION));
    assertThat(m.find()).as("SDK_VERSION in " + WEB_SDK_VERSION).isTrue();
    assertThat(Sdk.VERSION).isEqualTo(m.group(1));
  }

  @Test
  void equalsTheMavenVersionWithoutSnapshot() throws IOException {
    var properties = new Properties();
    try (InputStream in = SdkVersionTest.class.getResourceAsStream("/sdk-build.properties")) {
      assertThat(in).as("sdk-build.properties, filtered by Maven").isNotNull();
      properties.load(in);
    }
    assertThat(properties.getProperty("version")).isNotEqualTo("${project.version}");
    assertThat(Sdk.VERSION).isEqualTo(properties.getProperty("version").replaceFirst("-SNAPSHOT$", ""));
  }
}
