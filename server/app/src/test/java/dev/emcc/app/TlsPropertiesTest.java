package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.plugin.ListenerConfig;
import dev.emcc.ecore.plugin.TlsCredentials;
import dev.emcc.ecore.plugin.TlsCredentials.StoreType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** ADR-0062 (M9 C3): {@code emc2.tls.<name>.*}, its checks at start, and the deprecated keys beside it. */
class TlsPropertiesTest {

  @TempDir Path dir;

  private static TlsProperties.Credential credential(String trust, String trustType, String trustPassword, String keyStore, String keyType,
      String keyPassword, String certificate, String privateKey) {
    return new TlsProperties.Credential(trust, trustType, trustPassword, keyStore, keyType, keyPassword, certificate, privateKey, null);
  }

  @Test
  void bindsStoresWithTheirTypesAndAPemIdentity() throws Exception {
    String ca = file("ca.pem");
    String p12 = file("client.p12");
    String jks = file("trust.jks");
    Map<String, TlsCredentials> read = new TlsProperties(Map.of(
        "pem", credential(ca, null, null, null, "pem", null, file("client.crt"), file("client.key")),
        "stores", credential(jks, null, "x", p12, null, "y", null, null),
        "typed", credential(file("ca.bin"), "PEM", null, null, null, null, null, null))).credentials();

    assertThat(read.get("pem").trust().type()).isEqualTo(StoreType.PEM);
    assertThat(read.get("pem").identity()).isInstanceOf(TlsCredentials.PemIdentity.class);
    assertThat(read.get("pem").setting()).isEqualTo("emc2.tls.pem");
    assertThat(read.get("stores").trust().type()).isEqualTo(StoreType.JKS);
    assertThat(((TlsCredentials.KeyStoreIdentity) read.get("stores").identity()).store().type()).isEqualTo(StoreType.PKCS12);
    assertThat(read.get("typed").trust().type()).as("the type set wins over the extension").isEqualTo(StoreType.PEM);
  }

  @Test
  void aMissingKeyAWrongTypeOrAFileThatDoesNotExistStopsTheStart() throws Exception {
    String ca = file("ca.pem");
    String p12 = file("client.p12");
    assertThat(stop(credential(null, null, null, null, null, null, null, null))).isEqualTo("emc2.tls.t.trust-store is missing");
    assertThat(stop(credential(p12, null, null, null, null, null, null, null))).isEqualTo("emc2.tls.t.trust-store-password is missing");
    assertThat(stop(credential(ca, "DER", null, null, null, null, null, null))).isEqualTo("emc2.tls.t.trust-store-type must be PKCS12, JKS or PEM: DER");
    assertThat(stop(credential(dir.resolve("gone.pem").toString(), null, null, null, null, null, null, null)))
        .startsWith("emc2.tls.t.trust-store is not a file: ");
    assertThat(stop(credential(ca, null, null, p12, null, null, null, null))).isEqualTo("emc2.tls.t.key-store-password is missing");
    assertThat(stop(credential(ca, null, null, ca, null, "x", null, null)))
        .isEqualTo("emc2.tls.t.key-store is a PEM file: a PEM identity is emc2.tls.t.certificate and emc2.tls.t.private-key");
    assertThat(stop(credential(ca, null, null, null, "PEM", null, ca, null))).isEqualTo("emc2.tls.t.private-key is missing");
    assertThat(stop(credential(ca, null, null, null, "PEM", null, null, ca))).isEqualTo("emc2.tls.t.certificate is missing");
    assertThat(stop(credential(ca, null, null, null, "PKCS12", null, ca, ca)))
        .isEqualTo("emc2.tls.t.certificate and .private-key are a PEM identity, but emc2.tls.t.key-store-type is PKCS12");
  }

  @Test
  void theDeprecatedKeysAreReadWithAWarningAndTheNewOnesWinAsAWhole() throws Exception {
    String p12 = file("trust.p12");
    TlsCredentials named = new TlsProperties(Map.of("both", credential(file("ca.pem"), null, null, null, null, null, null, null))).credentials()
        .get("both");
    ListenerProperties old = new ListenerProperties(100, Map.of(
        "both", new ListenerProperties.Credentials(null, null, p12, "x"),
        "old", new ListenerProperties.Credentials(null, null, p12, "x")));
    List<String> warnings = new ArrayList<>();

    ListenerConfig config = old.toConfig(Map.of("both", named), warnings::add);

    assertThat(config.credentials().get("both")).isSameAs(named);
    assertThat(config.credentials().get("old").setting()).isEqualTo("emc2.listeners.credentials.old");
    assertThat(warnings).containsExactlyInAnyOrder(
        "emc2.listeners.credentials.both.* is deprecated and not used: emc2.tls.both.* names the same TLS credential and wins (ADR-0062)",
        "emc2.listeners.credentials.old.* is deprecated: move it to emc2.tls.old.* in settings/credentials/tls-old.properties (ADR-0062, "
            + "server/README.md)");
  }

  private static String stop(TlsProperties.Credential c) {
    Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> new TlsProperties(Map.of("t", c)).credentials());
    assertThat(thrown).isInstanceOf(IllegalStateException.class);
    return thrown.getMessage();
  }

  private String file(String name) throws Exception {
    return Files.writeString(dir.resolve(name), "not read here").toString();
  }
}
