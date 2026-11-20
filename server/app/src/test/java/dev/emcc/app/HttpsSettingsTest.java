package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

/** The MCA's release check: a missing key store is named in the server's words, not Spring's "Unable to register". */
class HttpsSettingsTest {

  @TempDir Path folder;

  StandardEnvironment environment(Map<String, Object> settings) {
    StandardEnvironment e = new StandardEnvironment();
    e.getPropertySources().addFirst(new MapPropertySource("settings: settings/credentials/https.properties", settings));
    return e;
  }

  @Test
  void aMissingKeyStoreStopsTheStartNamingTheSettingTheFileAndThePath() {
    Path missing = folder.resolve("server.p12");
    StandardEnvironment e = environment(Map.of("spring.ssl.bundle.jks.emcc.keystore.location", missing.toString(),
        "spring.ssl.bundle.jks.emcc.keystore.password", "not-shown"));
    assertThatIllegalStateException().isThrownBy(() -> new HttpsSettings().postProcessEnvironment(e, new SpringApplication()))
        .withMessageContaining("spring.ssl.bundle.jks.emcc.keystore.location")
        .withMessageContaining("settings/credentials/https.properties")
        .withMessageContaining(missing.toAbsolutePath().toString())
        .withMessageNotContaining("not-shown");
  }

  @Test
  void aMissingPemFileToo() throws IOException {
    Path certificate = Files.writeString(folder.resolve("server.crt"), "x");
    StandardEnvironment e = environment(Map.of("spring.ssl.bundle.pem.emcc.keystore.certificate", "file:" + certificate,
        "spring.ssl.bundle.pem.emcc.keystore.private-key", "file:" + folder.resolve("server.key")));
    assertThatIllegalStateException().isThrownBy(() -> new HttpsSettings().postProcessEnvironment(e, new SpringApplication()))
        .withMessageContaining("spring.ssl.bundle.pem.emcc.keystore.private-key").withMessageContaining("server.key");
  }

  @Test
  void anExistingFileAndOtherResourcesPass() throws IOException {
    Path store = Files.writeString(folder.resolve("server.p12"), "x");
    StandardEnvironment e = environment(Map.of("spring.ssl.bundle.jks.emcc.keystore.location", store.toUri().toString()));
    new HttpsSettings().postProcessEnvironment(e, new SpringApplication());
    assertThat(e.getProperty("server.ssl.bundle")).isEqualTo("emcc");
    assertThat(HttpsSettings.localFile("classpath:server.p12")).isNull();
    assertThat(HttpsSettings.localFile("-----BEGIN CERTIFICATE-----")).isNull();
    assertThat(HttpsSettings.localFile("C:\\emcc\\server.p12")).isNotNull();
    assertThat(HttpsSettings.localFile("file:target/server.p12")).isEqualTo(Path.of("target/server.p12"));
    assertThat(HttpsSettings.localFile("http://example.org/server.p12")).isNull();
    if (System.getProperty("os.name").startsWith("Windows")) {
      assertThat(HttpsSettings.localFile("file:///C:/emcc/server.p12")).isEqualTo(Path.of("C:", "emcc", "server.p12"));
    }
  }
}
