package dev.emcc.ecore.plugin;

import dev.emcc.ecore.plugin.testplugin.TestPlugin;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Installs test plugins in the installed layout ({@code <id>/plugin.json}, {@code <id>/server/*.jar}).
 * The jar holds the compiled classes of {@code dev.emcc.ecore.plugin.testplugin}, so the plugin
 * host loads them in the plugin's own class loader, not from the test class path.
 */
public final class PluginFolders {

  public static final String ENTRY_CLASS = TestPlugin.class.getName();

  private final Path directory;
  private Path jar;

  public PluginFolders(Path directory) {
    this.directory = directory;
  }

  public Path directory() {
    return directory;
  }

  /** A working test plugin with a server part. */
  public PluginFolders plugin(String id) {
    return plugin(id, "ok", List.of(), false);
  }

  /** A test plugin; {@code mode} as in {@link TestPlugin}. */
  public PluginFolders plugin(String id, String mode, List<String> dependsOn, boolean required) {
    return install(id, manifest(id, "^1.0.0", ENTRY_CLASS, mode, dependsOn, required), true);
  }

  /** A folder with this manifest text, with or without the test jar. */
  public PluginFolders install(String folder, String manifest, boolean withJar) {
    try {
      Path dir = Files.createDirectories(directory.resolve(folder));
      Files.writeString(dir.resolve(PluginManifest.FILE), manifest);
      if (withJar) {
        Files.copy(jar(), Files.createDirectories(dir.resolve("server")).resolve("test-plugin.jar"));
      }
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    return this;
  }

  public static String manifest(String id, String sdkVersion, String entryClass, String mode, List<String> dependsOn,
      boolean required) {
    return """
        {"id": "%s", "name": "Test plugin %s", "version": "0.1.0", "sdkVersion": "%s", "kind": "general",
         "dependsOn": [%s], "required": %s,
         "server": {"entryClass": "%s"},
         "settings": {"type": "object", "properties": {"mode": {"type": "string", "default": "%s"}}}}
        """.formatted(id, id, sdkVersion, dependsOn.stream().map(d -> '"' + d + '"').collect(Collectors.joining(", ")),
        required, entryClass, mode);
  }

  /** The test plugin's jar, built once per instance. */
  private Path jar() throws IOException {
    if (jar != null) {
      return jar;
    }
    Path classes;
    try {
      classes = Path.of(TestPlugin.class.getProtectionDomain().getCodeSource().getLocation().toURI());
    } catch (URISyntaxException e) {
      throw new IllegalStateException(e);
    }
    Path packageDir = classes.resolve(TestPlugin.class.getPackageName().replace('.', '/'));
    jar = Files.createTempFile("emc2-test-plugin", ".jar");
    jar.toFile().deleteOnExit(); // one per test run; on Windows only if no class loader still holds it
    try (JarOutputStream out = new JarOutputStream(Files.newOutputStream(jar)); Stream<Path> files = Files.walk(packageDir)) {
      for (Path file : files.filter(Files::isRegularFile).toList()) {
        out.putNextEntry(new JarEntry(classes.relativize(file).toString().replace('\\', '/')));
        Files.copy(file, out);
        out.closeEntry();
      }
    }
    jar.toFile().deleteOnExit();
    return jar;
  }
}
