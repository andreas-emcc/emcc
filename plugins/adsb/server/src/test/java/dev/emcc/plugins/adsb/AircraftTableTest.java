package dev.emcc.plugins.adsb;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** The per-link state across lines: merging, forgetting after five minutes, and the limit of 10 000 aircraft. */
class AircraftTableTest {

  private static final Instant T0 = Instant.parse("2026-10-28T11:00:00Z");

  private static Sbs1.Message line(String hex, String callsign) {
    return ((Sbs1.Result.Parsed) Sbs1.parse(Sbs1Test.msg(1, hex, callsign, "", "", "", "", "", "", "", "", ""))).message();
  }

  @Test
  void aLaterLineKeepsTheValuesItDoesNotCarry() {
    AircraftTable table = new AircraftTable();
    table.update(line("4CA2D6", "SAS1234"), T0);
    AircraftTable.Update later = table.update(
        ((Sbs1.Result.Parsed) Sbs1.parse(Sbs1Test.position("55.6181", "12.6561"))).message(), T0.plusSeconds(1));
    assertThat(later.created()).isFalse();
    assertThat(later.aircraft().callsign()).isEqualTo("SAS1234");
    assertThat(later.aircraft().hasPosition()).isTrue();
  }

  @Test
  void criterion13_anAircraftWithNoLineForFiveMinutesIsForgotten() {
    AircraftTable table = new AircraftTable();
    table.update(line("4CA2D6", "SAS1234"), T0);
    assertThat(table.forget(T0.plus(AircraftTable.FORGET_AFTER).minusMillis(1))).isEmpty();
    assertThat(table.forget(T0.plus(AircraftTable.FORGET_AFTER).plusMillis(1))).hasSize(1);
    assertThat(table.size()).isZero();
    assertThat(table.get("4CA2D6")).isNull();
  }

  @Test
  void aLineMovesTheAircraftToTheNewestEnd() {
    AircraftTable table = new AircraftTable();
    table.update(line("4CA2D6", ""), T0);
    table.update(line("4CA2D7", ""), T0.plusSeconds(10));
    table.update(line("4CA2D6", ""), T0.plus(Duration.ofMinutes(5)).plusSeconds(20));
    // 4CA2D7 is the oldest now: forgotten at 5 minutes after its line, while 4CA2D6 stays.
    assertThat(table.forget(T0.plus(Duration.ofMinutes(5)).plusSeconds(11))).hasSize(1);
    assertThat(table.get("4CA2D6")).isNotNull();
    assertThat(table.get("4CA2D7")).isNull();
  }

  @Test
  void theOldestGoesFirstWhenTheTableIsFull() {
    AircraftTable table = new AircraftTable();
    int evicted = 0;
    for (int i = 0; i <= AircraftTable.MAX_AIRCRAFT; i++) {
      evicted += table.update(line(String.format("%06X", 0x100000 + i), ""), T0.plusMillis(i)).evicted().size();
    }
    assertThat(table.size()).isEqualTo(AircraftTable.MAX_AIRCRAFT);
    assertThat(evicted).isEqualTo(1);
    assertThat(table.get(String.format("%06X", 0x100000))).as("the first one went").isNull();
  }
}
