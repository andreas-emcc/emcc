package dev.emcc.app;

import dev.emcc.sdk.Sdk;
import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Which release runs, and whether its user manual is there (M9 RC2, owner ACQ; the shell's help menu). Both are read once
 * at start from the release's folder, the folder the server runs in (as {@code settings/}; {@code emc2.release.directory}
 * for tests):
 *
 * <ul>
 *   <li>{@code version.properties}, written by {@code tools/release.mjs}: {@code emcc.version}, {@code emcc.build.date},
 *       {@code emcc.build.commit}, {@code emcc.build.dirty}, {@code emcc.sdk.version}. Without it (a developer run):
 *       {@code {"name": "dev", "sdk": <the SDK this server implements>}}. A key that is missing is left out.
 *   <li>{@code manual/index.html}: the built user manual, served at {@code /manual/} ({@link ManualConfiguration}).
 * </ul>
 */
@Component
class ReleaseInfo {

  private static final Logger LOG = LoggerFactory.getLogger(ReleaseInfo.class);
  static final String VERSION_FILE = "version.properties";
  static final String MANUAL = "manual";

  private final Path manual;
  private final Map<String, Object> version;

  ReleaseInfo(@Value("${emc2.release.directory:}") String directory) {
    Path folder = Path.of(directory).toAbsolutePath().normalize();
    this.manual = folder.resolve(MANUAL);
    this.version = read(folder.resolve(VERSION_FILE));
  }

  /** The {@code version} of {@code GET /api/health}: name, date, commit, dirty and sdk, as far as known. */
  Map<String, Object> version() {
    return version;
  }

  /** Whether the release has its user manual. */
  boolean hasManual() {
    return Files.isRegularFile(manual.resolve("index.html"));
  }

  /** The manual's folder; it may not exist. */
  Path manualFolder() {
    return manual;
  }

  static Map<String, Object> read(Path file) {
    Map<String, Object> out = new LinkedHashMap<>();
    if (!Files.isRegularFile(file)) {
      out.put("name", "dev");
      out.put("sdk", Sdk.VERSION);
      return Collections.unmodifiableMap(out);
    }
    Properties p = new Properties();
    try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
      p.load(in);
    } catch (IOException | IllegalArgumentException e) {
      LOG.warn("{} cannot be read, so the version is not known: {}", VERSION_FILE, e.getMessage());
      out.put("name", "unknown");
      return Collections.unmodifiableMap(out);
    }
    String name = p.getProperty("emcc.version", "").strip();
    out.put("name", name.isEmpty() ? "unknown" : name);
    put(out, "date", p.getProperty("emcc.build.date"));
    put(out, "commit", p.getProperty("emcc.build.commit"));
    String dirty = p.getProperty("emcc.build.dirty");
    if (dirty != null && !dirty.isBlank()) {
      out.put("dirty", Boolean.parseBoolean(dirty.strip()));
    }
    put(out, "sdk", p.getProperty("emcc.sdk.version"));
    LOG.info("emcc {} ({})", out.get("name"), VERSION_FILE);
    return Collections.unmodifiableMap(out);
  }

  private static void put(Map<String, Object> out, String key, @Nullable String value) {
    if (value != null && !value.isBlank()) {
      out.put(key, value.strip());
    }
  }
}
