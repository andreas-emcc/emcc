package dev.emcc.ecore;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.SendOutcome;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import org.junit.jupiter.api.Test;

class ECoreTest {

  @Test
  void movesThroughTheLifeCycle() {
    ECore core = new ECore();
    assertThat(core.state()).isEqualTo(ECore.State.NEW);

    core.start();
    assertThat(core.state()).isEqualTo(ECore.State.RUNNING);

    core.stop();
    assertThat(core.state()).isEqualTo(ECore.State.STOPPED);
  }

  @Test
  void cannotBeStartedTwice() {
    try (ECore core = new ECore()) {
      core.start();
      assertThatThrownBy(core::start).isInstanceOf(IllegalStateException.class);
    }
  }

  @Test
  void cannotBeRestartedAfterStop() {
    ECore core = new ECore();
    core.start();
    core.stop();
    assertThatThrownBy(core::start).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void runsTheWorkerRuntimeWhileRunning() {
    ECore core = new ECore();
    assertThatThrownBy(core::runtime).isInstanceOf(IllegalStateException.class);

    core.start();
    WorkerRuntime runtime = core.runtime();
    WorkerHandle<String> worker =
        runtime.owner("core").spawn(WorkerOptions.<String>of("echo", () -> (text, ctx) -> {}));
    assertThat(worker.send("hello")).isEqualTo(SendOutcome.ACCEPTED);

    core.stop();
    assertThat(worker.send("after stop")).isEqualTo(SendOutcome.CLOSED);
    assertThatThrownBy(core::runtime).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void stopIsIdempotentAndAllowedBeforeStart() {
    ECore core = new ECore();
    core.stop();
    core.stop();
    assertThat(core.state()).isEqualTo(ECore.State.STOPPED);
  }
}
