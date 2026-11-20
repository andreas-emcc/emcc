package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.UserTime;
import dev.emcc.sdk.capability.SessionTimeChange;
import dev.emcc.sdk.capability.Temporal;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.4.0 (ADR-0045 point 7, CR-0030 part 4): a small temporal plugin for the SDK's tests, the
 * shell's and the ITA's flows. It records every {@link SessionTimeChange} it gets, keeps each
 * session's time unless it {@link UserTime#isNow() is now} (so an ended session is forgotten, owner
 * Q10), and answers {@code GET /time} with the request's own {@code userTime()} as text: the set
 * time, {@code now} or {@code at <instant>}, followed by {@code interval <from> <to>} when there is
 * an interval (CR-0032), e.g. {@code now interval 2026-11-06T08:00:00Z 2026-11-06T09:30:00Z}.
 *
 * <p>Its manifest declares {@code "capabilities": ["temporal"]}. In a test, run it on a {@link
 * FakePluginContext} and drive it with {@code setSessionTime}.
 */
public final class TemporalTestPlugin implements Plugin, Temporal {

  sealed interface Msg extends Message {}

  record Changed(SessionTimeChange change) implements Msg {}

  record Get(EndpointRequest request) implements Msg {}

  private final List<SessionTimeChange> received = new ArrayList<>();
  private final Map<String, UserTime> sessions = new LinkedHashMap<>();
  private @Nullable WorkerRef<Msg> worker;

  @Override
  public void init(PluginContext context) {
    worker = context.workers().spawn(WorkerSpec.of("temporal-test", Msg.class, () -> (m, c) -> {
      switch (m) {
        case Changed ch -> {
          received.add(ch.change());
          if (ch.change().time().isNow()) {
            sessions.remove(ch.change().session());
          } else {
            sessions.put(ch.change().session(), ch.change().time());
          }
        }
        case Get g -> g.request().response().respond(HttpReply.of(200, dev.emcc.sdk.http.Headers.of("Content-Type", "text/plain; charset=utf-8"), dev.emcc.sdk.Bytes.utf8(text(g.request().userTime()))));
      }
    }));
    context.endpoints().register(Endpoint.get("/time"), worker, Get::new);
  }

  @Override
  public void start() {}

  @Override
  public void stop() {}

  @Override
  public Delivery<?> timeDelivery() {
    return Temporal.deliver(Objects.requireNonNull(worker, "init first"), Changed::new);
  }

  /** Every change received, in order. */
  public List<SessionTimeChange> received() {
    return List.copyOf(received);
  }

  /** The sessions whose time is not {@code now}, with their times. */
  public Map<String, UserTime> sessions() {
    return Map.copyOf(sessions);
  }

  /** The text {@code GET /time} answers for {@code time}. */
  public static String text(UserTime time) {
    String set = time.time() == null ? "now" : "at " + time.time();
    UserTime.Interval i = time.interval();
    return i == null ? set : set + " interval " + i.from() + " " + i.to();
  }
}
