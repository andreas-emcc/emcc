package dev.emcc.plugins.ais.codec;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class FragmentsTest {

  private static Sentence sentence(String line) {
    return Nmea.parse(line).sentence();
  }

  private final Ais.Msg voyage = Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 70, 100, 20, 10, 12, 85, "STOCKHOLM");

  @Test
  void twoFragmentsInOrderAreJoined() {
    List<String> parts = voyage.fragments(2, "3");
    var fragments = new Fragments();
    assertThat(fragments.add(sentence(parts.get(0)), 0)).isEqualTo(new Fragments.Result(null, 0));
    Fragments.Joined joined = fragments.add(sentence(parts.get(1)), 100).joined();
    assertThat(joined).isNotNull();
    assertThat(joined.payload()).isEqualTo(voyage.payload());
    assertThat(joined.fillBits()).isEqualTo(voyage.fill());
    assertThat(fragments.size()).isZero();
  }

  @Test
  void aSingleSentenceNeedsNoJoining() {
    assertThat(new Fragments().add(sentence(Ais.partA(1, "A").sentence()), 0).joined()).isNotNull();
  }

  @Test
  void theSecondFragmentAloneIsLost() {
    var fragments = new Fragments();
    assertThat(fragments.add(sentence(voyage.fragments(2, "3").get(1)), 0)).isEqualTo(new Fragments.Result(null, 1));
  }

  @Test
  void aMessageNotCompleteInFiveSecondsIsLost() {
    var fragments = new Fragments();
    fragments.add(sentence(voyage.fragments(2, "3").get(0)), 0);
    assertThat(fragments.expire(4_999)).isZero();
    assertThat(fragments.expire(5_000)).isEqualTo(1);
    assertThat(fragments.size()).isZero();
    // also when a later fragment finds it out: the old message and that fragment are both lost
    fragments.add(sentence(voyage.fragments(2, "3").get(0)), 10_000);
    assertThat(fragments.add(sentence(voyage.fragments(2, "3").get(1)), 15_001)).isEqualTo(new Fragments.Result(null, 2));
  }

  @Test
  void aFragmentOutOfOrderLosesTheMessage() {
    List<String> parts = Ais.voyage(366_000_001, 0, "", "", 0, 0, 0, 0, 0, 0, "").fragments(3, "7");
    var fragments = new Fragments();
    fragments.add(sentence(parts.get(0)), 0);
    assertThat(fragments.add(sentence(parts.get(2)), 1).lost()).isEqualTo(1);
    assertThat(fragments.add(sentence(parts.get(1)), 2)).isEqualTo(new Fragments.Result(null, 1)); // it has no first fragment any more
  }

  @Test
  void messagesWithDifferentSequenceIdsAreJoinedSeparately() {
    List<String> a = voyage.fragments(2, "1");
    List<String> b = Ais.voyage(366_000_002, 0, "X", "OTHER", 80, 1, 1, 1, 1, 0, "").fragments(2, "2");
    var fragments = new Fragments();
    assertThat(fragments.add(sentence(a.get(0)), 0).joined()).isNull();
    assertThat(fragments.add(sentence(b.get(0)), 1).joined()).isNull();
    assertThat(fragments.add(sentence(a.get(1)), 2).joined().payload()).isEqualTo(voyage.payload());
    assertThat(fragments.add(sentence(b.get(1)), 3).joined()).isNotNull();
  }

  @Test
  void aSeventeenthWaitingMessageDropsTheOldest() {
    var fragments = new Fragments();
    for (int i = 0; i < Fragments.MAX_WAITING; i++) {
      fragments.add(sentence(Ais.withChecksum("AIVDM,2,1," + i % 10 + "," + (i < 10 ? "A" : "B") + ",5,0")), i);
    }
    assertThat(fragments.size()).isEqualTo(16);
    assertThat(fragments.add(sentence(Ais.withChecksum("AIVDM,2,1,9,1,5,0")), 20)).isEqualTo(new Fragments.Result(null, 1));
    assertThat(fragments.size()).isEqualTo(16);
    // the oldest (sequence id 0, channel A) is the one that went
    assertThat(fragments.add(sentence(Ais.withChecksum("AIVDM,2,2,0,A,5,0")), 21).lost()).isEqualTo(1);
  }

  @Test
  void aNewFirstFragmentReplacesAnUnfinishedMessageOfTheSameKey() {
    var fragments = new Fragments();
    fragments.add(sentence(voyage.fragments(2, "3").get(0)), 0);
    assertThat(fragments.add(sentence(voyage.fragments(2, "3").get(0)), 1).lost()).isEqualTo(1);
    assertThat(fragments.size()).isEqualTo(1);
  }
}
