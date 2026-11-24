package dev.emcc.plugins.uavsimulation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.plugins.uavsimulation.pose.Frame;
import dev.emcc.plugins.uavsimulation.pose.Pointing;
import dev.emcc.plugins.uavsimulation.pose.Sway;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.testkit.TestJson;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** A camera's settings and their limits (brief section 5). */
class CameraSettingsTest {

  private static CameraSettings parse(String json) throws CameraSettings.Invalid {
    return CameraSettings.parse((JsonObject) TestJson.parse(json), CameraSettings.DEFAULTS);
  }

  @ParameterizedTest(name = "{0}: {1} refused, {2} kept")
  @DisplayName("Criterion 3: each setting just outside its limits is refused naming the field; just inside it is kept")
  @CsvSource(delimiter = ';', value = {
      "pointHeight; -1000.1; -1000",
      "pointHeight; 10000.1; 10000",
      "azimuth; -0.1; 0",
      "azimuth; 360.1; 360",
      "depression; -90.1; -90",
      "depression; 90.1; 90",
      "sectorStart; 360.1; 0.5",
      "sectorEnd; -0.1; 0",
      "sweepRate; 0.49; 0.5",
      "sweepRate; 90.1; 90",
      "horizontalFov; 0.09; 0.1",
      "horizontalFov; 120.1; 120",
      "frameRate; 0; 1",
      "frameRate; 31; 30",
      "frameRate; 24.5; 24",
      "height; 9.9; 10",
      "height; 20000.1; 20000",
      "swayAmplitude; -0.1; 0",
      "swayAmplitude; 5.1; 5",
      "swayMinFrequency; 0.09; 0.1",
      "swayMaxFrequency; 10.1; 10",
      "swayJoltsPerMinute; -1; 0",
      "swayJoltsPerMinute; 60.1; 60",
      "swayJoltStrength; -0.1; 0",
      "swayJoltStrength; 10.1; 10",
      "swayJoltDecay; 0.04; 0.05",
      "swayJoltDecay; 5.1; 5",
      "swaySeed; -1; 0",
      "swaySeed; 2147483648; 2147483647",
      "swaySeed; 1.5; 2"})
  void limits(String field, String outside, String inside) throws CameraSettings.Invalid {
    assertThatThrownBy(() -> parse("{\"" + field + "\": " + outside + "}"))
        .isInstanceOfSatisfying(CameraSettings.Invalid.class, e -> assertThat(e.field).isEqualTo(field));
    JsonObject kept = parse("{\"" + field + "\": " + inside + "}").json();
    double expected = Double.parseDouble(inside);
    double value = kept.getNumber(field).doubleValue();
    assertThat(value).isEqualTo(field.equals("azimuth") && expected == 360 ? 0 : expected);
  }

  @Test
  @DisplayName("Criterion 3: the point, the frame size, the Mission and the mode have their limits too")
  void otherLimits() throws CameraSettings.Invalid {
    assertField("{\"point\": [180.1, 62.4]}", "point");
    assertField("{\"point\": [17.3, 90.1]}", "point");
    assertField("{\"point\": [62.4]}", "point");
    assertThat(parse("{\"point\": [-180, -90]}").point()).isEqualTo(Position.of(-180, -90));
    assertThat(parse("{\"point\": [17.3, 62.4]}").point()).as("lon, lat").isEqualTo(Position.of(17.3, 62.4));
    assertField("{\"frameSize\": \"1280x1024\"}", "frameSize");
    assertThat(parse("{\"frameSize\": \"1920x1080\"}").frame()).isEqualTo(new Frame(1920, 1080, 25));
    assertField("{\"mission\": \"" + "M".repeat(65) + "\"}", "mission");
    assertThat(parse("{\"mission\": \"" + "Å".repeat(64) + "\"}").mission()).hasSize(64);
    assertThat(parse("{\"mission\": \"   \"}").mission()).isEmpty();
    assertField("{\"mode\": \"zoom\"}", "mode");
    assertField("{\"target\": \"not-a-uuid\"}", "target");
  }

  @Test
  @DisplayName("Criterion 3 (U8): equal sweep bearings are refused, also 0 and 360")
  void equalSweepBearings() {
    assertField("{\"sectorStart\": 45, \"sectorEnd\": 45}", "sectorEnd");
    assertField("{\"sectorStart\": 0, \"sectorEnd\": 360}", "sectorEnd");
  }

  @Test
  @DisplayName("Criterion 24 (V3): the sway is off by default with its default values; on, off and its values are kept; the highest frequency not below the lowest")
  void sway() throws CameraSettings.Invalid {
    CameraSettings d = CameraSettings.DEFAULTS;
    assertThat(d.sway()).isFalse();
    assertThat(d.swaySettings()).isEqualTo(new Sway.Settings(0.3, 0.5, 3, 2, 0.5, 0.5, 1));
    assertThat(d.json().get("sway")).isEqualTo(JsonBoolean.FALSE);
    CameraSettings on = parse("{\"sway\": true, \"swayAmplitude\": 0.8, \"swayMinFrequency\": 1, \"swayMaxFrequency\": 1, \"swayJoltsPerMinute\": 2,"
        + " \"swayJoltStrength\": 2.5, \"swayJoltDecay\": 1.2, \"swaySeed\": 99}");
    assertThat(on.sway()).isTrue();
    assertThat(on.swaySettings()).isEqualTo(new Sway.Settings(0.8, 1, 1, 2, 2.5, 1.2, 99));
    assertThat(CameraSettings.parse(on.json(), CameraSettings.DEFAULTS)).isEqualTo(on);
    CameraSettings off = CameraSettings.parse((JsonObject) TestJson.parse("{\"sway\": false}"), on);
    assertThat(off.sway()).isFalse();
    assertThat(off.swaySettings()).as("the values stay while it is off").isEqualTo(on.swaySettings());
    assertField("{\"sway\": \"yes\"}", "sway");
    assertField("{\"swayMinFrequency\": 2, \"swayMaxFrequency\": 1}", "swayMaxFrequency");
    assertField("{\"swayMinFrequency\": 4}", "swayMinFrequency");
    assertField("{\"swayAmplitude\": \"0.3\"}", "swayAmplitude");
  }

  @Test
  @DisplayName("Criterion 20 (V2, CR-0055): the overlay is off by default; on and off are kept; a value that is not a boolean is refused")
  void overlay() throws CameraSettings.Invalid {
    assertThat(CameraSettings.DEFAULTS.overlay()).isFalse();
    assertThat(CameraSettings.DEFAULTS.json().get("overlay")).isEqualTo(JsonBoolean.FALSE);
    CameraSettings on = parse("{\"overlay\": true}");
    assertThat(on.overlay()).isTrue();
    assertThat(on.json().get("overlay")).isEqualTo(JsonBoolean.TRUE);
    assertThat(CameraSettings.parse(on.json(), CameraSettings.DEFAULTS)).isEqualTo(on);
    assertThat(CameraSettings.parse((JsonObject) TestJson.parse("{\"azimuth\": 10}"), on).overlay()).as("absent keeps it").isTrue();
    assertThat(CameraSettings.parse((JsonObject) TestJson.parse("{\"overlay\": false}"), on).overlay()).isFalse();
    assertField("{\"overlay\": \"yes\"}", "overlay");
    assertField("{\"overlay\": 1}", "overlay");
    assertField("{\"overlay\": null}", "overlay");
  }

  @Test
  @DisplayName("Criterion 23: a camera stored before M9.2 reads as without the sway, with the default values")
  void storedBeforeTheSway() throws CameraSettings.Invalid {
    CameraSettings old = parse("{\"mode\": \"fixed\", \"azimuth\": 90, \"depression\": 15, \"frameSize\": \"1280x720\", \"frameRate\": 25}");
    assertThat(old.sway()).isFalse();
    assertThat(old.swaySettings()).isEqualTo(CameraSettings.SWAY_DEFAULTS);
    assertThat(old.overlay()).as("a camera stored before M9.2 has no overlay").isFalse();
  }

  private static void assertField(String json, String field) {
    assertThatThrownBy(() -> parse(json)).isInstanceOfSatisfying(CameraSettings.Invalid.class, e -> assertThat(e.field).isEqualTo(field));
  }

  @Test
  @DisplayName("Section 5's defaults, and a JSON round trip that keeps every mode's values")
  void defaultsAndRoundTrip() throws CameraSettings.Invalid {
    CameraSettings d = CameraSettings.DEFAULTS;
    assertThat(d.mode()).isEqualTo(CameraSettings.Mode.FIXED);
    assertThat(d.setup().pointing()).isEqualTo(new Pointing.FixedAngles(0, 30));
    assertThat(d.horizontalFov()).isEqualTo(20);
    assertThat(d.frame()).isEqualTo(Frame.DEFAULT);
    assertThat(d.height()).isEqualTo(1000);
    assertThat(d.sectorStart()).isEqualTo(315);
    assertThat(d.sectorEnd()).isEqualTo(45);
    assertThat(d.sweepRate()).isEqualTo(10);
    CameraSettings s = parse("{\"mode\": \"sweep\", \"point\": [17.3, 62.4], \"pointHeight\": 12, \"target\": \"0193a1f2-7c4e-7d10-9a3b-2f6e8c1d4b57\","
        + " \"azimuth\": 90, \"depression\": 15, \"sectorStart\": 30, \"sectorEnd\": 120, \"sweepRate\": 5, \"horizontalFov\": 40,"
        + " \"frameSize\": \"640x360\", \"frameRate\": 15, \"height\": 2000, \"mission\": \"RECCE NORTH\"}");
    assertThat(CameraSettings.parse(s.json(), CameraSettings.DEFAULTS)).isEqualTo(s);
    assertThat(CameraSettings.parse(JsonObject.empty(), s)).as("absent fields keep their values").isEqualTo(s);
    assertThat(CameraSettings.parse((JsonObject) TestJson.parse("{\"point\": null, \"target\": null, \"mission\": null}"), s))
        .extracting(CameraSettings::point, CameraSettings::target, CameraSettings::mission).containsExactly(null, null, "");
  }

  @Test
  @DisplayName("B4: Track a point needs its point and Track an object its target before it can start")
  void missing() throws CameraSettings.Invalid {
    assertThat(parse("{\"mode\": \"trackPoint\"}").missing().field).isEqualTo("point");
    assertThat(parse("{\"mode\": \"trackPoint\"}").setup()).isNull();
    assertThat(parse("{\"mode\": \"trackObject\"}").missing().field).isEqualTo("target");
    assertThat(parse("{\"mode\": \"trackPoint\", \"point\": [17.3, 62.41], \"pointHeight\": 5}").setup().pointing())
        .isEqualTo(new Pointing.TrackPoint(17.3, 62.41, 5));
    assertThat(parse("{\"mode\": \"sweep\"}").missing()).isNull();
  }
}
