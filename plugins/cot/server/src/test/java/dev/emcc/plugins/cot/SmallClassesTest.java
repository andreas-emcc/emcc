package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Random;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The small helpers: UUID version 7, the warning limit and the counters. */
class SmallClassesTest {

  @Test
  void uuidV7HasVersionVariantAndTheTimeInTheFirstFortyEightBits() {
    long millis = Instant.parse("2026-10-12T08:00:00.123Z").toEpochMilli();
    UUID id = UuidV7.next(millis, new Random(1));
    assertThat(id.version()).isEqualTo(7);
    assertThat(id.variant()).isEqualTo(2);
    assertThat(id.getMostSignificantBits() >>> 16).isEqualTo(millis);
    assertThat(id.toString()).matches("[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
  }

  @Test
  void uuidV7SortsByTime() {
    var random = new Random(2);
    UUID earlier = UuidV7.next(1_000_000L, random);
    UUID later = UuidV7.next(1_000_001L, random);
    assertThat(earlier.toString()).isLessThan(later.toString());
    assertThat(UuidV7.next(1_000_000L, random)).isNotEqualTo(earlier);
  }

  @Test
  void textFromAPeerHasNoControlCharacterNoLineSeparatorAndIsCut() {
    String dirty = "a\nb\rc\u0085d\u2028e\u2029f\tg";
    assertThat(Text.clean(dirty)).isEqualTo("a b c d e f g");
    String cut = Text.clean("x".repeat(500));
    assertThat(cut).hasSize(Text.MAX).endsWith("...");
    assertThat(Text.clean("plain text")).isEqualTo("plain text");
  }

  @Test
  void countersAddUpAndTheLaterSnapshotWins() {
    var a = new Counters(5, 1, 0, 2, 0);
    var b = new Counters(3, 0, 1, 0, 4);
    assertThat(a.plus(b)).isEqualTo(new Counters(8, 1, 1, 2, 4));
    assertThat(a.max(new Counters(4, 3, 0, 2, 0))).isEqualTo(new Counters(5, 3, 0, 2, 0));
    assertThat(a.dropped()).isEqualTo(3);
  }

  @Test
  void aLinkAddsUpTheCountersOfAllItsRunsAndKeepsOnlyTheLastFewApart() {
    var stream = new LinkRuntime(Config.parse(Manifest.settingDefaults().with("links",
        dev.emcc.sdk.json.JsonArray.of(dev.emcc.sdk.testkit.TestJson.parse("{\"name\":\"s\",\"direction\":\"in\",\"host\":\"h.example.local\",\"port\":1}")))).links().getFirst());
    UUID first = UUID.randomUUID();
    stream.observe(first, new Counters(10, 1, 0, 0, 0));
    stream.observe(first, new Counters(7, 0, 0, 0, 0)); // a snapshot that was replaced late: the larger one stays
    assertThat(stream.reader().read()).isEqualTo(10);
    for (int i = 0; i < 10; i++) {
      stream.observe(UUID.randomUUID(), new Counters(1, 0, 0, 0, 0));
    }
    assertThat(stream.reader().read()).isEqualTo(20);
    assertThat(stream.reader().malformed()).isEqualTo(1);
  }
}
