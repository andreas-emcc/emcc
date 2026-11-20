package dev.emcc.ecore.plugin;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.CertificateExpiredException;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import org.jspecify.annotations.Nullable;

/**
 * One TLS credential (ADR-0062, M9 C3; ADR-0036 point 5), for listeners' TLS connections (SDK v1 {@code
 * Transport.Tls}) and connection tasks' ({@code TaskContext.tls}, SDK 1.2.0), shared by name (owner, 2026-10-24). From
 * local server configuration only, {@code emc2.tls.<name>.*} in {@code settings/credentials/tls-<name>.properties}
 * (or the deprecated {@code emc2.listeners.credentials.<name>.*}); never in the repository, the plugin's settings, or
 * the plugin's hands.
 *
 * <p>The trust store is required; the identity (the client's certificate and key) only where the peer asks for one.
 * A store is PKCS #12, JKS or PEM; a PEM identity is a certificate chain and a private key in their own files.
 *
 * <p>The files are read once, on first use or when the Monitor first asks ({@link #read()}; ADR-0062 point 5: a
 * changed credential needs a restart). A credential that cannot be read is no reason to stop the server (owner, C3):
 * it says why, in the Monitor and to the task that asks for it.
 */
public final class TlsCredentials {

  /** A store's type ({@code .trust-store-type}, {@code .key-store-type}). */
  public enum StoreType {
    PKCS12, JKS, PEM;

    /** By the file's extension, when the type is not set: {@code .jks}, {@code .pem}/{@code .crt}/{@code .cer}, else PKCS #12. */
    public static StoreType byExtension(Path file) {
      String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
      if (name.endsWith(".jks")) {
        return JKS;
      }
      return name.endsWith(".pem") || name.endsWith(".crt") || name.endsWith(".cer") ? PEM : PKCS12;
    }
  }

  /**
   * A store. A PEM trust store is a file of CA certificates without a password; the others need theirs.
   *
   * @param password null only for PEM
   */
  public record Store(Path file, StoreType type, @Nullable String password) {
    public Store {
      Objects.requireNonNull(file, "file");
      Objects.requireNonNull(type, "type");
    }

    @Override
    public String toString() {
      return "Store[" + file + ", " + type + "]";
    }
  }

  /** The client's certificate and private key: a key store, or PEM files. */
  public sealed interface Identity permits KeyStoreIdentity, PemIdentity {}

  /** A PKCS #12 or JKS key store with its password; its first key entry is the identity. */
  public record KeyStoreIdentity(Store store) implements Identity {
    public KeyStoreIdentity {
      if (store.type() == StoreType.PEM || store.password() == null) {
        throw new IllegalArgumentException("a key store is PKCS #12 or JKS, with its password");
      }
    }
  }

  /**
   * A PEM certificate chain (the client's certificate first) and its private key.
   *
   * @param keyPassword the key's password, if it is encrypted
   */
  public record PemIdentity(Path certificate, Path privateKey, @Nullable String keyPassword) implements Identity {
    public PemIdentity {
      Objects.requireNonNull(certificate, "certificate");
      Objects.requireNonNull(privateKey, "privateKey");
    }

    @Override
    public String toString() {
      return "PemIdentity[" + certificate + ", " + privateKey + "]";
    }
  }

  /** What reading the files gave. */
  public sealed interface Read permits Usable, Unreadable {}

  /**
   * @param identity the client's chain, its own certificate first; empty without an identity
   * @param trusted the trust store's certificates
   */
  public record Usable(SSLContext context, List<X509Certificate> identity, List<X509Certificate> trusted) implements Read {
    public Usable {
      identity = List.copyOf(identity);
      trusted = List.copyOf(trusted);
    }
  }

  /** @param reason why, naming the setting or the file; never a password */
  public record Unreadable(String reason) implements Read {}

  private final String setting;
  private final Store trust;
  private final @Nullable Identity identity;
  private volatile @Nullable Read read;
  /** A leaf lock (rule C4): only the files are read under it; private, so nothing else can take it. */
  private final Object lock = new Object();

  /** ADR-0062 point 4: a certificate within this many days of its expiry is marked, in the Monitor and the log. */
  public static final int EXPIRY_WARNING_DAYS = 30;

  /**
   * @param setting the keys' prefix, for messages: {@code emc2.tls.<name>} or {@code emc2.listeners.credentials.<name>}
   */
  public TlsCredentials(String setting, Store trust, @Nullable Identity identity) {
    this.setting = Objects.requireNonNull(setting, "setting");
    this.trust = Objects.requireNonNull(trust, "trust");
    if (trust.type() != StoreType.PEM && trust.password() == null) {
      throw new IllegalArgumentException("a trust store of type " + trust.type() + " needs its password");
    }
    this.identity = identity;
  }

  /** As before ADR-0062: PKCS #12 or JKS stores by extension, each with its password. */
  public TlsCredentials(@Nullable Path keyStore, @Nullable String keyStorePassword, Path trustStore, String trustStorePassword) {
    this("emc2.tls.(unnamed)", new Store(trustStore, byExtensionNotPem(trustStore), Objects.requireNonNull(trustStorePassword, "trustStorePassword")),
        keyStore == null ? null : new KeyStoreIdentity(new Store(keyStore, byExtensionNotPem(keyStore), requirePassword(keyStorePassword))));
  }

  private static StoreType byExtensionNotPem(Path file) {
    return StoreType.byExtension(file) == StoreType.JKS ? StoreType.JKS : StoreType.PKCS12;
  }

  private static String requirePassword(@Nullable String password) {
    if (password == null) {
      throw new IllegalArgumentException("a key store needs its password");
    }
    return password;
  }

  /** The keys' prefix this credential was read from. */
  public String setting() {
    return setting;
  }

  public Store trust() {
    return trust;
  }

  public @Nullable Identity identity() {
    return identity;
  }

  /** The files, read once; later calls give the same answer. */
  public Read read() {
    Read known = read;
    if (known != null) {
      return known;
    }
    synchronized (lock) {
      if (read == null) {
        read = readNow();
      }
      return Objects.requireNonNull(read);
    }
  }

  /**
   * The SSL context, for a connection now.
   *
   * @throws CertificateExpiredException if the identity's certificate has expired (ADR-0062 point 4)
   * @throws GeneralSecurityException if the files cannot be read, with the reason
   */
  SSLContext context(Instant now) throws GeneralSecurityException {
    return switch (read()) {
      case Unreadable u -> throw new GeneralSecurityException(u.reason());
      case Usable u -> {
        if (!u.identity().isEmpty() && u.identity().getFirst().getNotAfter().toInstant().isBefore(now)) {
          X509Certificate own = u.identity().getFirst();
          throw new CertificateExpiredException("its certificate (" + own.getSubjectX500Principal().getName() + ") expired on "
              + own.getNotAfter().toInstant().atOffset(ZoneOffset.UTC).toLocalDate());
        }
        yield u.context();
      }
    };
  }

  private Read readNow() {
    String where = setting + ".trust-store";
    try {
      KeyStore trustStore;
      List<X509Certificate> trusted;
      if (trust.type() == StoreType.PEM) {
        trusted = PemFiles.certificates(trust.file());
        trustStore = emptyStore();
        for (int i = 0; i < trusted.size(); i++) {
          trustStore.setCertificateEntry("ca-" + i, trusted.get(i));
        }
      } else {
        trustStore = load(trust);
        trusted = certificatesOf(trustStore);
        if (trusted.isEmpty()) {
          throw new IOException("it has no certificates");
        }
      }
      TrustManagerFactory trustManagers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      trustManagers.init(trustStore);

      KeyManagerFactory keyManagers = null;
      List<X509Certificate> chain = List.of();
      if (identity != null) {
        KeyStore keys;
        char[] password;
        switch (identity) {
          case KeyStoreIdentity k -> {
            where = setting + ".key-store";
            keys = load(k.store());
            password = Objects.requireNonNull(k.store().password()).toCharArray();
            chain = chainOf(keys, password);
          }
          case PemIdentity p -> {
            where = setting + ".certificate";
            chain = PemFiles.certificates(p.certificate());
            where = setting + ".private-key";
            PrivateKey key = PemFiles.privateKey(p.privateKey(), p.keyPassword());
            matches(key, chain.getFirst());
            password = new char[] {'e', 'm', 'c', 'c'}; // only for the store in memory
            keys = emptyStore();
            keys.setKeyEntry("identity", key, password, chain.toArray(new Certificate[0]));
          }
        }
        keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keyManagers.init(keys, password);
      }
      SSLContext context = SSLContext.getInstance("TLS");
      context.init(keyManagers == null ? null : keyManagers.getKeyManagers(), trustManagers.getTrustManagers(), null);
      return new Usable(context, chain, trusted);
    } catch (NoSuchFileException e) { // no path: the Monitor shows the reason (the log at start names the setting)
      return new Unreadable(where + ": the file does not exist");
    } catch (java.nio.file.AccessDeniedException e) {
      return new Unreadable(where + ": the server may not read the file");
    } catch (java.nio.file.FileSystemException e) {
      return new Unreadable(where + ": the file cannot be opened" + (e.getReason() == null ? "" : ": " + e.getReason()));
    } catch (IOException | GeneralSecurityException | RuntimeException e) {
      return new Unreadable(where + " cannot be read: " + reason(e));
    }
  }

  /** The cause a reader gives, without a stack; a wrong password says so. */
  private static String reason(Exception e) {
    if (e instanceof java.security.UnrecoverableKeyException || e.getCause() instanceof java.security.UnrecoverableKeyException) {
      return "the password is wrong";
    }
    String message = e.getMessage();
    return message == null ? e.getClass().getSimpleName() : message;
  }

  /** The key belongs to the certificate: a signature by the one is checked with the other. */
  private static void matches(PrivateKey key, X509Certificate certificate) throws GeneralSecurityException {
    String algorithm = switch (key.getAlgorithm()) {
      case "RSA" -> "SHA256withRSA";
      case "EC" -> "SHA256withECDSA";
      case "Ed25519", "Ed448", "EdDSA" -> key.getAlgorithm();
      default -> null;
    };
    if (algorithm == null) {
      return;
    }
    byte[] probe = "emcc".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    Signature sign = Signature.getInstance(algorithm);
    sign.initSign(key);
    sign.update(probe);
    byte[] signature = sign.sign();
    Signature verify = Signature.getInstance(algorithm);
    try {
      verify.initVerify(certificate.getPublicKey());
      verify.update(probe);
      if (verify.verify(signature)) {
        return;
      }
    } catch (GeneralSecurityException e) {
      // a key of another algorithm than the certificate's
    }
    throw new GeneralSecurityException("the private key does not belong to the first certificate in " + "the certificate file");
  }

  private static KeyStore emptyStore() throws GeneralSecurityException, IOException {
    KeyStore store = KeyStore.getInstance("PKCS12");
    store.load(null, null);
    return store;
  }

  private static KeyStore load(Store s) throws GeneralSecurityException, IOException {
    KeyStore store = KeyStore.getInstance(s.type() == StoreType.JKS ? "JKS" : "PKCS12");
    try (InputStream in = Files.newInputStream(s.file())) {
      store.load(in, Objects.requireNonNull(s.password()).toCharArray());
    }
    return store;
  }

  private static List<X509Certificate> certificatesOf(KeyStore store) throws GeneralSecurityException {
    List<X509Certificate> out = new ArrayList<>();
    for (String alias : Collections.list(store.aliases())) {
      if (store.getCertificate(alias) instanceof X509Certificate c) {
        out.add(c);
      }
    }
    return out;
  }

  private static List<X509Certificate> chainOf(KeyStore store, char[] password) throws GeneralSecurityException, IOException {
    for (String alias : Collections.list(store.aliases())) {
      if (store.isKeyEntry(alias)) {
        store.getKey(alias, password); // a wrong key password shows here, not at the handshake
        List<X509Certificate> chain = new ArrayList<>();
        for (Certificate c : Objects.requireNonNullElse(store.getCertificateChain(alias), new Certificate[0])) {
          if (c instanceof X509Certificate x) {
            chain.add(x);
          }
        }
        if (!chain.isEmpty()) {
          return chain;
        }
      }
    }
    throw new IOException("it has no private key with a certificate");
  }

  /** Never shows the passwords. */
  @Override
  public String toString() {
    return "TlsCredentials[" + setting + ", trust=" + trust + ", identity=" + identity + ", passwords not shown]";
  }
}
