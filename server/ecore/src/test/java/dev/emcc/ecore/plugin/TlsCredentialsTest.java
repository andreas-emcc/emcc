package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.plugin.TlsCredentials.KeyStoreIdentity;
import dev.emcc.ecore.plugin.TlsCredentials.PemIdentity;
import dev.emcc.ecore.plugin.TlsCredentials.Store;
import dev.emcc.ecore.plugin.TlsCredentials.StoreType;
import dev.emcc.ecore.plugin.TlsCredentials.Unreadable;
import dev.emcc.ecore.plugin.TlsCredentials.Usable;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.CertificateExpiredException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.EncryptedPrivateKeyInfo;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.PBEParameterSpec;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** ADR-0062 (M9 C3): a TLS credential's stores, PKCS #12, JKS and PEM, read once, with their certificates and expiry. */
class TlsCredentialsTest {

  @TempDir Path keys;

  @Test
  void readsPkcs12AndJksStoresOnceWithTheirCertificates() throws Exception {
    keytool("-genkeypair", "-alias", "client", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=emcc-client", "-validity", "40",
        "-storetype", "PKCS12", "-keystore", "client.p12", "-storepass", "test-only-1");
    keytool("-exportcert", "-rfc", "-alias", "client", "-keystore", "client.p12", "-storepass", "test-only-1", "-file", "client.crt");
    keytool("-importcert", "-noprompt", "-alias", "ca", "-file", "client.crt", "-storetype", "JKS", "-keystore", "trust.jks",
        "-storepass", "test-only-2");

    TlsCredentials credential = new TlsCredentials("emc2.tls.tak", new Store(keys.resolve("trust.jks"), StoreType.JKS, "test-only-2"),
        new KeyStoreIdentity(new Store(keys.resolve("client.p12"), StoreType.PKCS12, "test-only-1")));

    Usable read = (Usable) credential.read();
    assertThat(credential.read()).as("read once").isSameAs(read);
    assertThat(read.identity()).singleElement().satisfies(c -> assertThat(c.getSubjectX500Principal().getName()).isEqualTo("CN=emcc-client"));
    assertThat(read.trusted()).hasSize(1);
    assertThat(credential.context(Instant.now())).isSameAs(read.context());
  }

  @Test
  void readsPemFilesWithAPlainAnEncryptedAndAnOldRsaKey() throws Exception {
    keytool("-genkeypair", "-alias", "client", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=emcc-client", "-validity", "40",
        "-storetype", "PKCS12", "-keystore", "client.p12", "-storepass", "test-only-1");
    keytool("-exportcert", "-rfc", "-alias", "client", "-keystore", "client.p12", "-storepass", "test-only-1", "-file", "client.pem");
    Files.copy(keys.resolve("client.pem"), keys.resolve("ca.pem"));
    byte[] pkcs8 = privateKey("client.p12", "client", "test-only-1").getEncoded();
    pem("plain.key", "PRIVATE KEY", pkcs8);
    pem("encrypted.key", "ENCRYPTED PRIVATE KEY", encrypt(pkcs8, "test-only-3"));
    pem("rsa.key", "RSA PRIVATE KEY", child(pkcs8, 2));

    for (String key : List.of("plain.key", "encrypted.key", "rsa.key")) {
      TlsCredentials credential = new TlsCredentials("emc2.tls.tak", new Store(keys.resolve("ca.pem"), StoreType.PEM, null),
          new PemIdentity(keys.resolve("client.pem"), keys.resolve(key), key.equals("encrypted.key") ? "test-only-3" : null));
      assertThat(credential.read()).as(key).isInstanceOf(Usable.class);
      assertThat(((Usable) credential.read()).identity()).as(key).hasSize(1);
    }
  }

  @Test
  void readsAnEcKeyInSec1Form() throws Exception {
    keytool("-genkeypair", "-alias", "client", "-keyalg", "EC", "-groupname", "secp256r1", "-dname", "CN=emcc-ec", "-validity", "40",
        "-storetype", "PKCS12", "-keystore", "ec.p12", "-storepass", "test-only-1");
    keytool("-exportcert", "-rfc", "-alias", "client", "-keystore", "ec.p12", "-storepass", "test-only-1", "-file", "ec.pem");
    byte[] pkcs8 = privateKey("ec.p12", "client", "test-only-1").getEncoded();
    byte[] curve = child(tlv(child(pkcs8, 1)), 1); // the algorithm's parameters: the curve's OID
    byte[] inner = child(pkcs8, 2);
    byte[] secret = tlvOf(inner, 1); // SEC 1: version 1, the secret, then [0] the curve as OpenSSL writes it
    pem("ec.key", "EC PRIVATE KEY", tlv(0x30, concat(new byte[] {2, 1, 1}, secret, tlv(0xa0, tlv(0x06, curve)))));

    TlsCredentials credential = new TlsCredentials("emc2.tls.ec", new Store(keys.resolve("ec.pem"), StoreType.PEM, null),
        new PemIdentity(keys.resolve("ec.pem"), keys.resolve("ec.key"), null));
    assertThat(credential.read()).isInstanceOf(Usable.class);
  }

  @Test
  void saysWhyAFileCannotBeReadWithoutAPassword() throws Exception {
    keytool("-genkeypair", "-alias", "a", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=a", "-validity", "40",
        "-storetype", "PKCS12", "-keystore", "a.p12", "-storepass", "test-only-1");
    keytool("-genkeypair", "-alias", "b", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=b", "-validity", "40",
        "-storetype", "PKCS12", "-keystore", "b.p12", "-storepass", "test-only-1");
    keytool("-exportcert", "-rfc", "-alias", "a", "-keystore", "a.p12", "-storepass", "test-only-1", "-file", "a.pem");
    pem("b.key", "PRIVATE KEY", privateKey("b.p12", "b", "test-only-1").getEncoded());
    pem("enc.key", "ENCRYPTED PRIVATE KEY", encrypt(privateKey("b.p12", "b", "test-only-1").getEncoded(), "test-only-3"));
    Files.writeString(keys.resolve("old.key"), "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nAAAA\n"
        + "-----END RSA PRIVATE KEY-----\n");
    Store pemTrust = new Store(keys.resolve("a.pem"), StoreType.PEM, null);

    assertThat(reason(new TlsCredentials("emc2.tls.x", new Store(keys.resolve("a.p12"), StoreType.PKCS12, "wrong-one"), null)))
        .isEqualTo("emc2.tls.x.trust-store cannot be read: the password is wrong").doesNotContain("wrong-one");
    assertThat(reason(new TlsCredentials("emc2.tls.x", new Store(keys.resolve("gone.pem"), StoreType.PEM, null), null)))
        .isEqualTo("emc2.tls.x.trust-store: the file does not exist");
    Files.write(keys.resolve("bom.pem"), new byte[] {(byte) 0xef, (byte) 0xbb, (byte) 0xbf, (byte) 0xe9});
    assertThat(reason(new TlsCredentials("emc2.tls.x", new Store(keys.resolve("bom.pem"), StoreType.PEM, null), null)))
        .as("not ASCII: read, and said to have no certificate")
        .isEqualTo("emc2.tls.x.trust-store cannot be read: it has no PEM certificate (-----BEGIN CERTIFICATE-----)");
    assertThat(reason(new TlsCredentials("emc2.tls.x", pemTrust, new PemIdentity(keys.resolve("a.pem"), keys.resolve("b.key"), null))))
        .isEqualTo("emc2.tls.x.private-key cannot be read: the private key does not belong to the first certificate in the certificate file");
    assertThat(reason(new TlsCredentials("emc2.tls.x", pemTrust, new PemIdentity(keys.resolve("a.pem"), keys.resolve("enc.key"), null))))
        .isEqualTo("emc2.tls.x.private-key cannot be read: its key is encrypted and the key's password is missing");
    assertThat(reason(new TlsCredentials("emc2.tls.x", pemTrust, new PemIdentity(keys.resolve("a.pem"), keys.resolve("enc.key"), "wrong-two"))))
        .isEqualTo("emc2.tls.x.private-key cannot be read: its key cannot be decrypted: the key's password is wrong");
    assertThat(reason(new TlsCredentials("emc2.tls.x", pemTrust, new PemIdentity(keys.resolve("a.pem"), keys.resolve("old.key"), null))))
        .contains("OpenSSL's old form").contains("openssl pkcs8 -topk8");
    assertThat(reason(new TlsCredentials("emc2.tls.x", new Store(keys.resolve("b.key"), StoreType.PEM, null), null)))
        .isEqualTo("emc2.tls.x.trust-store cannot be read: it has no PEM certificate (-----BEGIN CERTIFICATE-----)");

    TlsCredentials unreadable = new TlsCredentials("emc2.tls.x", new Store(keys.resolve("a.p12"), StoreType.PKCS12, "wrong-one"), null);
    assertThatThrownBy(() -> unreadable.context(Instant.now())).hasMessage("emc2.tls.x.trust-store cannot be read: the password is wrong");
  }

  @Test
  void anExpiredCertificateRefusesTheContextAndSaysWhen() throws Exception {
    keytool("-genkeypair", "-alias", "client", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=emcc-client", "-validity", "2",
        "-storetype", "PKCS12", "-keystore", "client.p12", "-storepass", "test-only-1");
    TlsCredentials credential = new TlsCredentials("emc2.tls.tak", new Store(keys.resolve("client.p12"), StoreType.PKCS12, "test-only-1"),
        new KeyStoreIdentity(new Store(keys.resolve("client.p12"), StoreType.PKCS12, "test-only-1")));
    Usable read = (Usable) credential.read();
    Instant later = read.identity().getFirst().getNotAfter().toInstant().plus(Duration.ofDays(1));

    assertThat(credential.context(Instant.now())).isNotNull();
    assertThatThrownBy(() -> credential.context(later)).isInstanceOf(CertificateExpiredException.class)
        .hasMessageStartingWith("its certificate (CN=emcc-client) expired on 20");
  }

  @Test
  void neverShowsPasswordsAndTypesGoByExtension() {
    TlsCredentials credential = new TlsCredentials(keys.resolve("client.p12"), "k3y-pass", keys.resolve("trust.jks"), "tru5t-pass");
    assertThat(credential.toString()).doesNotContain("k3y-pass").doesNotContain("tru5t-pass");
    assertThat(credential.trust().type()).isEqualTo(StoreType.JKS);
    assertThat(List.of("a.jks", "a.PEM", "a.crt", "a.cer", "a.p12", "a.pfx").stream().map(n -> StoreType.byExtension(Path.of(n))))
        .containsExactly(StoreType.JKS, StoreType.PEM, StoreType.PEM, StoreType.PEM, StoreType.PKCS12, StoreType.PKCS12);
  }

  private static String reason(TlsCredentials credential) {
    return ((Unreadable) credential.read()).reason();
  }

  private PrivateKey privateKey(String store, String alias, String password) throws Exception {
    KeyStore ks = KeyStore.getInstance("PKCS12");
    try (InputStream in = Files.newInputStream(keys.resolve(store))) {
      ks.load(in, password.toCharArray());
    }
    return (PrivateKey) ks.getKey(alias, password.toCharArray());
  }

  /** PKCS #8 encrypted as OpenSSL 3 does by default: PBES2, PBKDF2 with HMAC-SHA256, AES-256-CBC. */
  private static byte[] encrypt(byte[] pkcs8, String password) throws Exception {
    String algorithm = "PBEWithHmacSHA256AndAES_256";
    byte[] salt = new byte[16];
    byte[] iv = new byte[16];
    new SecureRandom().nextBytes(salt);
    new SecureRandom().nextBytes(iv);
    Cipher cipher = Cipher.getInstance(algorithm);
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeyFactory.getInstance(algorithm).generateSecret(new PBEKeySpec(password.toCharArray())),
        new PBEParameterSpec(salt, 10_000, new IvParameterSpec(iv)));
    java.security.AlgorithmParameters pbes2 = java.security.AlgorithmParameters.getInstance("PBES2");
    pbes2.init(cipher.getParameters().getEncoded());
    return new EncryptedPrivateKeyInfo(pbes2, cipher.doFinal(pkcs8)).getEncoded();
  }

  private void pem(String file, String label, byte[] der) throws IOException {
    Files.writeString(keys.resolve(file), "-----BEGIN " + label + "-----\n" + Base64.getMimeEncoder(64, new byte[] {'\n'}).encodeToString(der)
        + "\n-----END " + label + "-----\n", StandardCharsets.US_ASCII);
  }

  /** The content of a DER sequence's {@code index}th element. */
  private static byte[] child(byte[] sequence, int index) {
    List<int[]> parts = parts(sequence);
    int[] p = parts.get(index);
    return Arrays.copyOfRange(sequence, p[1], p[2]);
  }

  /** A DER sequence's {@code index}th element, whole. */
  private static byte[] tlvOf(byte[] sequence, int index) {
    int[] p = parts(sequence).get(index);
    return Arrays.copyOfRange(sequence, p[0], p[2]);
  }

  /** A sequence's elements as {start, content start, end}. */
  private static List<int[]> parts(byte[] sequence) {
    int[] outer = header(sequence, 0);
    List<int[]> out = new ArrayList<>();
    int at = outer[0];
    while (at < outer[0] + outer[1]) {
      int[] h = header(sequence, at);
      out.add(new int[] {at, h[0], h[0] + h[1]});
      at = h[0] + h[1];
    }
    return out;
  }

  /** {content start, length} of the element at {@code at}. */
  private static int[] header(byte[] der, int at) {
    int first = der[at + 1] & 0xff;
    if (first < 0x80) {
      return new int[] {at + 2, first};
    }
    int n = first & 0x7f;
    int length = 0;
    for (int i = 0; i < n; i++) {
      length = (length << 8) | (der[at + 2 + i] & 0xff);
    }
    return new int[] {at + 2 + n, length};
  }

  /** The bytes as a sequence again (for a child's content). */
  private static byte[] tlv(byte[] content) {
    return tlv(0x30, content);
  }

  private static byte[] tlv(int tag, byte[] content) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(tag);
    if (content.length < 0x80) {
      out.write(content.length);
    } else if (content.length < 0x100) {
      out.write(0x81);
      out.write(content.length);
    } else {
      out.write(0x82);
      out.write(content.length >> 8);
      out.write(content.length);
    }
    out.writeBytes(content);
    return out.toByteArray();
  }

  private static byte[] concat(byte[]... parts) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    for (byte[] p : parts) {
      out.writeBytes(p);
    }
    return out.toByteArray();
  }

  private void keytool(String... args) throws IOException, InterruptedException {
    String exe = Path.of(System.getProperty("java.home"), "bin", "keytool").toString();
    List<String> command = new ArrayList<>(List.of(exe));
    command.addAll(List.of(args));
    Process p = new ProcessBuilder(command).directory(keys.toFile()).redirectErrorStream(true).start();
    String output = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertThat(p.waitFor()).as(output).isZero();
  }
}
