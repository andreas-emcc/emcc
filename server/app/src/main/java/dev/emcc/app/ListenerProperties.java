package dev.emcc.app;

import dev.emcc.ecore.plugin.ListenerConfig;
import dev.emcc.ecore.plugin.TlsCredentials;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * {@code emc2.listeners.*}: the settings of plugins' listeners (SDK v1). Its TLS credentials, {@code
 * emc2.listeners.credentials.<name>.*}, are <b>deprecated</b> (ADR-0062, M9 C3): they are still read, with a warning,
 * and {@code emc2.tls.<name>.*} ({@link TlsProperties}) wins where both name a credential. They go in a credentials
 * file only or environment variables, never in the repository:
 *
 * <pre>
 * emc2.listeners.credentials.tak-north.trust-store=C:/emc2/tls/tak-ca.p12
 * emc2.listeners.credentials.tak-north.trust-store-password=...
 * emc2.listeners.credentials.tak-north.key-store=C:/emc2/tls/emc2-client.p12      (if the server asks for a client certificate)
 * emc2.listeners.credentials.tak-north.key-store-password=...
 * </pre>
 *
 * <p>Incomplete credentials, or a store file that does not exist, stop the start, naming the
 * setting.
 *
 * @param maxPerPlugin the most listeners one plugin may have at a time
 * @param credentials the TLS credentials by the name a plugin's {@code ListenerSpec.tls} gives
 */
@ConfigurationProperties("emc2.listeners")
record ListenerProperties(@DefaultValue("100") int maxPerPlugin, @Nullable Map<String, Credentials> credentials) {

  /** One name's stores; the paths are files. */
  record Credentials(
      @Nullable String keyStore, @Nullable String keyStorePassword, @Nullable String trustStore, @Nullable String trustStorePassword) {

    /** Never shows the passwords. */
    @Override
    public String toString() {
      return "Credentials[keyStore=" + keyStore + ", trustStore=" + trustStore + ", passwords not shown]";
    }
  }

  /**
   * ECore's form of these settings, without other TLS credentials.
   *
   * @throws IllegalStateException naming the setting that is missing or wrong
   */
  ListenerConfig toConfig() {
    return toConfig(Map.of(), warning -> { });
  }

  /**
   * ECore's form of these settings, with the TLS credentials of {@code emc2.tls.*} (ADR-0062): those win as a whole
   * over the deprecated keys of the same name; each name read from the deprecated keys gets a warning.
   *
   * @throws IllegalStateException naming the setting that is missing or wrong
   */
  ListenerConfig toConfig(Map<String, TlsCredentials> named, java.util.function.Consumer<String> warn) {
    Map<String, TlsCredentials> all = new LinkedHashMap<>(named);
    if (credentials != null) {
      credentials.forEach((name, c) -> {
        if (named.containsKey(name)) {
          warn.accept("emc2.listeners.credentials." + name + ".* is deprecated and not used: emc2.tls." + name + ".* names the same "
              + "TLS credential and wins (ADR-0062)");
        } else {
          all.put(name, check(name, c));
          warn.accept("emc2.listeners.credentials." + name + ".* is deprecated: move it to emc2.tls." + name + ".* in "
              + "settings/credentials/tls-" + name + ".properties (ADR-0062, server/README.md)");
        }
      });
    }
    return new ListenerConfig(maxPerPlugin, all);
  }

  private static TlsCredentials check(String name, Credentials c) {
    String prefix = "emc2.listeners.credentials." + name + ".";
    Path trustStore = file(prefix + "trust-store", c.trustStore());
    if (c.trustStorePassword() == null) {
      throw new IllegalStateException(prefix + "trust-store-password is missing");
    }
    Path keyStore = null;
    if (c.keyStore() != null) {
      keyStore = file(prefix + "key-store", c.keyStore());
      if (c.keyStorePassword() == null) {
        throw new IllegalStateException(prefix + "key-store-password is missing");
      }
    }
    String setting = "emc2.listeners.credentials." + name;
    return new TlsCredentials(setting, new TlsCredentials.Store(trustStore, oldType(trustStore), c.trustStorePassword()),
        keyStore == null ? null : new TlsCredentials.KeyStoreIdentity(new TlsCredentials.Store(keyStore, oldType(keyStore), c.keyStorePassword())));
  }

  /** As before ADR-0062: a {@code .jks} file is JKS, any other PKCS #12. */
  private static TlsCredentials.StoreType oldType(Path file) {
    return file.getFileName().toString().toLowerCase(java.util.Locale.ROOT).endsWith(".jks") ? TlsCredentials.StoreType.JKS
        : TlsCredentials.StoreType.PKCS12;
  }

  private static Path file(String setting, @Nullable String value) {
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(setting + " is missing");
    }
    Path path = Path.of(value);
    if (!Files.isRegularFile(path)) {
      throw new IllegalStateException(setting + " is not a file: " + path.toAbsolutePath());
    }
    return path;
  }
}
