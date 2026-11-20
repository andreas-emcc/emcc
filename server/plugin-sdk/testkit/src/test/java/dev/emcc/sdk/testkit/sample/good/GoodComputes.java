package dev.emcc.sdk.testkit.sample.good;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.compute.ComputeContext;
import dev.emcc.sdk.compute.ComputeRef;
import dev.emcc.sdk.compute.ComputeTask;
import dev.emcc.sdk.connection.ConnectionRef;
import dev.emcc.sdk.worker.WorkerRef;

/** SDK 1.9.0 (CR-0048 point 5): a compute task that follows the rules: CPU work, its inbox, sends to a worker, posts to a connection task, folders. */
public final class GoodComputes {

  private GoodComputes() {}

  public record Pose(double azimuth) implements Message {}

  public record Rendered(Bytes picture) implements Message {}

  /** A message may carry a compute task's handle, as it may carry a WorkerRef. */
  public record RendererUp(ComputeRef<Pose> task) implements Message {}

  public static final class Renderer implements ComputeTask<Pose> {
    private final WorkerRef<Rendered> link;
    private final ConnectionRef<Rendered> out;
    private final byte[] frame = new byte[16];

    public Renderer(WorkerRef<Rendered> link, ConnectionRef<Rendered> out) {
      this.link = link;
      this.out = out;
    }

    @Override
    public void run(ComputeContext<Pose> task) {
      task.folders().toString();
      for (Pose p; (p = task.take()) != null; ) {
        if (task.stopping()) {
          return;
        }
        frame[0] = (byte) p.azimuth();
        var picture = new Rendered(Bytes.of(frame));
        task.send(link, picture);
        out.post(picture);
        task.count("rendered", 1);
      }
    }
  }
}
