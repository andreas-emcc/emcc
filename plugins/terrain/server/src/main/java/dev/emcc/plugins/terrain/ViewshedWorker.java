package dev.emcc.plugins.terrain;

import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;

/** A compute worker (rule C7): runs one viewshed at a time, on ECore's bounded pool of platform threads. */
final class ViewshedWorker implements Handler<ComputeMsg> {

  @Override
  public void handle(ComputeMsg message, WorkerContext<ComputeMsg> context) {
    switch (message) {
      case ComputeMsg.Run run -> {
        ViewshedJob job = run.job();
        run.replyTo().reply(ViewshedCompute.run(run.requestId(), new CellField(job.cells()), job.params(), job.budgetNanos()));
      }
      case ComputeMsg.RunMap run -> {
        ViewshedJob job = run.job();
        run.replyTo().reply(HeightMap.run(run.requestId(), new CellField(job.cells()), job.params(), job.budgetNanos()));
      }
    }
  }
}
