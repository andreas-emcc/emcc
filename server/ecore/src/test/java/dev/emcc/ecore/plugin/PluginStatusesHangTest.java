package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.HungCall;
import dev.emcc.ecore.runtime.WorkerInfo;
import dev.emcc.sdk.PluginState;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/**
 * A plugin's worker that hangs and is not restarted makes it DEGRADED. The detail keeps its wording
 * (the ITA matches it exactly; owner, 2026-10-16); the log names the call.
 */
class PluginStatusesHangTest {

  @Test
  void aHungWorkerThatIsNotRestartedMakesItsPluginDegraded() {
    PluginStatuses statuses = new PluginStatuses();
    statuses.register("cot");
    WorkerInfo worker = new WorkerInfo("cot/listener", "cot", "listener");
    HungCall call = new HungCall("CotMsg.Received", 120, true);

    statuses.workerHung(worker, Duration.ofMillis(5_400), true, call); // restarted: nothing to say
    assertThat(statuses.of("cot").state()).isEqualTo(PluginState.OK);

    statuses.workerHung(worker, Duration.ofMillis(5_400), false, call);
    assertThat(statuses.of("cot").state()).isEqualTo(PluginState.DEGRADED);
    assertThat(statuses.of("cot").detail())
        .isEqualTo("worker listener hung (5400 ms) and is not restarted");
  }
}
