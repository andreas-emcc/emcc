package dev.emcc.plugins.terrain;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import org.junit.jupiter.api.Test;

/** The {@code timeoutSeconds} setting: 5 to 55, since the SDK caps an endpoint and a compute worker at 60 s (owner, 2026-11-08). */
class LimitsTest {

  private static JsonObject timeoutSchema() {
    return Manifest.read().getObject("settings").getObject("properties").getObject("timeoutSeconds");
  }

  @Test
  void theSchemaAllowsFiveToFiftyFiveSecondsAndDefaultsToThirty() {
    JsonObject schema = timeoutSchema();
    assertThat(schema.getNumber("minimum").longValueExact()).isEqualTo(5);
    assertThat(schema.getNumber("maximum").longValueExact()).isEqualTo(55);
    assertThat(schema.getNumber("default").longValueExact()).isEqualTo(30);
  }

  @Test
  void theDefaultSettingsGiveThirtySeconds() {
    assertThat(Limits.read(Manifest.settingDefaults()).timeoutSeconds()).isEqualTo(30);
  }

  @Test
  void aValueOutsideTheLimitsIsReplacedByTheNearestAllowedOne() {
    JsonObject defaults = Manifest.settingDefaults();
    assertThat(Limits.read(defaults.with("timeoutSeconds", JsonNumber.of(55L))).timeoutSeconds()).isEqualTo(55);
    assertThat(Limits.read(defaults.with("timeoutSeconds", JsonNumber.of(300L))).timeoutSeconds()).isEqualTo(55);
    assertThat(Limits.read(defaults.with("timeoutSeconds", JsonNumber.of(5L))).timeoutSeconds()).isEqualTo(5);
    assertThat(Limits.read(defaults.with("timeoutSeconds", JsonNumber.of(1L))).timeoutSeconds()).isEqualTo(5);
  }
}
