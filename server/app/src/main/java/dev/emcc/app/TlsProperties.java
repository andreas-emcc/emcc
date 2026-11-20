package dev.emcc.app;

import dev.emcc.ecore.plugin.TlsCredentials;
import dev.emcc.ecore.plugin.TlsCredentials.StoreType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code emc2.tls.<name>.*}: the TLS credentials by name (ADR-0062, M9 C3), one file each, {@code
 * settings/credentials/tls-<name>.properties} (ADR-0060), never in the repository:
 *
 * <pre>
 * emc2.tls.tak-north.trust-store=%emcc%/settings/credentials/tak-ca.pem
 * emc2.tls.tak-north.key-store-type=PEM                       (a PEM identity: the certificate chain and its key)
 * emc2.tls.tak-north.certificate=%emcc%/settings/credentials/emcc-client.pem
 * emc2.tls.tak-north.private-key=%emcc%/settings/credentials/emcc-client.key
 * emc2.tls.tak-north.private-key-password=...                 (only if the key is encrypted)
 * </pre>
 *
 * <p>or with PKCS #12 or JKS stores: {@code trust-store} and {@code trust-store-password}, {@code key-store} and {@code
 * key-store-password}. A store's type ({@code trust-store-type}, {@code key-store-type}: {@code PKCS12}, {@code JKS} or
 * {@code PEM}) goes by the file's extension when it is not set ({@code .jks}; {@code .pem}, {@code .crt}, {@code .cer};
 * else PKCS #12). A PEM trust store has no password. The identity is needed only where the peer asks for a client
 * certificate.
 *
 * <p>A missing key, a wrong type or a file that does not exist stops the start, naming the setting. A file that cannot
 * be read (a wrong password, a broken PEM) does not: the Monitor and the link that uses it say why (owner, C3).
 */
@ConfigurationProperties("emc2")
record TlsProperties(@Nullable Map<String, Credential> tls) {

  /** One name's keys. */
  record Credential(
      @Nullable String trustStore, @Nullable String trustStoreType, @Nullable String trustStorePassword,
      @Nullable String keyStore, @Nullable String keyStoreType, @Nullable String keyStorePassword,
      @Nullable String certificate, @Nullable String privateKey, @Nullable String privateKeyPassword) {

    /** Never shows the passwords. */
    @Override
    public String toString() {
      return "Credential[trustStore=" + trustStore + ", keyStore=" + keyStore + ", certificate=" + certificate + ", privateKey="
          + privateKey + ", passwords not shown]";
    }
  }

  /**
   * ECore's form, by name.
   *
   * @throws IllegalStateException naming the setting that is missing or wrong
   */
  Map<String, TlsCredentials> credentials() {
    Map<String, TlsCredentials> all = new LinkedHashMap<>();
    if (tls != null) {
      tls.forEach((name, c) -> all.put(name, check(name, c)));
    }
    return all;
  }

  private static TlsCredentials check(String name, Credential c) {
    String prefix = "emc2.tls." + name;
    Path trustFile = file(prefix + ".trust-store", c.trustStore());
    StoreType trustType = type(prefix + ".trust-store-type", c.trustStoreType(), trustFile);
    if (trustType != StoreType.PEM && c.trustStorePassword() == null) {
      throw new IllegalStateException(prefix + ".trust-store-password is missing");
    }
    TlsCredentials.Store trust = new TlsCredentials.Store(trustFile, trustType, trustType == StoreType.PEM ? null : c.trustStorePassword());

    TlsCredentials.Identity identity = null;
    boolean pem = c.certificate() != null || c.privateKey() != null
        || (c.keyStoreType() != null && c.keyStoreType().strip().equalsIgnoreCase("PEM"));
    if (pem) {
      if (c.keyStore() != null) {
        throw new IllegalStateException(prefix + ".key-store is for PKCS12 and JKS: a PEM identity is " + prefix + ".certificate and "
            + prefix + ".private-key");
      }
      if (c.keyStoreType() != null && !c.keyStoreType().strip().equalsIgnoreCase("PEM")) {
        throw new IllegalStateException(prefix + ".certificate and .private-key are a PEM identity, but " + prefix + ".key-store-type is "
            + c.keyStoreType());
      }
      identity = new TlsCredentials.PemIdentity(file(prefix + ".certificate", c.certificate()), file(prefix + ".private-key", c.privateKey()),
          c.privateKeyPassword());
    } else if (c.keyStore() != null) {
      Path keyFile = file(prefix + ".key-store", c.keyStore());
      StoreType keyType = type(prefix + ".key-store-type", c.keyStoreType(), keyFile);
      if (keyType == StoreType.PEM) {
        throw new IllegalStateException(prefix + ".key-store is a PEM file: a PEM identity is " + prefix + ".certificate and " + prefix
            + ".private-key");
      }
      if (c.keyStorePassword() == null) {
        throw new IllegalStateException(prefix + ".key-store-password is missing");
      }
      identity = new TlsCredentials.KeyStoreIdentity(new TlsCredentials.Store(keyFile, keyType, c.keyStorePassword()));
    }
    return new TlsCredentials(prefix, trust, identity);
  }

  private static StoreType type(String setting, @Nullable String value, Path file) {
    if (value == null || value.isBlank()) {
      return StoreType.byExtension(file);
    }
    try {
      return StoreType.valueOf(value.strip().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException(setting + " must be PKCS12, JKS or PEM: " + value, e);
    }
  }

  /** A file that exists; the path as the settings files resolved it ({@code %emcc%/}). */
  static Path file(String setting, @Nullable String value) {
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(setting + " is missing");
    }
    Path path = Path.of(value.strip());
    if (!Files.isRegularFile(path)) {
      throw new IllegalStateException(setting + " is not a file: " + path.toAbsolutePath());
    }
    return path;
  }
}
