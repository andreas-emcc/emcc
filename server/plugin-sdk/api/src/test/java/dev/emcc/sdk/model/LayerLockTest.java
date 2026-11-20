package dev.emcc.sdk.model;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** SDK 1.3.0 (CR-0028 part 2, ADR-0042): the layer's lock, and the constructors of 1.1.0 and 1.2.0. */
class LayerLockTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");

  @Test
  void theOlderConstructorsLeaveTheLockAbsent() {
    var v110 = new LayerContent("Own forces", 1, true, LABEL, Extensions.empty());
    var v120 = new LayerContent("Own forces", 1, true, LABEL, Extensions.empty(), "simulator.simulation");
    assertThat(v110.locked()).as("1.1.0: absent, so an update keeps the stored lock").isNull();
    assertThat(v120.locked()).as("1.2.0: absent").isNull();
    assertThat(v110.isLocked()).isFalse();
  }

  @Test
  void withLockedSetsClearsOrKeepsAndInWorkspaceKeepsIt() {
    var open = new LayerContent("Planned", 1, true, LABEL, Extensions.empty());
    var locked = open.withLocked(true);
    assertThat(locked.isLocked()).isTrue();
    assertThat(locked.name()).isEqualTo("Planned");
    assertThat(locked.withLocked(false).isLocked()).as("false reads as not locked").isFalse();
    assertThat(locked.withLocked(false).locked()).as("an update with false clears it").isFalse();
    assertThat(locked.withLocked(null).locked()).as("null keeps the stored lock on update").isNull();
    assertThat(locked.inWorkspace("simulator.simulation").isLocked()).isTrue();
  }

  @Test
  void theRejectionCodeIsTheModelsName() {
    assertThat(ChangeRejection.Code.valueOf("LAYER_LOCKED")).isEqualTo(ChangeRejection.Code.LAYER_LOCKED);
  }
}
