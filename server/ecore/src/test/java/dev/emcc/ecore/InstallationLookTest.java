package dev.emcc.ecore;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.persistence.ConfigStore;
import dev.emcc.ecore.persistence.Configuration;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The installation's default look (ADR-0034 point 2). */
class InstallationLookTest {

  @TempDir Path dir;

  private final ModelJson json = new ModelJson();

  @Test
  void isNightWatchUntilAnAdminSetsOneWhichIsStored() {
    InstallationLook look = new InstallationLook(new Configuration(new ConfigStore(dir, json)));
    assertThat(look.current()).isEqualTo("night-watch");
    look.set("signal");
    assertThat(look.current()).isEqualTo("signal");
    assertThat(new InstallationLook(new Configuration(new ConfigStore(dir, json))).current()).as("after a restart").isEqualTo("signal");
  }

  @Test
  void refusesALookItDoesNotKnowAndReadsAnUnknownStoredOneAsTheBuiltIn() {
    ConfigStore store = new ConfigStore(dir, json);
    store.save(ConfigStore.Config.EMPTY.withDefaultLook("pink"));
    InstallationLook look = new InstallationLook(new Configuration(store));
    assertThat(look.current()).isEqualTo("night-watch");
    assertThatThrownBy(() -> look.set("Signal")).isInstanceOf(IllegalArgumentException.class)
        .hasMessage("a look is one of night-watch, chart-room, signal, not Signal");
  }
}
