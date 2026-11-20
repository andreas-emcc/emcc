package dev.emcc.plugins.gmti;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.plugins.gmti.transport.Link;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.TestJson;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Criterion 30 (M6, T-160): the Java {@link Link} keeps its own checks, and they agree with the settings
 * schema's {@code if}/{@code then} (brief section 5). The cases are {@code check/link-fields.json}, which
 * {@code check/manifest.test.mjs} runs against the schema.
 */
class LinkFieldsTest {

  /** What {@link Link#from} says for each field the schema reports missing. */
  private static final Map<String, String> SAYS = Map.of(
      "listen", "needs a listen port",
      "host", "needs a host",
      "port", "needs a port from 1 to 65535");

  private static JsonObject cases() throws IOException {
    return (JsonObject) TestJson.parse(Files.readString(Manifest.PLUGIN_FOLDER.resolve("check/link-fields.json")));
  }

  private static String text(JsonObject o, String name) {
    return ((JsonString) o.get(name)).value();
  }

  @Test
  void criterion30_theLinkAcceptsWhatTheSchemaAccepts() throws IOException {
    JsonArray accepted = (JsonArray) cases().get("accepted");
    assertThat(accepted.values()).hasSizeGreaterThanOrEqualTo(8);
    for (JsonValue c : accepted.values()) {
      JsonObject one = (JsonObject) c;
      assertThatCode(() -> Link.from((JsonObject) one.get("link"))).as(text(one, "why")).doesNotThrowAnyException();
    }
  }

  @Test
  void criterion30_theLinkRefusesWhatTheSchemaRefuses_atTheSameField() throws IOException {
    JsonArray refused = (JsonArray) cases().get("refused");
    assertThat(refused.values()).hasSizeGreaterThanOrEqualTo(8);
    for (JsonValue c : refused.values()) {
      JsonObject one = (JsonObject) c;
      assertThatThrownBy(() -> Link.from((JsonObject) one.get("link"))).as(text(one, "why"))
          .isInstanceOf(IllegalArgumentException.class).hasMessageContaining(SAYS.get(text(one, "missing")));
    }
  }
}
