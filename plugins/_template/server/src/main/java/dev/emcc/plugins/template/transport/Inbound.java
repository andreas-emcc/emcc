package dev.emcc.plugins.template.transport;

import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.UUID;

/**
 * What a task does with each frame it received: YOUR PROTOCOL parses it here, in small pieces and
 * with safe parsers (no DTDs, no external entities), and sends the result to the worker as an
 * immutable message. Anything slow goes to a compute worker (rule C7). It never touches objects or
 * the worker's state, and holds no socket: the task gives it frames.
 *
 * <p>The counters appear in the monitor view, per task: {@code frames in}, {@code dropped: too long},
 * {@code dropped: worker busy} (the worker's mailbox was full).
 */
final class Inbound implements LineFramer.Sink {

  private final String link;
  private final UUID run;
  private final WorkerRef<TransportMsg> worker;
  private final TaskContext<?> task;

  Inbound(String link, UUID run, WorkerRef<TransportMsg> worker, TaskContext<?> task) {
    this.link = link;
    this.run = run;
    this.worker = worker;
    this.task = task;
  }

  @Override
  public void frame(String line) {
    // YOUR PROTOCOL: parse the line here; count and drop what does not parse, and go on.
    if (task.send(worker, new TransportMsg.Received(link, run, line)) == SendResult.DROPPED) {
      task.count("dropped: worker busy", 1);
    }
    task.count("frames in", 1); // after the send: whoever reads the counter knows the worker has been told
  }

  @Override
  public void tooLong(long bytes) {
    task.count("dropped: too long", 1);
  }
}
