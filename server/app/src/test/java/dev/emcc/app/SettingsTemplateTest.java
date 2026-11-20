package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.lang.reflect.RecordComponent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * ADR-0060's test: every key the server binds is in the release's commented settings files (server/app/src/release/settings/),
 * set or commented out, so that the file cannot drift from the code. The keys: each {@code @Value} key and each
 * {@code @ConfigurationProperties} record's components (a map's or a record's parts below it), and the bundled
 * application.properties' keys but its fixed internals.
 */
class SettingsTemplateTest {

  static final Path SOURCES = Path.of("src/main/java/dev/emcc/app");
  static final Path TEMPLATE = Path.of("src/release/settings");
  static final Pattern VALUE = Pattern.compile("\\$\\{([a-z][a-z0-9.\\-]*)[:}]");
  /**
   * {@code environment.getProperty("key"...)} and {@code @ConditionalOnProperty(name = "key"...)}: Spring's settings only, not
   * {@code System.getProperty} (the JVM's) or a {@code Properties} file's keys, such as the release's version.properties.
   */
  static final Pattern LOOKUP = Pattern.compile("(?:\\benvironment\\.getProperty\\(|name = )\"([a-z][a-z0-9.\\-]*)\"");
  static final Pattern PROPERTIES = Pattern.compile("@ConfigurationProperties\\(\"([a-z0-9.\\-]+)\"\\)");
  static final Pattern TEMPLATE_KEY = Pattern.compile("^#?\\s*([A-Za-z][A-Za-z0-9_.\\-\\[\\]<>]*)=", Pattern.MULTILINE);
  /** The bundled keys that are emcc's fixed internals, not an admin's settings. */
  static final List<String> INTERNAL = List.of("spring.", "server.shutdown", "server.servlet.session.cookie.",
      "server.servlet.context-parameters.", "server.compression.");

  @Test
  void everyKeyTheServerBindsIsInTheCommentedSettingsFiles() throws IOException {
    Set<String> template = templateKeys();
    List<String> missing = new ArrayList<>();
    for (String key : boundKeys()) {
      if (!template.contains(key)) {
        missing.add(key);
      }
    }
    for (String prefix : prefixedKeys()) {
      if (template.stream().noneMatch(k -> k.startsWith(prefix))) {
        missing.add(prefix + "...");
      }
    }
    assertThat(missing).as("keys missing from %s", TEMPLATE).isEmpty();
  }

  @Test
  void theCredentialsTemplatesHoldNoValue() throws IOException {
    try (Stream<Path> files = Files.list(TEMPLATE.resolve("credentials"))) {
      for (Path f : files.toList()) {
        Properties p = new Properties();
        p.load(Files.newBufferedReader(f, StandardCharsets.ISO_8859_1));
        assertThat(p).as("%s: comments only", f).isEmpty();
      }
    }
  }

  /** Keys named exactly: {@code @Value} keys, the bundled keys, and records' plain components. */
  static Set<String> boundKeys() throws IOException {
    Set<String> keys = new TreeSet<>();
    for (String source : sources().values()) {
      for (Pattern p : List.of(VALUE, LOOKUP)) {
        Matcher m = p.matcher(source);
        while (m.find()) {
          keys.add(m.group(1));
        }
      }
    }
    Properties bundled = new Properties();
    try (var in = SettingsTemplateTest.class.getResourceAsStream("/application.properties")) {
      bundled.load(in);
    }
    for (String key : bundled.stringPropertyNames()) {
      if (INTERNAL.stream().noneMatch(key::startsWith)) {
        keys.add(key);
      }
    }
    for (Map.Entry<String, Class<?>> e : propertiesRecords().entrySet()) {
      for (RecordComponent c : e.getValue().getRecordComponents()) {
        if (!Map.class.isAssignableFrom(c.getType())) {
          keys.add(e.getKey() + "." + kebab(c.getName()));
        }
      }
    }
    return keys;
  }

  /** Keys below a map: at least one template key starts with each, a record value's parts included. */
  static Set<String> prefixedKeys() throws IOException {
    Set<String> prefixes = new TreeSet<>();
    for (Map.Entry<String, Class<?>> e : propertiesRecords().entrySet()) {
      for (RecordComponent c : e.getValue().getRecordComponents()) {
        if (Map.class.isAssignableFrom(c.getType())) {
          String map = e.getKey() + "." + kebab(c.getName());
          Class<?> value = mapValue(c);
          if (value.isRecord()) {
            for (RecordComponent part : value.getRecordComponents()) {
              prefixes.add(map + ".<name>." + kebab(part.getName()));
            }
          } else {
            prefixes.add(map);
          }
        }
      }
    }
    return prefixes;
  }

  static Class<?> mapValue(RecordComponent c) {
    var type = (java.lang.reflect.ParameterizedType) c.getGenericType();
    var value = type.getActualTypeArguments()[1];
    return value instanceof Class<?> k ? k : Collection.class;
  }

  static Map<String, Class<?>> propertiesRecords() throws IOException {
    Map<String, Class<?>> records = new java.util.TreeMap<>();
    for (Map.Entry<String, String> e : sources().entrySet()) {
      Matcher m = PROPERTIES.matcher(e.getValue());
      if (m.find()) {
        try {
          records.put(m.group(1), Class.forName("dev.emcc.app." + e.getKey()));
        } catch (ClassNotFoundException x) {
          throw new IllegalStateException(x);
        }
      }
    }
    assertThat(records).as("@ConfigurationProperties records").isNotEmpty();
    return records;
  }

  static Map<String, String> sources() throws IOException {
    Map<String, String> sources = new java.util.TreeMap<>();
    try (Stream<Path> files = Files.list(SOURCES)) {
      for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
        sources.put(f.getFileName().toString().replace(".java", ""), Files.readString(f));
      }
    }
    return sources;
  }

  static Set<String> templateKeys() throws IOException {
    Set<String> keys = new TreeSet<>();
    List<Path> files = new ArrayList<>(List.of(TEMPLATE.resolve("emcc.properties")));
    try (Stream<Path> credentials = Files.list(TEMPLATE.resolve("credentials"))) {
      files.addAll(credentials.toList());
    }
    for (Path f : files) {
      Matcher m = TEMPLATE_KEY.matcher(Files.readString(f, StandardCharsets.ISO_8859_1));
      while (m.find()) {
        keys.add(m.group(1));
      }
    }
    return keys;
  }

  static String kebab(String camel) {
    return camel.replaceAll("([a-z0-9])([A-Z])", "$1-$2").toLowerCase(java.util.Locale.ROOT);
  }
}
