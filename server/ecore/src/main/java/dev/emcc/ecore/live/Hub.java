package dev.emcc.ecore.live;

import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.SendOutcome;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerInfo;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.runtime.WorkerState;
import dev.emcc.ecore.runtime.WorkerStats;
import dev.emcc.ecore.store.StoreChange;
import dev.emcc.sdk.model.ChangeEvent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Collects the change events from {@code objects.changed} and hands them to every session in one
 * batch per tick (spike S2: browsers need batches at a limited cadence). A session whose mailbox
 * refuses a batch, and every session when the hub itself missed events, is told to resync: it then
 * sends its browser a fresh snapshot. So events are never lost silently.
 *
 * <p>The hub also sends the welcome notices, the broadcasts ({@code data-types}, {@code settings}) and
 * the messages for one user's browsers ({@code display}),
 * so a session registered in between misses no change: the notices are read once the session is
 * registered, and a broadcast's message when the hub sends it.
 *
 * <p>The hub's tick also drives two checks: every {@link LiveGateway#HEALTH_INTERVAL} it closes the
 * sockets of sessions whose worker or writer hung or failed (F3), and every {@link
 * LiveGateway#KEEPALIVE_INTERVAL} each session pings its browser (F6).
 */
final class Hub implements MessageHandler<LiveMsg.Hub> {

  private static final Logger LOG = LoggerFactory.getLogger(Hub.class);
  private static final String WRITER = "-writer";

  private final WorkerRuntime runtime;
  private final Consumer<String> onDead;
  private final Supplier<List<String>> atWelcome;
  /** Each registered session with its writer. */
  private final Map<WorkerHandle<LiveMsg.Session>, WorkerHandle<LiveMsg.Writer>> sessions = new LinkedHashMap<>();
  /** Each registered session's user id. */
  private final Map<WorkerHandle<LiveMsg.Session>, String> users = new LinkedHashMap<>();
  private final List<StoreChange> pending = new ArrayList<>();
  private long lastSequenceNo = -1;
  private long lastHealthCheck;
  private long lastKeepAlive;

  /**
   * @param onDead told the name of a session whose worker or writer hung or failed
   * @param atWelcome the messages a newly registered session's browser gets after {@code welcome}
   */
  Hub(WorkerRuntime runtime, Consumer<String> onDead, Supplier<List<String>> atWelcome) {
    this.runtime = runtime;
    this.onDead = onDead;
    this.atWelcome = atWelcome;
    this.lastHealthCheck = runtime.nanoTime();
    this.lastKeepAlive = lastHealthCheck;
  }

  @Override
  public void handle(LiveMsg.Hub message, HandlerContext<LiveMsg.Hub> context) {
    switch (message) {
      case LiveMsg.Hub.Changed changed -> changed(changed.change());
      case LiveMsg.Hub.Register register -> {
        users.put(register.session(), register.user());
        register(register.session(), register.writer());
      }
      case LiveMsg.Hub.Broadcast broadcast -> {
        String text = broadcast.message().get();
        sessions.values().forEach(writer -> writer.send(new LiveMsg.Writer.Text(text)));
      }
      case LiveMsg.Hub.ToUser toUser -> sessions.forEach((session, writer) -> {
        if (toUser.user().equals(users.get(session))) {
          writer.send(new LiveMsg.Writer.Text(toUser.message()));
        }
      });
      case LiveMsg.Hub.Unregister unregister -> {
        sessions.remove(unregister.session());
        users.remove(unregister.session());
      }
      case LiveMsg.Hub.Tick tick -> {
        flush();
        // By the runtime's clock, not by counting ticks: a busy hub skips ticks.
        long now = runtime.nanoTime();
        if (now - lastHealthCheck >= LiveGateway.HEALTH_INTERVAL.toNanos()) {
          lastHealthCheck = now;
          checkHealth();
        }
        if (now - lastKeepAlive >= LiveGateway.KEEPALIVE_INTERVAL.toNanos()) {
          lastKeepAlive = now;
          sessions.keySet().forEach(s -> s.send(LiveMsg.Session.KeepAlive.KEEP_ALIVE));
        }
      }
    }
  }

  /** Registers first, then reads the notices: a change after this read reaches the session as a broadcast. */
  private void register(WorkerHandle<LiveMsg.Session> session, WorkerHandle<LiveMsg.Writer> writer) {
    sessions.put(session, writer);
    for (String notice : atWelcome.get()) {
      writer.send(new LiveMsg.Writer.Text(notice));
    }
  }

  private void changed(StoreChange change) {
    ChangeEvent event = change.event();
    if (lastSequenceNo >= 0 && event.sequenceNo() != lastSequenceNo + 1) {
      LOG.warn("The live picture hub missed change events {} to {}; every session resyncs",
          lastSequenceNo + 1, event.sequenceNo() - 1);
      sessions.keySet().forEach(this::resync);
    }
    lastSequenceNo = event.sequenceNo();
    pending.add(change);
  }

  private void flush() {
    if (pending.isEmpty()) {
      return;
    }
    LiveMsg.Session.Batch batch = new LiveMsg.Session.Batch(pending);
    pending.clear();
    for (var it = sessions.keySet().iterator(); it.hasNext(); ) {
      WorkerHandle<LiveMsg.Session> session = it.next();
      SendOutcome outcome = session.send(batch);
      if (outcome == SendOutcome.CLOSED) {
        it.remove();
        users.remove(session);
      } else if (outcome == SendOutcome.DROPPED) {
        resync(session);
      }
    }
  }

  /** Sessions whose worker or writer hung or failed get nothing more: their sockets are closed (F3). */
  private void checkHealth() {
    for (WorkerStats stats : runtime.stats()) {
      WorkerInfo worker = stats.worker();
      if (worker.owner().equals(LiveGateway.OWNER) && worker.name().startsWith("session-")
          && (stats.state() == WorkerState.HUNG || stats.state() == WorkerState.FAILED)) {
        String name = worker.name();
        onDead.accept(name.endsWith(WRITER) ? name.substring(0, name.length() - WRITER.length()) : name);
      }
    }
  }

  private void resync(WorkerHandle<LiveMsg.Session> session) {
    runtime.deliverAlways(session, () -> LiveMsg.Session.Resync.RESYNC);
  }
}
