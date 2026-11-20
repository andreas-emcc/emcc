package dev.emcc.plugins.adsb.transport;

import dev.emcc.plugins.adsb.AdsbMsg;
import dev.emcc.plugins.adsb.Sbs1;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.UUID;

/**
 * What the task does with each line it received: the SBS-1 parser runs here, in the task, and what
 * it gives goes to the worker as an immutable message. A refused or ignored line is counted by its
 * reason and dropped; nothing in here throws on received data.
 *
 * <p>The counters appear in the monitor view, per task: {@code frames in}, {@code dropped: <reason>},
 * {@code ignored: <kind>}, {@code dropped: worker busy} (the worker's mailbox was full), and
 * {@code dropped: too long} (from the framer).
 */
final class Inbound implements LineFramer.Sink {

  private final String link;
  private final UUID run;
  private final WorkerRef<AdsbMsg> worker;
  private final TaskContext<?> task;

  Inbound(String link, UUID run, WorkerRef<AdsbMsg> worker, TaskContext<?> task) {
    this.link = link;
    this.run = run;
    this.worker = worker;
    this.task = task;
  }

  @Override
  public void frame(String line) {
    switch (Sbs1.parse(line)) {
      case Sbs1.Result.Parsed parsed -> {
        if (parsed.message().outOfRange() > 0) {
          task.count("value out of range", parsed.message().outOfRange()); // a value left out, not a drop: the rest of the line applies
        }
        if (task.send(worker, new AdsbMsg.Received(link, run, parsed.message())) == SendResult.DROPPED) {
          task.count("dropped: worker busy", 1);
        }
      }
      case Sbs1.Result.Ignored ignored -> task.count("ignored: " + ignored.kind(), 1);
      case Sbs1.Result.Refused refused -> task.count("dropped: " + refused.reason(), 1);
    }
    task.count("frames in", 1);
  }

  @Override
  public void tooLong(long bytes) {
    task.count("dropped: too long", 1);
  }
}
