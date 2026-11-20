package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.capability.Capability;
import dev.emcc.sdk.capability.SessionTimeChange;
import dev.emcc.sdk.capability.Temporal;
import java.time.Instant;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** SDK 1.4.0 part 4 (CR-0030 part 4; ADR-0044, ADR-0045): capabilities and the user's time. */
class Part4TypesTest {

  private static final Instant T1 = Instant.parse("2026-11-06T08:00:00Z");
  private static final Instant T2 = Instant.parse("2026-11-06T09:30:00Z");

  @Test
  void aUserTimeHasASetTimeAndAnIntervalWithItsStartNotAfterItsEnd() {
    assertThat(UserTime.now().isNow()).isTrue();
    assertThat(UserTime.now()).isSameAs(UserTime.NOW);
    assertThat(UserTime.NOW.time()).isNull();
    assertThat(UserTime.NOW.interval()).isNull();
    assertThat(UserTime.at(T1).isNow()).isFalse();
    assertThat(UserTime.at(T1).time()).isEqualTo(T1);
    var interval = UserTime.now().withInterval(T1, T2).interval();
    assertThat(interval).isEqualTo(new UserTime.Interval(T1, T2));
    assertThat(interval.contains(T1)).isTrue();
    assertThat(interval.contains(T2)).isTrue();
    assertThat(interval.contains(T2.plusMillis(1))).isFalse();
    assertThat(UserTime.now().withInterval(T1, T1).interval()).as("an instant interval is well formed").isEqualTo(new UserTime.Interval(T1, T1));
    assertThatThrownBy(() -> UserTime.now().withInterval(T2, T1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> UserTime.at(null)).isInstanceOf(NullPointerException.class);
  }

  @Test
  void theTwoPartsAreIndependentAndIsNowMeansBoth() {
    // CR-0032: the set time may lie outside the interval; R2: isNow() is the whole value.
    var both = UserTime.at(T2.plusSeconds(3600)).withInterval(T1, T2);
    assertThat(both.time()).isEqualTo(T2.plusSeconds(3600));
    assertThat(both.interval().contains(both.time())).isFalse();
    assertThat(both.isNow()).isFalse();
    var nowWithInterval = UserTime.now().withInterval(T1, T2);
    assertThat(nowWithInterval.time()).as("the set time alone is now").isNull();
    assertThat(nowWithInterval.isNow()).as("but not the whole value").isFalse();
    assertThat(nowWithInterval.withoutInterval()).isEqualTo(UserTime.NOW);
    assertThat(nowWithInterval.withoutInterval().isNow()).isTrue();
    assertThat(both.withoutInterval()).isEqualTo(UserTime.at(T2.plusSeconds(3600)));
    var at = UserTime.at(T1);
    assertThat(at.withoutInterval()).isSameAs(at);
    assertThat(both.withInterval(T1, T1).time()).as("withInterval keeps the set time").isEqualTo(both.time());
  }

  @Test
  void capabilitiesHaveTheirIdsAndInterfaces() {
    assertThat(Capability.fromId("temporal")).contains(Capability.TEMPORAL);
    assertThat(Capability.fromId("history")).isEmpty();
    assertThat(Capability.TEMPORAL.type()).isEqualTo(Temporal.class);
    abstract class Both implements Plugin, Temporal {}
    abstract class Neither implements Plugin {}
    assertThat(Capability.implementedBy(Both.class)).isEqualTo(Set.of(Capability.TEMPORAL));
    assertThat(Capability.implementedBy(Neither.class)).isEmpty();
  }

  @Test
  void aSessionTimeChangeNamesItsSession() {
    User alice = new User("alice", "Alice", Set.of(), false);
    assertThat(new SessionTimeChange("s1", alice, UserTime.at(T1)).time()).isEqualTo(UserTime.at(T1));
    assertThatThrownBy(() -> new SessionTimeChange("", alice, UserTime.now())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new SessionTimeChange("x".repeat(129), alice, UserTime.now())).isInstanceOf(IllegalArgumentException.class);
  }
}
