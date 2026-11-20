package dev.emcc.plugins.ais.transport;

import dev.emcc.plugins.ais.codec.AisDecoder;
import dev.emcc.plugins.ais.codec.AisMessage;
import dev.emcc.plugins.ais.codec.Decoded;
import dev.emcc.plugins.ais.codec.Fragments;
import dev.emcc.plugins.ais.codec.Nmea;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.connection.TaskContext;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.UUID;
import java.util.function.LongSupplier;

/**
 * What a task does with each line it received: checks the sentence, joins the fragments of a
 * multi-sentence message, decodes it, and sends the AIS message to the worker as an immutable
 * message. It never touches objects or the worker's state, and holds no socket: the task gives it lines.
 * <b>One per connection</b>, so the fragments it holds (brief section 4) belong to one connection.
 *
 * <p>The counters appear in the monitor view, per task: {@code frames in} (every line), {@code
 * dropped: <reason>} ({@code too long}, {@code no checksum}, {@code checksum}, {@code malformed},
 * {@code fragment lost}, {@code too short}, {@code worker busy}), {@code ignored: type <n>}, {@code
 * no position}, {@code value out of range} (a value left out; not a drop) and {@code messages} (sent to the worker).
 */
final class Inbound implements LineFramer.Sink {

  private final String link;
  private final UUID run;
  private final WorkerRef<TransportMsg> worker;
  private final TaskContext<? extends Message> task;
  private final LongSupplier millis;
  private final Fragments fragments = new Fragments();

  Inbound(String link, UUID run, WorkerRef<TransportMsg> worker, TaskContext<? extends Message> task) {
    this(link, run, worker, task, () -> System.nanoTime() / 1_000_000);
  }

  /** As above, with the clock (milliseconds, monotonic) the fragments' expiry uses: a test's way to wait 5 s. */
  Inbound(String link, UUID run, WorkerRef<TransportMsg> worker, TaskContext<? extends Message> task, LongSupplier millis) {
    this.link = link;
    this.run = run;
    this.worker = worker;
    this.task = task;
    this.millis = millis;
  }

  @Override
  public void frame(String line) {
    Nmea.Parsed parsed = Nmea.parse(line);
    if (parsed.sentence() == null) {
      task.count("dropped: " + parsed.reason(), 1);
    } else {
      Fragments.Result added = fragments.add(parsed.sentence(), millis.getAsLong());
      if (added.lost() > 0) {
        task.count("dropped: fragment lost", added.lost());
      }
      if (added.joined() != null) {
        message(AisDecoder.decode(added.joined().payload(), added.joined().fillBits()));
      }
    }
    task.count("frames in", 1); // after the send: whoever reads the counter knows the worker has been told
  }

  private void message(Decoded decoded) {
    if (decoded.outOfRange() > 0) {
      task.count("value out of range", decoded.outOfRange());
    }
    if (decoded.message() == null) {
      task.count(decoded.reason(), 1);
      return;
    }
    TransportMsg out = switch (decoded.message()) {
      case AisMessage.Position p -> new TransportMsg.ReceivedPosition(link, run, p);
      case AisMessage.StaticReport s -> new TransportMsg.ReceivedStatic(link, run, s);
    };
    if (task.send(worker, out) == SendResult.DROPPED) {
      task.count("dropped: worker busy", 1);
    } else {
      task.count("messages", 1);
    }
  }

  @Override
  public void tooLong(long bytes) {
    task.count("dropped: too long", 1);
    task.count("frames in", 1);
  }
}
