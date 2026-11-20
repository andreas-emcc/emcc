package dev.emcc.app;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The Content-Security-Policy sources ({@code 'sha256-…'}) of the inline import maps in the web
 * client's {@code index.html} (T-014).
 *
 * <p>The shell inlines its import map (spike S4): browsers do not load import maps from files, and
 * an inline script is blocked by {@code script-src 'self'} unless the policy names its hash. Only
 * {@code <script type="importmap">} elements count; any other inline script stays blocked.
 *
 * <p>The file is read again when its size or modification time changes, so a new build of the web
 * client is picked up without a restart.
 */
@Component
class InlineScriptHashes {

  private static final Logger LOG = LoggerFactory.getLogger(InlineScriptHashes.class);

  private static final Pattern IMPORT_MAP = Pattern.compile(
      "<script\\b[^>]*\\btype\\s*=\\s*[\"']?importmap[\"']?[^>]*>(.*?)</script\\s*>",
      Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

  private record Cached(long size, long modified, List<String> sources) {}

  private final Path indexFile;
  private volatile @Nullable Cached cached;

  InlineScriptHashes(@Value("${emc2.web.root}") String webRoot) {
    this.indexFile = Path.of(webRoot).toAbsolutePath().normalize().resolve("index.html");
  }

  /** The hash sources of the import maps in {@code index.html}; empty if there is no such file. */
  List<String> sources() {
    BasicFileAttributes attributes;
    try {
      attributes = Files.readAttributes(indexFile, BasicFileAttributes.class);
    } catch (IOException e) {
      return List.of();
    }
    long size = attributes.size();
    long modified = attributes.lastModifiedTime().toMillis();
    Cached current = cached;
    if (current != null && current.size() == size && current.modified() == modified) {
      return current.sources();
    }
    List<String> sources;
    try {
      sources = sourcesOf(Files.readString(indexFile, StandardCharsets.UTF_8));
    } catch (IOException e) {
      LOG.warn("Could not read {}: {}", indexFile, e.toString());
      return List.of();
    }
    cached = new Cached(size, modified, sources);
    return sources;
  }

  /** The hash source of every import map in the page, in page order. */
  static List<String> sourcesOf(String html) {
    List<String> sources = new ArrayList<>();
    Matcher m = IMPORT_MAP.matcher(html);
    while (m.find()) {
      sources.add("'sha256-" + Base64.getEncoder().encodeToString(sha256(m.group(1))) + "'");
    }
    return List.copyOf(sources);
  }

  private static byte[] sha256(String text) {
    try {
      return MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("every Java platform has SHA-256", e);
    }
  }
}
