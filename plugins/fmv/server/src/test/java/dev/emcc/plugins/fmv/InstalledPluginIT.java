package dev.emcc.plugins.fmv;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.testkit.FakePluginContext;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The plugin's <b>packaged jar</b>, installed as design pattern section 4 says ({@code
 * <id>/plugin.json}, {@code <id>/server/<jar>}) and loaded the way the plugin host loads it: in a
 * class loader that sees the Java platform, the SDK and JSpecify, and the jar, nothing else.
 *
 * <p>It runs in Maven's {@code integration-test} phase, after {@code package} ({@code mvn verify},
 * {@code node tools/test.mjs}), on the jar Maven built (system property {@code emc2.plugin.jar},
 * set in {@code pom.xml}); {@code mvn test} does not run it. It checks that the jar holds the entry
 * class, does not bundle the SDK or JSpecify, needs nothing that only the test class path has, and
 * starts. A library shaded into the jar is loaded from it like the plugin's own
 * classes. Extra library jars beside it are not covered. It does not use ECore; the real host is
 * checked by the ITA's runs. Every plugin with a server part keeps it.
 */
class InstalledPluginIT {

  @TempDir
  Path plugins;

  @Test
  void loadsAndAnswersFromThePackagedJar() throws Exception {
    Path packaged = Path.of(System.getProperty("emc2.plugin.jar", "(emc2.plugin.jar not set: run mvn verify)"));
    assertThat(packaged).as("the jar Maven packaged").isRegularFile();

    Path folder = Files.createDirectories(plugins.resolve(Manifest.id()).resolve("server")).getParent();
    Files.copy(Manifest.PLUGIN_FOLDER.resolve("plugin.json"), folder.resolve("plugin.json"));
    Path jar = Files.copy(packaged, folder.resolve("server").resolve(packaged.getFileName()));
    assertThat(folder.getFileName().toString()).isEqualTo(Manifest.id());

    try (var file = new JarFile(jar.toFile())) {
      assertThat(file.getEntry(Manifest.entryClass().replace('.', '/') + ".class")).as("entry class in the jar").isNotNull();
      assertThat(file.stream().map(JarEntry::getName))
          .as("ECore supplies the SDK and JSpecify; the jar never bundles them")
          .noneMatch(n -> n.startsWith("dev/emcc/sdk/") || n.startsWith("org/jspecify/"));
    }

    try (var loader = new HostLikeClassLoader(jar, Plugin.class.getClassLoader())) {
      Class<?> entry = Class.forName(Manifest.entryClass(), true, loader);
      assertThat(entry.getClassLoader()).as("loaded from the installed jar").isSameAs(loader);
      Plugin plugin = (Plugin) entry.getConstructor().newInstance();
      var context = FakePluginContext.builder(Manifest.id()).settings(Manifest.settingDefaults()).build();
      plugin.init(context);
      plugin.start();
      assertThat(context.effectiveStatus().state()).isEqualTo(dev.emcc.sdk.PluginState.OK);
      plugin.stop();
    }
  }

  /** Like the host's plugin class loader: the platform, the SDK and JSpecify from {@code sdk}, the rest only from the jar. */
  private static final class HostLikeClassLoader extends URLClassLoader {
    private final ClassLoader sdk;

    HostLikeClassLoader(Path jar, ClassLoader sdk) throws java.net.MalformedURLException {
      super("installed-" + Manifest.id(), new URL[] {jar.toUri().toURL()}, ClassLoader.getPlatformClassLoader());
      this.sdk = sdk;
    }

    @Override
    protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
      boolean shared = (name.startsWith("dev.emcc.sdk.") && !name.startsWith("dev.emcc.sdk.testkit.")) || name.startsWith("org.jspecify.");
      return shared ? sdk.loadClass(name) : super.loadClass(name, resolve);
    }
  }
}
