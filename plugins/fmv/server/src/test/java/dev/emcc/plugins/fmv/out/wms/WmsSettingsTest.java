package dev.emcc.plugins.fmv.out.wms;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.TestJson;
import org.junit.jupiter.api.Test;

/** The plugin-wide {@code wms} settings: a value the form would refuse never names a host. */
class WmsSettingsTest {

  private static WmsSettings read(String wms) {
    return WmsSettings.from((JsonObject) TestJson.parse("{\"wms\":" + wms + "}"));
  }

  @Test
  void theDefaultsAreOffEpsg3006Jpeg256At1m() {
    assertThat(WmsSettings.from(JsonObject.empty())).isEqualTo(WmsSettings.OFF);
    WmsSettings s = read("{\"enabled\":true}");
    assertThat(s.crs()).isEqualTo(ImagerySet.Crs.EPSG_3006);
    assertThat(s.format()).isEqualTo("image/jpeg");
    assertThat(s.tilePixels()).isEqualTo(256);
    assertThat(s.metresPerPixel()).isEqualTo(1);
    assertThat(s.whyNotFetching()).isEqualTo("no server");
  }

  @Test
  void aUrlThatIsNoPlainAddressIsNoServerSoNothingIsFetched() {
    assertThat(WmsSettings.url("https://wms.example/ows")).isEqualTo("https://wms.example/ows");
    assertThat(WmsSettings.url("http://localhost:8080/geoserver/wms")).isNotNull();
    assertThat(WmsSettings.url("https://wms.example/a|b")).isNull(); // the pattern lets it by, URI does not (review remark 1)
    assertThat(WmsSettings.url("https://wms.example/a\"b")).isNull();
    assertThat(WmsSettings.url("https://user:secret@wms.example/ows")).isNull(); // a password is never a setting
    assertThat(WmsSettings.url("https://wms.example/ows?SERVICE=WMS")).isNull();
    assertThat(WmsSettings.url("ftp://wms.example/ows")).isNull();
    assertThat(WmsSettings.url("https:///ows")).isNull();
    WmsSettings bad = read("{\"enabled\":true,\"url\":\"https://wms.example/a|b\",\"layer\":\"o\",\"source\":\"s\",\"licence\":\"l\"}");
    assertThat(bad.url()).isNull();
    assertThat(bad.whyNotFetching()).isEqualTo("no server");
    assertThat(bad.host()).isEmpty();
  }

  @Test
  void itFetchesOnlyWithAServerALayerASourceAndALicence() {
    String base = "\"enabled\":true,\"url\":\"https://wms.example/ows\",\"layer\":\"ortho\"";
    assertThat(read("{" + base + ",\"source\":\"s\",\"licence\":\"l\"}").whyNotFetching()).isNull();
    assertThat(read("{" + base + ",\"source\":\"s\"}").whyNotFetching()).isEqualTo("no source or licence");
    assertThat(read("{" + base + ",\"licence\":\"l\"}").whyNotFetching()).isEqualTo("no source or licence");
    assertThat(read("{\"enabled\":false,\"url\":\"https://wms.example/ows\",\"layer\":\"ortho\",\"source\":\"s\",\"licence\":\"l\"}").whyNotFetching())
        .isEqualTo("off");
    assertThat(read("{" + base + ",\"source\":\"s\",\"licence\":\"l\",\"token\":\"Bearer x\"}").token()).isNull();
    assertThat(read("{" + base + ",\"source\":\"s\",\"licence\":\"l\"}").host()).isEqualTo("wms.example");
  }
}
