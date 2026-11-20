package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Sdk;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import org.junit.jupiter.api.Test;

class SdkVersionRangeTest {

  @Test
  void passesTheSharedCases() throws IOException {
    var file = TestJsonTest.MODEL.resolve("examples/sdk-version-matching.json");
    JsonArray cases = (JsonArray) ((JsonObject) TestJson.parse(Files.readString(file))).get("cases");
    assertThat(cases).isNotNull();
    assertThat(cases.size()).isGreaterThan(10);
    for (int i = 0; i < cases.size(); i++) {
      JsonObject c = (JsonObject) cases.get(i);
      assertThat(SdkVersionRange.accepts(c.getString("range"), c.getString("sdk"))).as(c.toString()).isEqualTo(c.getBoolean("compatible"));
    }
  }

  @Test
  void acceptsTheCurrentSdkInTheV1RangeAndRefusesV0Plugins() {
    assertThat(SdkVersionRange.accepts("^1.0.0", Sdk.VERSION)).as("a plugin built for SDK 1.0.0 still runs on 1.9.0 (CR-0015, CR-0025, CR-0028, CR-0030, CR-0038, CR-0041, CR-0042, CR-0043, CR-0048)").isTrue();
    assertThat(SdkVersionRange.accepts("^1.1.0", Sdk.VERSION)).isTrue();
    assertThat(SdkVersionRange.accepts("^1.2.0", Sdk.VERSION)).isTrue();
    assertThat(SdkVersionRange.accepts("^1.3.0", Sdk.VERSION)).isTrue();
    assertThat(SdkVersionRange.accepts("^1.4.0", Sdk.VERSION)).isTrue();
    assertThat(SdkVersionRange.accepts("^1.5.0", Sdk.VERSION)).isTrue();
    assertThat(SdkVersionRange.accepts("^1.6.0", Sdk.VERSION)).isTrue();
    assertThat(SdkVersionRange.accepts("^1.7.0", Sdk.VERSION)).isTrue();
    assertThat(SdkVersionRange.accepts("^1.8.0", Sdk.VERSION)).isTrue();
    assertThat(SdkVersionRange.accepts("^1.9.0", Sdk.VERSION)).isTrue();
    assertThat(SdkVersionRange.accepts("^0.1.0", Sdk.VERSION)).as("a plugin built for SDK v0 is refused by every 1.x (CR-0010)").isFalse();
  }

  @Test
  void rejectsMalformedInput() {
    assertThatThrownBy(() -> SdkVersionRange.accepts("^0.1", "0.1.0")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> SdkVersionRange.accepts("^0.1.0", "x")).isInstanceOf(IllegalArgumentException.class);
  }
}
