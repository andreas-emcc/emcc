package dev.emcc.plugins.basemapwms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.TestJson;
import java.net.URI;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/** The settings schema (criterion 19: WMTS is a stub), the defaults, and the address handling. */
class SettingsTest {

  private static JsonObject serverSchema() {
    JsonObject servers = Manifest.read().getObject("settings").getObject("properties").getObject("servers");
    return servers.getObject("items").getObject("properties");
  }

  @Test
  void theSchemaAcceptsOnlyWmsAsAServersProtocol() {
    JsonObject protocol = serverSchema().getObject("protocol");

    assertThat(protocol.get("enum")).isEqualTo(JsonArray.of(JsonString.of("wms")));
    assertThat(((JsonString) protocol.get("default")).value()).isEqualTo("wms");
  }

  @Test
  void theSettingsAreEmptyByDefault() {
    JsonObject defaults = Manifest.settingDefaults();

    assertThat(defaults.get("servers")).isEqualTo(JsonArray.of());
    assertThat(defaults.get("backgrounds")).isEqualTo(JsonArray.of());
    assertThat(WmsSettings.parse(defaults)).isEqualTo(WmsSettings.empty());
  }

  @Test
  void theCodesDefaultsAreTheManifestsDefaults() {
    JsonObject server = serverSchema();
    assertThat(((JsonString) server.getObject("version").get("default")).value()).isEqualTo(WmsSettings.DEFAULT_VERSION);
    assertThat(server.getObject("timeoutSeconds").getNumber("default").longValueExact()).isEqualTo(WmsSettings.DEFAULT_TIMEOUT_SECONDS);
    JsonObject background = Manifest.read().getObject("settings").getObject("properties").getObject("backgrounds").getObject("items").getObject("properties");
    assertThat(((JsonString) background.getObject("format").get("default")).value()).isEqualTo(WmsSettings.DEFAULT_FORMAT);
  }

  @Test
  void anAbsentPropertyTakesItsDefault() {
    WmsSettings parsed = WmsSettings.parse((JsonObject) TestJson.parse("""
        {"servers":[{"id":"geo","name":"Geo","url":"http://wms.test/ows"}],
         "backgrounds":[{"id":"topo","name":"Topo","server":"geo","layers":["land"],"attribution":{"text":"x"}}]}
        """));

    assertThat(parsed.servers().getFirst()).isEqualTo(new WmsSettings.Server("geo", "Geo", "http://wms.test/ows", "1.3.0", 8));
    assertThat(parsed.backgrounds().getFirst()).isEqualTo(new WmsSettings.Background("topo", "Topo", "geo", List.of("land"), "image/png", false));
    assertThat(parsed.problems()).isEmpty();
  }

  @Test
  void aValueOfTheWrongTypeOrAnotherProtocolIsRefused() {
    assertThatThrownBy(() -> WmsSettings.parse((JsonObject) TestJson.parse("{\"servers\":{}}"))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> WmsSettings.parse((JsonObject) TestJson.parse("{\"servers\":[{\"id\":\"a\",\"url\":\"http://x/\",\"protocol\":\"wmts\"}]}")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("wms");
    assertThatThrownBy(() -> WmsSettings.parse((JsonObject) TestJson.parse("{\"backgrounds\":[{\"id\":\"a\",\"server\":\"s\",\"layers\":[1]}]}")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theUrlPatternRefusesUserNamesPasswordsAndOtherSchemes() {
    String pattern = ((JsonString) serverSchema().getObject("url").get("pattern")).value();
    Pattern url = Pattern.compile(pattern);

    for (String good : List.of("http://127.0.0.1:8280/geoserver/ows", "https://wms.example.org/ows?map=/x.map", "http://host")) {
      assertThat(url.matcher(good).matches()).as(good).isTrue();
    }
    for (String bad : List.of("http://user:secret@wms.test/ows", "https://user@wms.test/", "ftp://wms.test/", "wms.test/ows", "http://", "http://wms.test/a b")) {
      assertThat(url.matcher(bad).matches()).as(bad).isFalse();
    }
  }

  @Test
  void aLayerNameMayNotHoldACommaOrBeginWithSpace() {
    JsonObject items = Manifest.read().getObject("settings").getObject("properties").getObject("backgrounds").getObject("items").getObject("properties")
        .getObject("layers").getObject("items");
    Pattern layer = Pattern.compile(((JsonString) items.get("pattern")).value());

    assertThat(layer.matcher("emc2:background").matches()).isTrue();
    assertThat(layer.matcher("a,b").matches()).isFalse();
    assertThat(layer.matcher(" a").matches()).isFalse();
    assertThat(layer.matcher("").matches()).isFalse();
  }

  @Test
  void theSettingsHoldNoSecrets() {
    // no property for a login: the address may not hold one either (the pattern test above)
    JsonObject settings = Manifest.read().getObject("settings").getObject("properties");
    List<String> names = new java.util.ArrayList<>(settings.names());
    names.addAll(serverSchema().names());
    names.addAll(settings.getObject("backgrounds").getObject("items").getObject("properties").names());

    assertThat(names).noneMatch(n -> n.toLowerCase(java.util.Locale.ROOT).matches(".*(password|passwd|secret|token|apikey|key|user|login|credential).*"));
  }

  @Test
  void theManifestDeclaresInternetWithoutHostsAndSdk18() {
    JsonObject manifest = Manifest.read();
    JsonObject internet = manifest.getObject("internet");

    assertThat(internet.get("hosts")).isEqualTo(JsonArray.of());
    assertThat(internet.getString("reason")).isNotBlank();
    assertThat(manifest.getString("sdkVersion")).isEqualTo("^1.8.0");
    assertThat(manifest.getString("kind")).isEqualTo("background-map");
    JsonValue provides = manifest.get("provides");
    assertThat(provides).isEqualTo(JsonArray.of(JsonString.of("emc2.background-map")));
  }

  // ---------------------------------------------------------------- the address

  @Test
  void anOwnParameterAlreadyInTheQueryIsReplacedAndOthersStay() {
    URI uri = WmsUrl.build(
        "http://wms.test/cgi?map=/data/a%20b.map&Service=other&bbox=1&x=y#frag",
        List.of(new WmsUrl.Param("SERVICE", "WMS"), new WmsUrl.Param("LAYERS", "emc2:a b,c")));

    assertThat(uri.toString()).isEqualTo("http://wms.test/cgi?map=/data/a%20b.map&x=y&SERVICE=WMS&LAYERS=emc2:a%20b,c");
  }

  @Test
  void anAddressWithoutAQueryGetsOne() {
    assertThat(WmsUrl.build("https://wms.test/ows", List.of(new WmsUrl.Param("SERVICE", "WMS"))).toString()).isEqualTo("https://wms.test/ows?SERVICE=WMS");
  }

  @Test
  void anAddressThatIsNotUsableIsNamedInTheStatusNotThrown() {
    assertThat(WmsUrl.isUsable("http://wms.test/{bad}")).isFalse();
    WmsSettings parsed = WmsSettings.parse((JsonObject) TestJson.parse("{\"servers\":[{\"id\":\"geo\",\"name\":\"G\",\"url\":\"http://wms.test/{bad}\"}]}"));
    assertThat(parsed.servers()).isEmpty();
    assertThat(parsed.problems()).singleElement().asString().contains("server geo");
  }
}
