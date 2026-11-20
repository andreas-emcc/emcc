package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.nio.file.attribute.UserPrincipal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.apache.commons.logging.Log;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

/** ADR-0060, M9 C1: the settings files, their order, {@code %emcc%/}, the deprecated local file and the credentials check. */
class SettingsFilesTest {

  @TempDir
  Path emcc;

  final RecordingLog log = new RecordingLog();

  /** An environment as Spring has it after its own files: the command line, the environment, the bundled defaults. */
  StandardEnvironment environment(Map<String, Object> env) {
    StandardEnvironment e = new StandardEnvironment();
    e.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
    e.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
    e.getPropertySources().addFirst(new MapPropertySource(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME, env));
    e.getPropertySources().addFirst(new MapPropertySource("commandLineArgs", Map.of("server.port", "9999")));
    e.getPropertySources().addLast(new MapPropertySource("bundled", Map.of("a", "bundled", "b", "bundled", "c", "bundled",
        "d", "bundled", "e", "bundled", "server.port", "8080")));
    return e;
  }

  void write(String file, String... lines) throws IOException {
    Path p = emcc.resolve(file);
    Files.createDirectories(p.getParent());
    Files.write(p, List.of(lines));
  }

  void run(StandardEnvironment e) {
    new SettingsFiles(log, emcc).postProcessEnvironment(e, new SpringApplication());
  }

  @Test
  void laterFilesWinTheEnvironmentAndCommandLineWinOverAll() throws IOException {
    write("application-local.properties", "a=local", "b=local", "c=local", "d=local");
    write("settings/emcc.properties", "# a comment", "b=settings", "c=settings", "d=settings");
    write("settings/credentials/login.properties", "c=credentials", "d=credentials");
    StandardEnvironment e = environment(Map.of("d", "env"));

    run(e);

    assertThat(e.getProperty("a")).isEqualTo("local");
    assertThat(e.getProperty("b")).isEqualTo("settings");
    assertThat(e.getProperty("c")).isEqualTo("credentials");
    assertThat(e.getProperty("d")).isEqualTo("env");
    assertThat(e.getProperty("e")).isEqualTo("bundled");
    assertThat(e.getProperty("server.port")).isEqualTo("9999");
    assertThat(log.warns).anySatisfy(w -> assertThat(w).contains("application-local.properties is deprecated"))
        .anySatisfy(w -> assertThat(w).contains("also in the settings files").contains("b, c, d").doesNotContain("=")); // names only, never values
  }

  @Test
  void needsNoFileAndWarnsOfNothingWithout() {
    StandardEnvironment e = environment(Map.of());

    run(e);

    assertThat(e.getProperty("a")).isEqualTo("bundled");
    assertThat(log.warns).isEmpty();
  }

  @Test
  void resolvesEmccPathsBelowTheEmccFolderInEveryFile() throws IOException {
    write("settings/emcc.properties", "emc2.conversions.ffmpeg=%emcc%/tools/ffmpeg/ffmpeg.exe", "other=%emcc%x", "plain=data");
    write("settings/credentials/tls-tak.properties", "emc2.listeners.credentials.tak.key-store=%emcc%\\\\settings\\\\credentials\\\\tak.p12");
    StandardEnvironment e = environment(Map.of());

    run(e);

    assertThat(e.getProperty("emc2.conversions.ffmpeg")).isEqualTo(emcc.resolve("tools/ffmpeg/ffmpeg.exe").toString());
    assertThat(Path.of(e.getProperty("emc2.listeners.credentials.tak.key-store", "")))
        .isEqualTo(emcc.resolve("settings\\credentials\\tak.p12").normalize()); // a folder path on Windows, one name on POSIX
    assertThat(e.getProperty("other")).isEqualTo("%emcc%x");
    assertThat(e.getProperty("plain")).isEqualTo("data");
  }

  @Test
  void readsOnlyPropertiesFilesOfTheCredentialsFolderInNameOrder() throws IOException {
    write("settings/credentials/a.properties", "k=a");
    write("settings/credentials/b.properties", "k=b");
    write("settings/credentials/tak.p12", "not properties=x");
    StandardEnvironment e = environment(Map.of());

    run(e);

    assertThat(e.getProperty("k")).isEqualTo("b");
    assertThat(e.getProperty("not properties")).isNull();
  }

  @Test
  void recognisesTheWindowsGroupsThatMakeAFileReadableByOthers() {
    assertThat(SettingsFiles.aclReadableByOthers(List.of(entry("NT AUTHORITY\\SYSTEM", true), entry("BUILTIN\\Administrators", true),
        entry("HOST\\emcc", true)))).isFalse();
    assertThat(SettingsFiles.aclReadableByOthers(List.of(entry("BUILTIN\\Users", true)))).isTrue();
    assertThat(SettingsFiles.aclReadableByOthers(List.of(entry("\\Everyone", true)))).isTrue();
    assertThat(SettingsFiles.aclReadableByOthers(List.of(entry("NT AUTHORITY\\Authenticated Users", true)))).isTrue();
    assertThat(SettingsFiles.aclReadableByOthers(List.of(entry("BUILTIN\\Users", false)))).as("no read").isFalse();
    AclEntry deny = AclEntry.newBuilder().setType(AclEntryType.DENY).setPrincipal(principal("BUILTIN\\Users"))
        .setPermissions(AclEntryPermission.READ_DATA).build();
    assertThat(SettingsFiles.aclReadableByOthers(List.of(deny))).isFalse();
  }

  @Test
  void checksPosixPermissions() throws IOException {
    assumeTrue(Files.getFileAttributeView(emcc, PosixFileAttributeView.class) != null, "POSIX only");
    write("settings/credentials/login.properties", "x=1");
    Path file = emcc.resolve("settings/credentials/login.properties");
    Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
    assertThat(SettingsFiles.readableByOthers(file)).isFalse();
    Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-r-----"));
    assertThat(SettingsFiles.readableByOthers(file)).isTrue();
  }

  @Test
  void warnsOfAReadableCredentialsFileAndRefusesTheStartWhenAskedTo() throws IOException {
    write("settings/credentials/login.properties", "emc2.login.oidc.client-secret=very-secret");
    SettingsFiles files = new SettingsFiles(log, emcc) {
      @Override
      List<String> readableByOthers(List<Path> credentials) {
        return credentials.stream().map(p -> p.getFileName().toString()).toList();
      }
    };

    files.postProcessEnvironment(environment(Map.of()), new SpringApplication());
    assertThat(log.warns).singleElement().satisfies(w -> assertThat(w).contains("settings/credentials/login.properties")
        .contains("other users").doesNotContain("very-secret"));

    StandardEnvironment strict = environment(Map.of(SettingsFiles.REQUIRE_PRIVATE, "true"));
    assertThatIllegalStateException().isThrownBy(() -> files.postProcessEnvironment(strict, new SpringApplication()))
        .withMessageContaining("settings/credentials/login.properties").withMessageNotContaining("very-secret");
  }

  @Test
  void checksNoTemplateThatHoldsNoSettingButTheSameFileWithOneLineSet() throws IOException {
    // owner ABV A: a zip carries no Windows rights, so every unpacked template would warn
    String[] template = {"# The client secret of emcc's client at the IAM.", "", "#emc2.login.oidc.client-secret=", "! another comment"};
    write("settings/credentials/login.properties", template);
    write("settings/credentials/server.p12", "not really a key store");
    List<String> checked = new ArrayList<>();
    SettingsFiles files = new SettingsFiles(log, emcc) {
      @Override
      List<String> readableByOthers(List<Path> credentials) {
        credentials.forEach(p -> checked.add(p.getFileName().toString()));
        return credentials.stream().map(p -> p.getFileName().toString()).toList();
      }
    };

    files.postProcessEnvironment(environment(Map.of()), new SpringApplication());
    assertThat(checked).as("the template is skipped, a key store never").containsExactly("server.p12");
    assertThat(log.warns).singleElement().satisfies(w -> assertThat(w).contains("settings/credentials/server.p12"));

    log.warns.clear();
    checked.clear();
    write("settings/credentials/login.properties", "# The client secret of emcc's client at the IAM.", "",
        "emc2.login.oidc.client-secret=very-secret");
    files.postProcessEnvironment(environment(Map.of()), new SpringApplication());
    assertThat(checked).containsExactly("login.properties", "server.p12");
    assertThat(log.warns).anySatisfy(w -> assertThat(w).contains("settings/credentials/login.properties").doesNotContain("very-secret"));

    checked.clear();
    write("settings/credentials/login.properties", "# a template", "emc2.login.oidc.client-secret");
    files.postProcessEnvironment(environment(Map.of()), new SpringApplication());
    assertThat(checked).as("a key without '=' is a setting too").containsExactly("login.properties", "server.p12");
  }

  @Test
  void requirePrivateStartsWithTemplatesOnly() throws IOException {
    write("settings/credentials/login.properties", "# a template", "#emc2.login.oidc.client-secret=");
    write("settings/credentials/https.properties", "", "# another");
    SettingsFiles files = new SettingsFiles(log, emcc) {
      @Override
      List<String> readableByOthers(List<Path> credentials) {
        return credentials.stream().map(p -> p.getFileName().toString()).toList();
      }
    };

    files.postProcessEnvironment(environment(Map.of(SettingsFiles.REQUIRE_PRIVATE, "true")), new SpringApplication());
    assertThat(log.warns).isEmpty();
  }

  static AclEntry entry(String name, boolean read) {
    return AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(principal(name))
        .setPermissions(read ? AclEntryPermission.READ_DATA : AclEntryPermission.WRITE_DATA).build();
  }

  static UserPrincipal principal(String name) {
    return () -> name;
  }

  /** The warnings and infos the reader logged. */
  static final class RecordingLog implements Log {
    final List<String> warns = new ArrayList<>();
    final List<String> infos = new ArrayList<>();

    @Override public boolean isDebugEnabled() { return false; }
    @Override public boolean isErrorEnabled() { return true; }
    @Override public boolean isFatalEnabled() { return true; }
    @Override public boolean isInfoEnabled() { return true; }
    @Override public boolean isTraceEnabled() { return false; }
    @Override public boolean isWarnEnabled() { return true; }
    @Override public void trace(Object message) {}
    @Override public void trace(Object message, Throwable t) {}
    @Override public void debug(Object message) {}
    @Override public void debug(Object message, Throwable t) {}
    @Override public void info(Object message) { infos.add(String.valueOf(message)); }
    @Override public void info(Object message, Throwable t) { infos.add(String.valueOf(message)); }
    @Override public void warn(Object message) { warns.add(String.valueOf(message)); }
    @Override public void warn(Object message, Throwable t) { warns.add(String.valueOf(message)); }
    @Override public void error(Object message) { warns.add(String.valueOf(message)); }
    @Override public void error(Object message, Throwable t) { warns.add(String.valueOf(message)); }
    @Override public void fatal(Object message) { warns.add(String.valueOf(message)); }
    @Override public void fatal(Object message, Throwable t) { warns.add(String.valueOf(message)); }
  }
}
