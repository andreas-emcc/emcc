package dev.emcc.app;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.apache.commons.logging.Log;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.boot.env.OriginTrackedMapPropertySource;
import org.springframework.boot.env.PropertiesPropertySourceLoader;
import org.springframework.boot.logging.DeferredLogFactory;
import org.springframework.boot.origin.OriginTrackedValue;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.EnumerablePropertySource;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.FileSystemResource;

/**
 * The installation's settings files (ADR-0060, M9 C1), read before the edge starts, from the emcc folder (the folder the
 * server runs in, which {@code %emcc%} names):
 *
 * <ol>
 *   <li>{@code application-local.properties}: deprecated, read with a warning; the files below win over it (owner,
 *       2026-11-16);
 *   <li>{@code settings/emcc.properties}: the installation's settings;
 *   <li>every {@code settings/credentials/*.properties}, by name: one file per credential.
 * </ol>
 *
 * <p>A later one wins over an earlier one; environment variables and the command line win over all, and all win over
 * the bundled {@code application.properties}. No profile is needed. A value that starts with {@code %emcc%/} or {@code
 * %emcc%\} is resolved below the emcc folder (ADR-0060 point 4).
 *
 * <p>Every file in {@code settings/credentials/} is checked, except a {@code .properties} file that holds no
 * setting (only comments and blank lines, as the templates ship; owner ABV A): one that others can read gets a
 * warning in the log, and with {@value #REQUIRE_PRIVATE}{@code =true} the server does not start (ADR-0060 point 3,
 * owner Q2 A). On Windows "others" are Everyone, Users and Authenticated Users, recognised by their English names
 * only; on POSIX, group or other read.
 * No values are ever logged, only file and key names.
 */
public class SettingsFiles implements EnvironmentPostProcessor, Ordered {

  static final String LOCAL = "application-local.properties";
  static final Path SETTINGS = Path.of("settings", "emcc.properties");
  static final Path CREDENTIALS = Path.of("settings", "credentials");
  static final String REQUIRE_PRIVATE = "emc2.credentials.require-private";
  static final String EMCC = "%emcc%";
  /** The Windows groups whose read access makes a credentials file readable by others (their English names). */
  static final Set<String> OTHERS = Set.of("everyone", "users", "authenticated users");

  private final Log log;
  private final Path emcc;

  public SettingsFiles(DeferredLogFactory logs) {
    this(logs.getLog(SettingsFiles.class), Path.of("").toAbsolutePath().normalize());
  }

  SettingsFiles(Log log, Path emcc) {
    this.log = log;
    this.emcc = emcc;
  }

  /** After Spring has read its own configuration files, so that these go above them. */
  @Override
  public int getOrder() {
    return ConfigDataEnvironmentPostProcessor.ORDER + 1;
  }

  @Override
  public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
    List<PropertySource<?>> read = new ArrayList<>(); // lowest first
    Path local = emcc.resolve(LOCAL);
    @Nullable PropertySource<?> localSource = Files.isRegularFile(local) ? load(local, "settings: " + LOCAL) : null;
    if (localSource != null) {
      read.add(localSource);
    }
    List<PropertySource<?>> newer = new ArrayList<>();
    Path settings = emcc.resolve(SETTINGS);
    if (Files.isRegularFile(settings)) {
      newer.add(load(settings, "settings: settings/emcc.properties"));
    }
    List<Path> checked = new ArrayList<>(); // owner ABV A: a template that holds no setting is not checked
    for (Path file : credentialFiles()) {
      if (file.getFileName().toString().endsWith(".properties")) {
        PropertySource<?> source = load(file, "settings: settings/credentials/" + file.getFileName());
        newer.add(source);
        if (!holdsNoSetting(source)) {
          checked.add(file);
        }
      } else {
        checked.add(file); // a key store or a PEM file: always checked
      }
    }
    read.addAll(newer);

    MutablePropertySources sources = environment.getPropertySources();
    String above = sources.contains(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME)
        ? StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME : null;
    for (PropertySource<?> source : read) { // each new one goes right below the environment, so a later file wins
      if (above != null) {
        sources.addAfter(above, source);
      } else {
        sources.addFirst(source);
      }
    }
    read.forEach(s -> log.info("Settings read from " + s.getName().substring("settings: ".length())));

    if (localSource != null) {
      warnLocal(localSource, newer);
    }
    List<String> readable = readableByOthers(checked);
    readable.forEach(f -> log.warn("settings/credentials/" + f + " can be read by other users of this computer: give read access "
        + "only to the account emcc runs as and to administrators (server/README.md, \"Settings files\")"));
    if (!readable.isEmpty() && Boolean.TRUE.equals(environment.getProperty(REQUIRE_PRIVATE, Boolean.class, false))) {
      throw new IllegalStateException(REQUIRE_PRIVATE + " is true and other users can read settings/credentials/"
          + String.join(", settings/credentials/", readable));
    }
  }

  private void warnLocal(PropertySource<?> local, List<PropertySource<?>> newer) {
    log.warn(LOCAL + " is deprecated (ADR-0060): move its settings to settings/emcc.properties and its secrets to "
        + "settings/credentials/. The settings files win over it.");
    if (!(local instanceof EnumerablePropertySource<?> enumerable)) {
      return;
    }
    Set<String> overridden = new TreeSet<>();
    for (String key : enumerable.getPropertyNames()) {
      if (newer.stream().anyMatch(s -> s.containsProperty(key))) {
        overridden.add(key);
      }
    }
    if (!overridden.isEmpty()) {
      log.warn(LOCAL + ": these keys are also in the settings files, whose values count: " + String.join(", ", overridden));
    }
  }

  /** The files in {@code settings/credentials/}, by name; none without the folder. */
  List<Path> credentialFiles() {
    Path folder = emcc.resolve(CREDENTIALS);
    if (!Files.isDirectory(folder)) {
      return List.of();
    }
    List<Path> files = new ArrayList<>();
    try (DirectoryStream<Path> all = Files.newDirectoryStream(folder)) {
      for (Path p : all) {
        if (Files.isRegularFile(p)) {
          files.add(p);
        }
      }
    } catch (IOException e) {
      throw new IllegalStateException("settings/credentials/ cannot be read: " + e.getMessage(), e);
    }
    files.sort(null);
    return files;
  }

  /**
   * A credentials file with only comments and blank lines, as the release ships its templates (owner ABV A): a zip carries
   * no Windows rights, so such a file would warn on every unpacked release while it holds nothing to protect.
   */
  static boolean holdsNoSetting(PropertySource<?> source) {
    return source instanceof EnumerablePropertySource<?> e && e.getPropertyNames().length == 0;
  }

  /** The names of the files others can read, or whose permissions cannot be checked. */
  List<String> readableByOthers(List<Path> files) {
    List<String> readable = new ArrayList<>();
    for (Path file : files) {
      try {
        if (readableByOthers(file)) {
          readable.add(file.getFileName().toString());
        }
      } catch (IOException | UnsupportedOperationException e) { // not known to be private: counted as readable
        log.warn("settings/credentials/" + file.getFileName() + ": its permissions cannot be checked: " + e.getMessage());
        readable.add(file.getFileName().toString());
      }
    }
    return readable;
  }

  static boolean readableByOthers(Path file) throws IOException {
    PosixFileAttributeView posix = Files.getFileAttributeView(file, PosixFileAttributeView.class);
    if (posix != null) {
      Set<PosixFilePermission> p = posix.readAttributes().permissions();
      return p.contains(PosixFilePermission.GROUP_READ) || p.contains(PosixFilePermission.OTHERS_READ);
    }
    AclFileAttributeView acl = Files.getFileAttributeView(file, AclFileAttributeView.class);
    if (acl == null) {
      throw new UnsupportedOperationException("neither POSIX permissions nor an ACL");
    }
    return aclReadableByOthers(acl.getAcl());
  }

  static boolean aclReadableByOthers(List<AclEntry> entries) {
    for (AclEntry e : entries) {
      if (e.type() == AclEntryType.ALLOW && e.permissions().contains(AclEntryPermission.READ_DATA)) {
        String name = e.principal().getName();
        String group = name.substring(name.lastIndexOf('\\') + 1).toLowerCase(Locale.ROOT);
        if (OTHERS.contains(group)) {
          return true;
        }
      }
    }
    return false;
  }

  /** One file's keys, with {@code %emcc%/} values resolved; Spring's own reader, so its syntax is the bundled file's. */
  private PropertySource<?> load(Path file, String name) {
    List<PropertySource<?>> loaded;
    try {
      loaded = new PropertiesPropertySourceLoader().load(name, new FileSystemResource(file));
    } catch (IOException | RuntimeException e) {
      throw new IllegalStateException(emcc.relativize(file) + " cannot be read: " + e.getMessage(), e);
    }
    Map<String, Object> values = new LinkedHashMap<>();
    for (PropertySource<?> source : loaded) {
      if (source instanceof EnumerablePropertySource<?> e) {
        for (String key : e.getPropertyNames()) {
          values.putIfAbsent(key, resolved(e.getProperty(key)));
        }
      }
    }
    return new OriginTrackedMapPropertySource(name, values, true);
  }

  /** A value starting with {@code %emcc%/} or {@code %emcc%\}, below the emcc folder; any other as it is. */
  @Nullable Object resolved(@Nullable Object value) {
    Object plain = value instanceof OriginTrackedValue t ? t.getValue() : value;
    if (!(plain instanceof String s) || !(s.startsWith(EMCC + "/") || s.startsWith(EMCC + "\\"))) {
      return value;
    }
    String path = emcc.resolve(s.substring(EMCC.length() + 1)).normalize().toString();
    return value instanceof OriginTrackedValue t ? OriginTrackedValue.of(path, t.getOrigin()) : path;
  }
}
