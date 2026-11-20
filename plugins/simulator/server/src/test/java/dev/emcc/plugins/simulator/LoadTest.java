package dev.emcc.plugins.simulator;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Criterion 21's plugin part: 1 000 tracks on routes, each tick submitted in one burst, none
 * skipped, and the status shows the tick's duration and counts. The test kit's store is not ECore's,
 * so the timing measured here is the engine's own work (brief function 16: "the PCA measures it");
 * the ITA measures the whole once in its environment.
 */
class LoadTest {

  @Test
  @DisplayName("Criterion 21 (plugin): 1 000 tracks at 1 Hz with one chosen channel, one burst per tick, none skipped")
  void aThousandTracks() {
    Rig rig = new Rig();
    List<UUID> all = new ArrayList<>();
    for (int r = 0; r < 10; r++) {
      List<Position> line = List.of(Position.of(10 + r, 50.5), Position.of(10.4 + r, 50.9), Position.of(10.8 + r, 50.6));
      var groups = new StringBuilder();
      for (int i = 0; i < 100; i++) {
        UUID track = rig.symbol(line.getFirst());
        all.add(track);
        groups.append(i == 0 ? "" : ",").append("{\"kind\": \"single\", \"objects\": [{\"id\": \"").append(track).append("\"}]}");
      }
      rig.route(line, "{\"points\": [{\"speed\": " + (50 + r) + "}, {\"speed\": 250, \"altitude\": 3000}, {\"speed\": 250}], \"groups\": [" + groups + "]}");
    }
    rig.started();
    rig.chooseTak(); // criterion 21: with one chosen cot channel
    rig.control("start");

    long worst = 0;
    for (int t = 1; t <= 10; t++) {
      int before = rig.ctx.store().requests().size();
      int unsavedBefore = rig.ctx.store().unsaved().size();
      rig.seconds(1);
      List<ChangeRequest> burst = rig.ctx.store().requests().subList(before, rig.ctx.store().requests().size());
      assertThat(burst).as("tick %d", t).hasSize(1000);
      // The first tick after Start saves every track (A12); the others are moves, not saved.
      assertThat(rig.ctx.store().unsaved().size() - unsavedBefore).as("tick %d's unsaved moves", t).isEqualTo(t == 1 ? 0 : 1000);
      assertThat(burst.stream().map(ChangeRequest::entityId).distinct()).hasSize(1000);
      assertThat(rig.sentToTak()).as("every track sent at each tick").hasSize(1000 * t);
      Matcher m = Pattern.compile("last tick (\\d+) ms, (\\d+) moves").matcher(rig.ctx.pluginStatus().detail());
      assertThat(m.find()).isTrue();
      assertThat(m.group(2)).isEqualTo("1000");
      worst = Math.max(worst, Long.parseLong(m.group(1)));
    }
    assertThat(rig.ctx.pluginStatus().detail()).contains("skipped 0").contains("refused 0").contains("1000 tracks on routes");
    assertThat(worst).as("the engine's work per tick, ms").isLessThan(Engine.SLOW_TICK.toMillis());
    assertThat(all).hasSize(1000);
  }
}
