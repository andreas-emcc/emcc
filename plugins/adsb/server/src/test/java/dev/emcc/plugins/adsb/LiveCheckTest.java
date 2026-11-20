package dev.emcc.plugins.adsb;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/**
 * The live check of the playbook's work package 5, against the ESA's playback of the {@code adsb}
 * dataset on 127.0.0.1:30003 (external/playback/README.md). It runs only when the environment
 * variable {@code ADSB_LIVE_MINUTES} names how many minutes to listen; it prints the counts and
 * fails when a position lies outside the recording's box or when nothing arrives.
 */
class LiveCheckTest {

  private static final String LINK = "adsb-playback";

  @Test
  void listensToThePlaybackForTheGivenMinutes() throws Exception {
    String minutes = System.getenv("ADSB_LIVE_MINUTES");
    Assumptions.assumeTrue(minutes != null, "set ADSB_LIVE_MINUTES to run the live check");
    FakePluginContext ctx = FakePluginContext.builder("adsb")
        .declaredFields(Manifest.declaredFields())
        .fieldSets(Manifest.fieldSets())
        .dataTypes(new DataType("adsb.aircraft", "ADS-B aircraft", null, "adsb", new DataType.Defaults(60L, true, 300L))
            .withFieldSets("adsb.aircraft"))
        .build();
    AdsbPlugin plugin = new AdsbPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
    ctx.changeSettings((JsonObject) TestJson.parse(
        "{\"links\":[{\"name\":\"" + LINK + "\",\"host\":\"127.0.0.1\",\"port\":30003,\"idleSeconds\":60}]}"));
    ctx.runUntilIdle();
    long end = System.nanoTime() + Duration.ofMinutes(Long.parseLong(minutes)).toNanos();
    while (System.nanoTime() < end) {
      ctx.runUntilIdle();
      Thread.sleep(200);
    }
    ctx.runUntilIdle();
    try {
      System.out.println("LIVE status: " + ctx.effectiveStatus().detail());
      System.out.println("LIVE counters: " + ctx.connectionTask(LINK).counters());
      int outside = 0;
      int named = 0;
      for (MapObject object : ctx.store().objects()) {
        var point = (Geometry.Point) object.content().geometry();
        double lon = point.coordinates().longitude();
        double lat = point.coordinates().latitude();
        if (lon < 10 || lon > 14 || lat < 54.5 || lat > 57.5) {
          outside++;
        }
        if (!object.content().properties().name().equals(object.meta().externalRef().id())) {
          named++;
        }
      }
      System.out.println("LIVE aircraft: " + ctx.store().objects().size() + ", named by callsign: " + named + ", outside the box: " + outside);
      assertThat(ctx.store().objects()).isNotEmpty();
      assertThat(outside).as("every position inside the box").isZero();
    } finally {
      ctx.connections().stopAll();
    }
  }
}
