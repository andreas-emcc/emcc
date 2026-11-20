package dev.emcc.sdk.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Message;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class WorkerSpecTest {

  record Ping() implements Message {}

  @Test
  void defaultsAndWithers() {
    WorkerSpec<Ping> spec = WorkerSpec.of("tiles", Ping.class, () -> (m, ctx) -> {});
    assertThat(spec.mailboxCapacity()).isEqualTo(WorkerSpec.DEFAULT_CAPACITY);
    assertThat(spec.overflow()).isInstanceOf(Overflow.DropNewest.class);
    assertThat(spec.budget()).isEqualTo(Duration.ofSeconds(5));
    assertThat(spec.restartable()).isFalse();

    WorkerSpec<Ping> changed = spec.mailbox(10, Overflow.coalesceByKey()).budget(Duration.ofMillis(200)).restartable(true);
    assertThat(changed.mailboxCapacity()).isEqualTo(10);
    assertThat(changed.overflow()).isInstanceOf(Overflow.CoalesceByKey.class);
    assertThat(changed.restartable()).isTrue();
    assertThat(spec.mailboxCapacity()).as("the original is unchanged").isEqualTo(WorkerSpec.DEFAULT_CAPACITY);
  }

  @Test
  void rejectsBadValues() {
    WorkerSpec<Ping> spec = WorkerSpec.of("tiles", Ping.class, () -> (m, ctx) -> {});
    assertThatThrownBy(() -> WorkerSpec.of("Tiles", Ping.class, () -> (m, ctx) -> {})).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> spec.mailbox(0, Overflow.dropOldest())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> spec.budget(Duration.ofMinutes(2))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> spec.budget(Duration.ofMillis(1))).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void computeWorkersGetALongerDefaultBudget() {
    WorkerSpec<Ping> spec = WorkerSpec.of("render", Ping.class, () -> (m, ctx) -> {});
    assertThat(spec.compute()).isFalse();
    WorkerSpec<Ping> compute = spec.compute(true);
    assertThat(compute.compute()).isTrue();
    assertThat(compute.budget()).isEqualTo(WorkerSpec.DEFAULT_COMPUTE_BUDGET);
    assertThat(compute.compute(false).budget()).isEqualTo(WorkerSpec.DEFAULT_BUDGET);
    assertThat(spec.budget(Duration.ofSeconds(2)).compute(true).budget()).as("a budget set before is kept").isEqualTo(Duration.ofSeconds(2));
    assertThat(compute.budget(Duration.ofSeconds(50)).budget()).isEqualTo(Duration.ofSeconds(50));
  }
}
