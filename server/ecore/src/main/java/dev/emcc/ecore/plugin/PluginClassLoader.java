package dev.emcc.ecore.plugin;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.MalformedURLException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.stream.Stream;
import org.jspecify.annotations.Nullable;

/**
 * One class loader per plugin (overview 4.1, ADR-0003). It sees the Java platform, the Plugin SDK
 * and JSpecify (from ECore's own class loader, so that ECore and the plugin share the SDK's
 * classes), and the plugin's own jars, including bundled libraries. It does not see ECore, Spring,
 * Jackson, the SDK's test kit or other plugins. This avoids dependency conflicts; it is not a
 * security sandbox (plugins are trusted).
 */
final class PluginClassLoader extends URLClassLoader {

  static {
    registerAsParallelCapable();
  }

  /** What a plugin may see of ECore's class path. */
  private static final List<String> SHARED = List.of("dev.emcc.sdk.", "org.jspecify.annotations.");
  private static final String TEST_KIT = "dev.emcc.sdk.testkit.";

  private final ClassLoader sdk;

  /**
   * @param jars the plugin's jars
   * @param sdk the class loader that holds the Plugin SDK (ECore's own)
   */
  PluginClassLoader(String pluginId, List<Path> jars, ClassLoader sdk) {
    super("plugin-" + pluginId, urls(jars), ClassLoader.getPlatformClassLoader());
    this.sdk = sdk;
  }

  /** The jars in {@code directory}, sorted by name; empty if there is no such directory. */
  static List<Path> jarsIn(Path directory) {
    if (!Files.isDirectory(directory)) {
      return List.of();
    }
    try (Stream<Path> files = Files.list(directory)) {
      return files.filter(f -> f.getFileName().toString().endsWith(".jar") && Files.isRegularFile(f)).sorted().toList();
    } catch (IOException e) {
      throw new UncheckedIOException("cannot list " + directory, e);
    }
  }

  private static URL[] urls(List<Path> jars) {
    List<URL> urls = new ArrayList<>();
    for (Path jar : jars) {
      try {
        urls.add(jar.toUri().toURL());
      } catch (MalformedURLException e) {
        throw new IllegalArgumentException("bad jar path " + jar, e);
      }
    }
    return urls.toArray(URL[]::new);
  }

  static boolean isShared(String name) {
    String dotted = name.replace('/', '.');
    return !dotted.startsWith(TEST_KIT) && SHARED.stream().anyMatch(dotted::startsWith);
  }

  @Override
  protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
    if (isShared(name)) {
      return sdk.loadClass(name);
    }
    return super.loadClass(name, resolve); // the platform, then the plugin's jars
  }

  @Override
  public @Nullable URL getResource(String name) {
    if (isShared(name)) {
      return sdk.getResource(name);
    }
    return super.getResource(name);
  }

  @Override
  public Enumeration<URL> getResources(String name) throws IOException {
    if (isShared(name)) {
      return sdk.getResources(name);
    }
    return name.isEmpty() ? Collections.emptyEnumeration() : super.getResources(name);
  }
}
