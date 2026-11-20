package dev.emcc.plugins.cot;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/**
 * Self-made certificates for the TLS tests (acceptance criterion 9, 14): a server certificate for
 * {@code localhost} and a client certificate, made at test time with the JDK's {@code keytool},
 * with random passwords, in a temporary folder. Nothing is committed and nothing is logged.
 */
final class TestTls {

  /** What the TAK Server side uses: its own key, and the client certificate it trusts. */
  final SSLContext server;
  /** What the plugin uses ({@code task.tls(name)}): the client key, and the server certificate it trusts. */
  final SSLContext client;
  /** What the plugin would use without a client certificate. */
  final SSLContext clientWithoutCertificate;

  private TestTls(SSLContext server, SSLContext client, SSLContext clientWithoutCertificate) {
    this.server = server;
    this.client = client;
    this.clientWithoutCertificate = clientWithoutCertificate;
  }

  /** Makes the stores in {@code dir} and loads them. */
  static TestTls create(Path dir) throws IOException, GeneralSecurityException, InterruptedException {
    String password = HexFormat.of().formatHex(randomBytes(16));
    keypair(dir, "server", "CN=localhost", "san=dns:localhost,ip:127.0.0.1", password);
    keypair(dir, "client", "CN=emc2-test-client", "san=dns:localhost", password);
    export(dir, "server", password);
    export(dir, "client", password);
    importCert(dir, "server", "client-trust", password); // the plugin trusts the server's certificate
    importCert(dir, "client", "server-trust", password); // the server trusts the plugin's certificate

    SSLContext server = context(load(dir, "server", password), password, load(dir, "server-trust", password));
    SSLContext client = context(load(dir, "client", password), password, load(dir, "client-trust", password));
    SSLContext bare = context(null, password, load(dir, "client-trust", password));
    return new TestTls(server, client, bare);
  }

  private static byte[] randomBytes(int n) {
    byte[] bytes = new byte[n];
    new SecureRandom().nextBytes(bytes);
    return bytes;
  }

  private static void keypair(Path dir, String alias, String dn, String san, String password) throws IOException, InterruptedException {
    keytool(dir, "-genkeypair", "-alias", alias, "-keyalg", "RSA", "-keysize", "2048", "-validity", "2", "-dname", dn, "-ext", san,
        "-keystore", alias + ".p12", "-storetype", "PKCS12", "-storepass", password, "-keypass", password);
  }

  private static void export(Path dir, String alias, String password) throws IOException, InterruptedException {
    keytool(dir, "-exportcert", "-alias", alias, "-keystore", alias + ".p12", "-storetype", "PKCS12", "-storepass", password, "-file", alias + ".cer");
  }

  private static void importCert(Path dir, String alias, String store, String password) throws IOException, InterruptedException {
    keytool(dir, "-importcert", "-noprompt", "-alias", alias, "-file", alias + ".cer", "-keystore", store + ".p12", "-storetype", "PKCS12", "-storepass", password);
  }

  private static void keytool(Path dir, String... arguments) throws IOException, InterruptedException {
    List<String> command = new ArrayList<>();
    command.add(Path.of(System.getProperty("java.home"), "bin", "keytool").toString());
    command.addAll(List.of(arguments));
    Process process = new ProcessBuilder(command).directory(dir.toFile()).redirectErrorStream(true).start();
    String output;
    try (InputStream in = process.getInputStream()) {
      output = new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
    if (!process.waitFor(60, TimeUnit.SECONDS) || process.exitValue() != 0) {
      // the output names the problem; the command line holds the password and is not shown
      throw new IOException("keytool " + arguments[0] + " failed: " + output);
    }
  }

  private static KeyStore load(Path dir, String name, String password) throws IOException, GeneralSecurityException {
    KeyStore store = KeyStore.getInstance("PKCS12");
    try (InputStream in = Files.newInputStream(dir.resolve(name + ".p12"))) {
      store.load(in, password.toCharArray());
    }
    return store;
  }

  private static SSLContext context(KeyStore keys, String password, KeyStore trust) throws GeneralSecurityException {
    KeyManagerFactory keyManagers = null;
    if (keys != null) {
      keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
      keyManagers.init(keys, password.toCharArray());
    }
    TrustManagerFactory trustManagers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    trustManagers.init(trust);
    SSLContext context = SSLContext.getInstance("TLS");
    context.init(keyManagers == null ? null : keyManagers.getKeyManagers(), trustManagers.getTrustManagers(), null);
    return context;
  }
}
