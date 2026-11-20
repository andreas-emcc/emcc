package dev.emcc.plugins.ais;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.Sdk;
import dev.emcc.sdk.testkit.PluginRules;
import dev.emcc.sdk.testkit.SdkVersionRange;
import java.io.IOException;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * What the plugin host checks when it loads the plugin (design pattern, "Built output"), plus the
 * the names a copy of the template had to change. Every plugin keeps this test.
 */
class InstalledLayoutTest {

  @Test
  void folderIsNamedLikeThePluginId() {
    assertThat(Manifest.PLUGIN_FOLDER.getFileName().toString()).isEqualTo(Manifest.id());
  }

  @Test
  void mavenArtifactIsNamedAfterThePluginId() throws IOException {
    String pom = Files.readString(Manifest.PLUGIN_FOLDER.resolve("server/pom.xml"));
    var own = Pattern.compile("</parent>\\s*<artifactId>([^<]+)</artifactId>").matcher(pom);
    assertThat(own.find()).as("artifactId after <parent>").isTrue();
    assertThat(own.group(1)).isEqualTo("emc2-plugin-" + Manifest.id());
  }

  @Test
  void entryClassIsAPluginInThePluginsPackage() throws Exception {
    Class<?> entry = Class.forName(Manifest.entryClass());
    assertThat(Plugin.class).isAssignableFrom(entry);
    assertThat(entry.getPackageName()).isEqualTo(PluginRules.packageFor(Manifest.id()));
    assertThat(Modifier.isPublic(entry.getModifiers())).isTrue();
    assertThat(Modifier.isPublic(entry.getConstructor().getModifiers())).as("public no-argument constructor").isTrue();
  }

  @Test
  void sdkVersionRangeAcceptsTheSdkThePluginIsBuiltAgainst() {
    // Sdk.VERSION is a compile-time constant: here it is the SDK version this plugin is compiled with.
    assertThat(SdkVersionRange.accepts(Manifest.read().getString("sdkVersion"), Sdk.VERSION)).isTrue();
  }

  @Test
  void everySettingHasADefault() {
    assertThat(Manifest.settingDefaults().names()).isNotEmpty();
  }
}
