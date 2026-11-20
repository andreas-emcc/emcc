package dev.emcc.plugins.ais;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.emcc.sdk.model.MapObject;
import java.time.Duration;
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
 * The live check of work package 5 (criterion 15), run by hand against the ESA's playback ({@code
 * external/playback/README.md}); it does nothing unless the system property {@code emc2.live} is set. The whole plugin on the
 * test kit's fake context and fake object store, one link per playback port with a real TCP socket, for a number of seconds
 * each, then the counts of each. Nothing is written to a file and no frame is kept.
 *
 * <pre>
 * mvn -f server/pom.xml -pl ../plugins/ais/server -am test -Dtest=LiveCheckTest -Dsurefire.failIfNoSpecifiedTests=false -Demc2.live=8111:180,8112:180,8110:600
 * </pre>
 *
 * {@code emc2.live} is a list of {@code port:seconds}; the ports run side by side, each with a plugin of its own.
 */
class LiveCheckTest {

  @Test
  void liveCheck() throws Exception {
    String spec = System.getProperty("emc2.live");
    assumeTrue(spec != null && !spec.isBlank(), "set -Demc2.live=<port>:<seconds>,... to run against the playback");
    ExecutorService pool = Executors.newCachedThreadPool();
    List<Future<String>> results = new ArrayList<>();
    for (String part : spec.split(",")) {
      String[] p = part.split(":");
      results.add(pool.submit((Callable<String>) () -> run(Integer.parseInt(p[0]), Integer.parseInt(p[1]))));
    }
    for (Future<String> r : results) {
      System.out.println(r.get());
    }
    pool.shutdown();
  }

  private static String run(int port, int seconds) throws Exception {
    var rig = new Rig("{\"name\":\"live\",\"mode\":\"tcp-client\",\"host\":\"127.0.0.1\",\"port\":" + port + ",\"standardIdentity\":\"neutral\"}");
    try {
      long end = System.nanoTime() + Duration.ofSeconds(seconds).toNanos();
      long nextTick = System.nanoTime() + Duration.ofSeconds(1).toNanos();
      while (System.nanoTime() < end) {
        rig.ctx.runUntilIdle();
        if (System.nanoTime() >= nextTick) {
          rig.advance(Duration.ofSeconds(1)); // the plugin's timer runs on the fake context's virtual time
          nextTick += Duration.ofSeconds(1).toNanos();
        }
        Thread.sleep(20);
      }
      rig.ctx.runUntilIdle();
      var task = rig.ctx.connectionTask("live");
      var out = new StringBuilder("\n=== port " + port + ", " + seconds + " s\n");
      out.append("status: ").append(rig.ctx.pluginStatus()).append('\n');
      out.append("counters: ").append(new TreeMap<>(task.counters())).append('\n');
      out.append("restarts: ").append(task.restarts()).append('\n');
      double minLon = 999;
      double maxLon = -999;
      double minLat = 999;
      double maxLat = -999;
      int named = 0;
      Map<String, Integer> sidcs = new TreeMap<>();
      List<MapObject> ships = rig.ships();
      for (MapObject s : ships) {
        var at = Rig.at(s);
        minLon = Math.min(minLon, at.longitude());
        maxLon = Math.max(maxLon, at.longitude());
        minLat = Math.min(minLat, at.latitude());
        maxLat = Math.max(maxLat, at.latitude());
        String name = s.content().properties() == null ? null : s.content().properties().name();
        if (name != null && !name.matches("[0-9]{9}")) {
          named++;
        }
        sidcs.merge(s.content().symbol().sidc(), 1, Integer::sum);
      }
      out.append("ships: ").append(ships.size()).append(" (").append(named).append(" with a name), layers: ").append(rig.ctx.store().layers().size())
          .append(", change requests: ").append(rig.ctx.store().requests().size()).append('\n');
      out.append("longitude ").append(minLon).append(" .. ").append(maxLon).append(", latitude ").append(minLat).append(" .. ").append(maxLat).append('\n');
      out.append("sidcs: ").append(sidcs).append('\n');
      out.append("log warnings: ").append(rig.ctx.logEntries().stream().filter(e -> e.level() == dev.emcc.sdk.testkit.LogEntry.Level.WARN).count());
      return out.toString();
    } finally {
      rig.plugin.stop();
      rig.ctx.connections().stopAll();
    }
  }
}
