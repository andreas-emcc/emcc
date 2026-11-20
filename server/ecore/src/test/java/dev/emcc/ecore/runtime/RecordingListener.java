package dev.emcc.ecore.runtime;

import java.time.Duration;

/** Records runtime events as short strings, e.g. {@code hung core/w restarting=true}, and the hung calls' details. */
final class RecordingListener implements RuntimeListener {

  final Probe<String> events = new Probe<>();
  /** What each hung or recovered call was handling, as the log says it. */
  final Probe<String> calls = new Probe<>();

  @Override
  public void workerHung(WorkerInfo worker, Duration elapsed, boolean restarting, HungCall call) {
    events.add("hung " + worker.id() + " restarting=" + restarting);
    calls.add("hung " + worker.id() + ": " + call.text());
  }

  @Override
  public void workerRestarted(WorkerInfo worker, long restarts) {
    events.add("restarted " + worker.id() + " #" + restarts);
  }

  @Override
  public void workerRecovered(WorkerInfo worker, Duration elapsed, HungCall call) {
    events.add("recovered " + worker.id());
    calls.add("recovered " + worker.id() + ": " + call.text());
  }

  @Override
  public void handlerFailed(WorkerInfo worker, Throwable error) {
    events.add("failed " + worker.id() + ": " + error.getMessage());
  }

  @Override
  public void workerFailed(WorkerInfo worker, Throwable error) {
    events.add("worker failed " + worker.id() + ": " + error.getMessage());
  }

  @Override
  public void capReached(String owner, OwnerLimits.Cap cap, int limit, long refusedSoFar) {
    events.add("cap " + owner + " " + cap.text() + " " + limit + " refused " + refusedSoFar);
  }
}
