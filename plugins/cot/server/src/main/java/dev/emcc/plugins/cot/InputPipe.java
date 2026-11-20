package dev.emcc.plugins.cot;

import dev.emcc.plugins.cot.codec.CotEvent;
import dev.emcc.plugins.cot.codec.CotParseException;
import dev.emcc.plugins.cot.codec.CotXml;
import dev.emcc.plugins.cot.stream.EventFramer;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * What a link's task does with each CoT document it has cut out of what it received (brief
 * function 2): parses it with DTDs and external entities off, and sends the events it shows to the
 * {@code applier} worker as immutable messages. It never touches objects or the worker's state, and
 * holds no socket: the task gives it bytes.
 *
 * <p>An event that is too large, does not parse, or is of a type the plugin does not show is counted
 * and dropped, and the link continues. The task logs nothing about it: it tells the worker why the
 * latest event was dropped, and the worker logs at most one warning per minute per link. ECore
 * makes a fresh task for each run, so the counters are per run (and cumulative, so that a message
 * that replaces another in the mailbox loses nothing).
 */
final class InputPipe implements EventFramer.Sink {

  private final String link;
  private final WorkerRef<ApplierMsg> applier;
  private final TaskContext<? extends Message> task;
  private final Clock clock;
  private final UUID run = UUID.randomUUID();
  private final UUID generation;
  private final CotXml xml = new CotXml();
  /** Why the latest event was dropped; the worker logs it, at most once a minute per link. */
  private @Nullable String lastDrop;

  private long read;
  private long malformed;
  private long tooLarge;
  private long ignored;
  private long overflow;

  InputPipe(String link, WorkerRef<ApplierMsg> applier, TaskContext<? extends Message> task, Clock clock, UUID generation) {
    this.link = link;
    this.generation = generation;
    this.applier = applier;
    this.task = task;
    this.clock = clock;
  }

  /** The run's id, which its messages carry. */
  UUID run() {
    return run;
  }

  /** Tells the worker that the run has its connection or its socket. */
  void connected() {
    send(new ApplierMsg.Connected(link, run, generation, Instant.now(clock)));
  }

  @Override
  public void event(byte[] data, int length) {
    read++;
    deliver(data, length);
    task.count("events in", 1); // after the message is sent: whoever reads the counter knows the worker has been told
  }

  private void deliver(byte[] data, int length) {
    CotEvent event;
    try {
      event = xml.parse(data, length);
    } catch (CotParseException e) {
      malformed++;
      dropped("does not parse: " + e.getMessage());
      return;
    }
    if (!event.isShown()) {
      ignored++;
      send(new ApplierMsg.Counted(link, run, counters(), lastDrop));
      return;
    }
    send(new ApplierMsg.Received(link, run, counters(), lastDrop, event));
  }

  @Override
  public void tooLarge(long length) {
    read++;
    tooLarge++;
    dropped("is larger than the limit (" + length + " bytes)");
    task.count("events in", 1);
  }

  /** The run ends: its final counters go to the worker. */
  void finish() {
    send(new ApplierMsg.Counted(link, run, counters(), lastDrop));
  }

  private void dropped(String reason) {
    lastDrop = reason;
    send(new ApplierMsg.Counted(link, run, counters(), lastDrop));
  }

  private void send(ApplierMsg message) {
    if (task.send(applier, message) == SendResult.DROPPED) {
      overflow++;
    }
  }

  private Counters counters() {
    return new Counters(read, malformed, tooLarge, ignored, overflow);
  }
}
