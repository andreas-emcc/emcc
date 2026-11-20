package dev.emcc.plugins.gmti;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.LogEntry;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

/**
 * The live check of work package 5 (criterion 16), run by hand against the ESA's GMTI playback
 * ({@code external/gmti/README.md}); it does nothing unless {@code emc2.live} is set. The whole
 * plugin on the test kit's fake context and store, one link per entry with a real socket, then its
 * counts. Nothing is written to a file and no packet is kept.
 *
 * <pre>
 * mvn -f server/pom.xml -pl ../plugins/gmti/server -am test -Dtest=LiveCheckTest -Dsurefire.failIfNoSpecifiedTests=false
 *     -Demc2.live=tcp:8113:120,tcp:8116:120,udp:46001:239.255.46.1:120 -Demc2.live.time=as-received
 * </pre>
 *
 * Each entry is {@code tcp:<port>:<seconds>} (a TCP client) or {@code udp:<port>:<group>:<seconds>}
 * (a multicast receiver joined on 127.0.0.1, on the group and port the playback's {@code --udp} sends
 * to); they run side by side, each with a plugin of its own.
 * A TCP link is measured until the playback closes it ({@code --no-loop}: one round), or for its
 * seconds; the restart's back-off runs on virtual time and does not come before the end.
 */
class LiveCheckTest {

  @Test
  void liveCheck() throws Exception {
    String spec = System.getProperty("emc2.live");
    assumeTrue(spec != null && !spec.isBlank(), "set -Demc2.live=tcp:<port>:<seconds>,... to run against the playback");
    String time = System.getProperty("emc2.live.time", "as-recorded");
    ExecutorService pool = Executors.newCachedThreadPool();
    List<Future<String>> results = new ArrayList<>();
    for (String part : spec.split(",")) {
      String[] p = part.split(":");
      String link = p[0].equals("udp")
          ? "{\"name\":\"live\",\"mode\":\"udp\",\"listen\":{\"port\":" + p[1] + "},\"multicastGroup\":\"" + p[2]
              + "\",\"multicastInterface\":\"127.0.0.1\",\"time\":\"" + time + "\"}"
          : "{\"name\":\"live\",\"host\":\"127.0.0.1\",\"port\":" + p[1] + ",\"time\":\"" + time + "\"}";
      int seconds = Integer.parseInt(p[p.length - 1]);
      results.add(pool.submit((Callable<String>) () -> run(part, link, seconds)));
    }
    for (Future<String> r : results) {
      System.out.println(r.get());
    }
    pool.shutdown();
  }

  private static String run(String what, String link, int seconds) throws Exception {
    FakePluginContext ctx = Manifest.context().build();
    var plugin = new GmtiPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + link + "]}"));
    Instant started = Instant.now();
    try {
      long end = System.nanoTime() + Duration.ofSeconds(seconds).toNanos();
      long nextTick = System.nanoTime() + Duration.ofSeconds(1).toNanos();
      boolean wasUp = false;
      while (System.nanoTime() < end) {
        ctx.runUntilIdle();
        String status = ctx.effectiveStatus().detail();
        wasUp |= status.contains("]: up");
        if (wasUp && status.contains("]: down")) {
          break; // the playback closed the connection after its round
        }
        if (System.nanoTime() >= nextTick) {
          ctx.advance(Duration.ofSeconds(1)); // the plugin's timers run on the fake context's virtual time
          nextTick += Duration.ofSeconds(1).toNanos();
        }
        Thread.sleep(10);
      }
      ctx.runUntilIdle();
      var task = ctx.connectionTask("live");
      var out = new StringBuilder("\n=== " + what + ", " + Duration.between(started, Instant.now()).toSeconds() + " s\n");
      out.append("status: ").append(ctx.effectiveStatus()).append('\n');
      out.append("counters: ").append(new TreeMap<>(task.counters())).append('\n');
      out.append("restarts: ").append(task.restarts()).append('\n');
      List<MapObject> all = ctx.store().objects();
      Map<String, Integer> byType = new TreeMap<>();
      Map<String, Integer> sidcs = new TreeMap<>();
      Map<String, Integer> labels = new TreeMap<>();
      double minLon = 999;
      double maxLon = -999;
      double minLat = 999;
      double maxLat = -999;
      Instant first = null;
      Instant last = null;
      for (MapObject o : all) {
        byType.merge(o.content().dataType() + " " + o.content().type(), 1, Integer::sum);
        labels.merge(o.content().label().classification(), 1, Integer::sum);
        if (o.content().dataType().equals("gmti.detection")) {
          sidcs.merge(o.content().symbol().sidc(), 1, Integer::sum);
          Position at = ((Geometry.Point) o.content().geometry()).coordinates();
          minLon = Math.min(minLon, at.longitude());
          maxLon = Math.max(maxLon, at.longitude());
          minLat = Math.min(minLat, at.latitude());
          maxLat = Math.max(maxLat, at.latitude());
          Instant t = o.content().time().observed();
          first = first == null || t.isBefore(first) ? t : first;
          last = last == null || t.isAfter(last) ? t : last;
        }
        if (o.content().geometry() instanceof Geometry.ArcBand a) {
          out.append("area: ArcBand ").append(Math.round(a.innerRadius())).append(" .. ").append(Math.round(a.outerRadius())).append(" m, ")
              .append(Math.round(a.startBearing())).append(" .. ").append(Math.round(a.endBearing())).append(" deg, ")
              .append(o.content().properties().name()).append('\n');
        } else if (o.content().geometry() instanceof Geometry.Circle c) {
          out.append("area: Circle ").append(Math.round(c.radius())).append(" m, ").append(o.content().properties().name()).append('\n');
        } else if (o.content().dataType().equals("gmti.platform")) {
          Position at = ((Geometry.Point) o.content().geometry()).coordinates();
          out.append("platform: ").append(o.content().properties().name()).append(" at ").append(at).append(", ")
              .append(o.content().symbol().sidc()).append(", observed ").append(o.content().time().observed()).append('\n');
        }
      }
      out.append("objects: ").append(byType).append(", layers: ").append(ctx.store().layers().size()).append('\n');
      out.append("detections: longitude ").append(minLon).append(" .. ").append(maxLon).append(", latitude ").append(minLat).append(" .. ")
          .append(maxLat).append('\n');
      out.append("detections observed ").append(first).append(" .. ").append(last).append(" (the plugin's clock at the end: ").append(ctx.clock()).append(")\n");
      out.append("labels: ").append(labels).append(", detection sidcs: ").append(sidcs).append('\n');
      out.append("log warnings: ").append(ctx.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN).map(LogEntry::message).toList());
      return out.toString();
    } finally {
      plugin.stop();
      ctx.connections().stopAll();
    }
  }
}
