package dev.emcc.ecore;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.persistence.ConfigStore.Behaviour;
import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.Removal;
import dev.emcc.ecore.store.StoreMsg;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The worker that has expired objects removed (data model rule 15). */
class ExpiryWorkerTest {

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final Probe<String> asked = new Probe<>();

  @AfterEach
  void close() {
    runtime.close();
  }

  @Test
  void onlyDataTypesWithRemoveAfterExpirySecondsAreRemoved() {
    Map<String, Removal> removals = ExpiryWorker.removals(Map.of(
        "cot.track", new Behaviour(300L, true, 3600L),
        "core.general", new Behaviour(null, false, null),
        "cot.alert", new Behaviour(null, true, 0L)));

    assertThat(removals).isEqualTo(Map.of("cot.track", new Removal(300L, 3600), "cot.alert", new Removal(null, 0)));
  }

  @Test
  void everyIntervalItAsksTheStoreButNeverTwiceAtOnce() {
    WorkerHandle<StoreMsg> store = runtime.owner("core-store").spawn(WorkerOptions.<StoreMsg>of("store", () -> (m, ctx) -> {
      if (m instanceof StoreMsg.RemoveExpired r) {
        asked.add("remove " + r.byDataType().keySet() + " at most " + r.max());
      }
    }));
    Map<String, Behaviour> behaviours = Map.of("cot.track", new Behaviour(null, false, 0L));
    Owner owner = runtime.owner("core-expiry");
    WorkerHandle<ExpiryWorker.Msg> worker =
        owner.spawn(WorkerOptions.<ExpiryWorker.Msg>of("expiry", () -> new ExpiryWorker(store, () -> behaviours)));
    owner.every(ExpiryWorker.INTERVAL, worker, ExpiryWorker.Tick.TICK);

    time.advanceSettled(ExpiryWorker.INTERVAL, runtime);
    assertThat(asked.next()).isEqualTo("remove [cot.track] at most " + ExpiryWorker.MAX_PER_TICK);
    time.advanceSettled(ExpiryWorker.INTERVAL, runtime); // the store has not answered: no second ask

    ManualTime.awaitIdle(runtime);
    assertThat(asked.drain()).isEmpty();
  }
}
