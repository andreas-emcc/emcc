package dev.emcc.plugins.gmti;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.gmti.format.Decoded;
import dev.emcc.plugins.gmti.format.Decoder;
import dev.emcc.plugins.gmti.format.RecordingsTest;
import dev.emcc.plugins.gmti.transport.TransportMsg;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/**
 * The replay test of work package 5: one of the owner's recordings, the VISTA stream as a dissector
 * re-recorded it, read where it is and fed through the whole plugin as a link's task would, against
 * the reference's 6.2 (brief R1). The file and what it must give stand in the list in {@code
 * EMC2_GMTI_DATA} ({@link RecordingsTest}), its {@code "replay"}, so that no detail of the recording
 * is in the repository:
 *
 * <pre>{@code
 * "replay": {
 *   "file": "<path in the folder>",
 *   "packets": 120,
 *   "detections": [least, most],             reports without an index (D32.1) are known by their place
 *   "classification": "<the extension's text>", "sidc": "<every detection's SIDC>",
 *   "box": [west, south, east, north],       every detection inside, degrees
 *   "firstDetection": "<UTC instant>",       the earliest detection's time
 *   "platform": "<its name>",
 *   "sensor": [longitude, latitude, altitude], "sensorWithin": [degrees, degrees, metres],
 *   "innerRadius": 0, "outerRadius": [least, most], "extent": 180.0      the first area's, metres and degrees
 * }
 * }</pre>
 *
 * Skipped, with the reason, without the variable, the list or its {@code "replay"}; no frame is in
 * the repository.
 */
class ReplayTest {

  @Test
  void theListedRecordingThroughThePlugin() throws Exception {
    JsonObject list = RecordingsTest.list();
    Assumptions.assumeTrue(list.has("replay"), "no \"replay\" in the list in EMC2_GMTI_DATA");
    JsonObject replay = list.getObject("replay");
    Path file = RecordingsTest.file(replay.getString("file"));
    assertThat(file).as("the replay's file, as listed").isRegularFile();
    FakePluginContext ctx = Manifest.context().build();
    var plugin = new GmtiPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[{\"name\":\"vista\",\"host\":\"127.0.0.1\",\"port\":9,\"enabled\":false}]}"));
    ctx.runUntilIdle();

    byte[] bytes = Files.readAllBytes(file);
    int packets = 0;
    for (int at = 0; at < bytes.length; ) {
      int size = (int) Decoder.packetSize(bytes, at);
      Decoded d = Decoder.decode(bytes, at, size);
      plugin.links().send(new TransportMsg.Received("vista", UUID.randomUUID(), d.packet()));
      ctx.runUntilIdle();
      packets++;
      at += size;
    }
    assertThat(packets).isEqualTo(replay.getNumber("packets").longValueExact());

    List<MapObject> detections = ctx.store().objects().stream().filter(o -> o.content().dataType().equals("gmti.detection")).toList();
    // Reports without an index (D32.1) are known by their place: two reports of one dwell at one place are one.
    double[] count = numbers(replay, "detections");
    assertThat(detections.size()).isBetween((int) count[0], (int) count[1]);
    double[] box = numbers(replay, "box");
    assertThat(detections).allSatisfy(o -> {
      assertThat(o.content().extensions().get("gmti").getString("classification")).isEqualTo(replay.getString("classification"));
      assertThat(o.content().symbol().sidc()).isEqualTo(replay.getString("sidc"));
      Position at = ((Geometry.Point) o.content().geometry()).coordinates();
      assertThat(at.longitude()).as("west to east").isBetween(box[0], box[2]);
      assertThat(at.latitude()).as("south to north").isBetween(box[1], box[3]);
    });
    assertThat(detections.stream().map(o -> o.content().time().observed()).min(Instant::compareTo).orElseThrow())
        .as("the reference day and D6").isEqualTo(Instant.parse(replay.getString("firstDetection")));

    MapObject platform = ctx.store().objects().stream()
        .filter(o -> o.content().dataType().equals("gmti.platform") && o.content().geometry() instanceof Geometry.Point).findFirst().orElseThrow();
    assertThat(platform.content().properties().name()).isEqualTo(replay.getString("platform"));
    Position sensor = ((Geometry.Point) platform.content().geometry()).coordinates();
    double[] expected = numbers(replay, "sensor");
    double[] tolerance = numbers(replay, "sensorWithin");
    assertThat(sensor.longitude()).as("not wrapped").isCloseTo(expected[0], within(tolerance[0]));
    assertThat(sensor.latitude()).isCloseTo(expected[1], within(tolerance[1]));
    assertThat(sensor.altitude()).isCloseTo(expected[2], within(tolerance[2]));

    var area = (Geometry.ArcBand) ctx.store().objects().stream().map(o -> o.content().geometry()).filter(g -> g instanceof Geometry.ArcBand)
        .findFirst().orElseThrow();
    assertThat(area.innerRadius()).isCloseTo(replay.getNumber("innerRadius").doubleValue(), within(1e-6));
    double[] outer = numbers(replay, "outerRadius");
    assertThat(area.outerRadius()).as("D26 and the centre's distance from the sensor").isBetween(outer[0], outer[1]);
    double extent = (area.endBearing() - area.startBearing() + 360) % 360;
    assertThat(extent).as("twice D27").isCloseTo(replay.getNumber("extent").doubleValue(), within(0.02));
    plugin.stop();
  }

  private static double[] numbers(JsonObject o, String name) {
    var a = (JsonArray) o.get(name);
    assertThat(a).as("the replay's \"%s\"", name).isNotNull();
    double[] d = new double[a.size()];
    for (int i = 0; i < d.length; i++) {
      d[i] = ((JsonNumber) a.get(i)).doubleValue();
    }
    return d;
  }
}
