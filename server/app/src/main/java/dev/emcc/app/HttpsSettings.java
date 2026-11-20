package dev.emcc.app;

import java.net.URI;
import java.nio.file.FileSystemNotFoundException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.PropertySource;

/**
 * HTTPS on the edge (ADR-0061, M9 C2): on when the settings name Spring Boot's SSL bundle {@value #BUNDLE}, with its
 * own keys ({@code spring.ssl.bundle.jks.emcc.*} for PKCS #12 or JKS, {@code spring.ssl.bundle.pem.emcc.*} for PEM),
 * usually in {@code settings/credentials/https.properties} ({@link SettingsFiles}). The server then uses the bundle
 * ({@code server.ssl.bundle=emcc}), only TLS 1.3 and 1.2, and reloads a renewed certificate without a restart (owner,
 * C2); each of these only where the admin has not set it. Without the bundle, nothing changes: plain HTTP as before.
 *
 * <p>A bundle that cannot be read stops the start (no fallback to HTTP): a file it names that does not exist with the
 * setting, its file and the path, in the server's own words; anything else with Spring's reason.
 */
public class HttpsSettings implements EnvironmentPostProcessor, Ordered {

  static final String BUNDLE = "emcc";
  static final String JKS = "spring.ssl.bundle.jks." + BUNDLE + ".";
  static final String PEM = "spring.ssl.bundle.pem." + BUNDLE + ".";
  static final String SOURCE = "emcc https defaults";

  /** After the settings files, so that their keys are seen. */
  @Override
  public int getOrder() {
    return org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor.ORDER + 2;
  }

  @Override
  public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
    String prefix = bundlePrefix(environment);
    if (prefix == null) {
      return;
    }
    checkFiles(environment, prefix);
    Map<String, Object> defaults = new LinkedHashMap<>();
    defaults.put("server.ssl.bundle", BUNDLE);
    defaults.put(prefix + "options.enabled-protocols", "TLSv1.3,TLSv1.2");
    defaults.put(prefix + "reload-on-update", "true");
    // last: below every file, the environment and the command line, so the admin's own value wins
    environment.getPropertySources().addLast(new MapPropertySource(SOURCE, defaults));
  }

  /** The bundle's files that are paths on this computer; a missing one stops the start, naming the setting and where. */
  static void checkFiles(ConfigurableEnvironment environment, String prefix) {
    List<String> keys = prefix.equals(JKS)
        ? List.of("keystore.location", "truststore.location")
        : List.of("keystore.certificate", "keystore.private-key", "truststore.certificate");
    for (String key : keys) {
      String value = environment.getProperty(prefix + key, "").strip();
      Path file = localFile(value);
      if (file != null && !Files.isRegularFile(file)) {
        throw new IllegalStateException("HTTPS cannot start: " + prefix + key + " (in " + where(environment, prefix + key)
            + ") names " + file.toAbsolutePath() + ", which is not a file. Put the key store there, or correct the setting.");
      }
    }
  }

  /** A setting's value as a file on this computer; null for none, another resource type ({@code classpath:}) or PEM text. */
  static @Nullable Path localFile(String value) {
    if (value.isEmpty() || value.startsWith("-----BEGIN") || value.startsWith("classpath:")) {
      return null;
    }
    try {
      if (value.startsWith("file://")) {
        return Path.of(URI.create(value));
      }
      String path = value.startsWith("file:") ? value.substring("file:".length()) : value;
      return path.indexOf(':') > 1 ? null : Path.of(path); // another URL scheme is Spring's to read; C:\ is a path
    } catch (IllegalArgumentException | FileSystemNotFoundException e) { // InvalidPathException too
      return null;
    }
  }

  /** The settings source that gives the key, as its file where it is one of the settings files. */
  private static String where(ConfigurableEnvironment environment, String key) {
    for (PropertySource<?> source : environment.getPropertySources()) {
      // Spring's attached source wraps all the others: the one below it that holds the key counts
      if (!ConfigurationPropertySources.isAttachedConfigurationPropertySource(source) && source.containsProperty(key)) {
        String name = source.getName();
        if (name.startsWith("settings: ")) {
          return name.substring("settings: ".length());
        }
        return switch (name) {
          case "commandLineArgs" -> "the command line";
          case "systemEnvironment" -> "the environment";
          case "systemProperties" -> "the Java system properties";
          default -> name;
        };
      }
    }
    return "the settings";
  }

  /**
   * {@value #JKS} when its key store's location is set, {@value #PEM} when its certificate is; null without HTTPS. In
   * any source, environment variables included. Both at once is Spring's error.
   */
  static @Nullable String bundlePrefix(ConfigurableEnvironment environment) {
    if (environment.containsProperty(JKS + "keystore.location")) {
      return JKS;
    }
    return environment.containsProperty(PEM + "keystore.certificate") ? PEM : null;
  }
}
