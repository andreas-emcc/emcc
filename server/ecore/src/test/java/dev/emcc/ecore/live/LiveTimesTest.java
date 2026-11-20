package dev.emcc.ecore.live;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.DataTypes;
import dev.emcc.ecore.store.ObjectStore;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreMsg;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * SDK 1.4.0 part 4 in the live picture (ADR-0045 point 4): each session's id in {@code welcome},
 * its start, the browser's {@code time} messages, checked, and its end, told to {@link SessionTimes}.
 */
class LiveTimesTest {

  private static final ModelJson JSON = new ModelJson();
  private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-06T12:00:00Z"), ZoneOffset.UTC);
  private static final SessionTimes.SessionUser ALICE = new SessionTimes.SessionUser("alice", "Alice", Set.of("objects.edit"), false);

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final WorkerHandle<StoreMsg> store = runtime.owner("core-store").spawn(
      WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(new PictureState(), runtime, CLOCK, new DataTypes())));
  private final LiveGateway gateway = new LiveGateway(runtime, store, JSON, CLOCK, 10, LiveGateway.DEFAULT_MAX_BUDGET);
  private final Probe<String> told = new Probe<>();

  @AfterEach
  void close() {
    runtime.close();
  }

  /** Records what the gateway tells, one line each. */
  private final SessionTimes recorder = new SessionTimes() {
    @Override
    public void started(String session, SessionTimes.SessionUser user) {
      told.add("started " + session + " " + user.id() + " " + user.name() + " " + user.noLogin());
    }

    @Override
    public void changed(String session, SessionTimes.Picked time) {
      told.add("changed " + session + " " + time);
    }

    @Override
    public void ended(String session) {
      told.add("ended " + session);
    }
  };

  @Test
  void eachSessionHasAnIdInWelcomeAndItsStartTimesAndEndAreTold() {
    gateway.sessionTimes(recorder);
    LiveGatewayTest.Browser browser = new LiveGatewayTest.Browser();

    LiveGateway.LiveSession session = gateway.open(Requester.user("alice", Set.of("objects.edit")), ALICE, browser);
    JsonNode welcome = browser.next("welcome");

    String id = welcome.get("session").asString();
    assertThat(id).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").isEqualTo(session.key());
    assertThat(told.next()).isEqualTo("started " + id + " alice Alice false");
    session.receive("{\"type\":\"time\",\"time\":{\"time\":\"2026-11-06T08:00:00.000Z\"}}");
    assertThat(told.next()).isEqualTo("changed " + id + " Picked[at=2026-11-06T08:00:00Z, from=null, to=null]");
    session.receive("{\"type\":\"time\",\"time\":{\"interval\":{\"from\":\"2026-11-06T08:00:00Z\",\"to\":\"2026-11-06T09:30:00Z\"}}}");
    assertThat(told.next()).isEqualTo("changed " + id + " Picked[at=null, from=2026-11-06T08:00:00Z, to=2026-11-06T09:30:00Z]");
    // CR-0032: both parts at once, the set time outside the interval.
    session.receive("{\"type\":\"time\",\"time\":{\"time\":\"2026-11-07T12:00:00Z\",\"interval\":{\"from\":\"2026-11-06T08:00:00Z\",\"to\":\"2026-11-06T09:30:00Z\"}}}");
    assertThat(told.next()).isEqualTo("changed " + id + " Picked[at=2026-11-07T12:00:00Z, from=2026-11-06T08:00:00Z, to=2026-11-06T09:30:00Z]");
    session.receive("{\"type\":\"time\",\"time\":{}}");
    assertThat(told.next()).isEqualTo("changed " + id + " Picked[at=null, from=null, to=null]");

    session.close();
    session.close();
    assertThat(told.next()).isEqualTo("ended " + id);
    assertThat(told.drain()).as("once").isEmpty();
  }

  @Test
  void aMalformedTimeGetsAnErrorAndChangesNothing() {
    gateway.sessionTimes(recorder);
    LiveGatewayTest.Browser browser = new LiveGatewayTest.Browser();
    LiveGateway.LiveSession session = gateway.open(Requester.withAllPermissions("local"), browser);
    browser.next("welcome");
    told.next();

    for (String bad : java.util.List.of("{\"type\":\"time\"}", "{\"type\":\"time\",\"time\":null}",
        "{\"type\":\"time\",\"time\":{\"kind\":\"now\"}}",
        "{\"type\":\"time\",\"time\":{\"time\":null}}",
        "{\"type\":\"time\",\"time\":{\"interval\":null}}",
        "{\"type\":\"time\",\"time\":{\"time\":\"2026-11-06T08:00:00+01:00\"}}",
        "{\"type\":\"time\",\"time\":{\"time\":\"2026-13-06T08:00:00Z\"}}",
        "{\"type\":\"time\",\"time\":{\"interval\":{\"from\":\"2026-11-06T09:00:00Z\",\"to\":\"2026-11-06T08:00:00Z\"}}}",
        "{\"type\":\"time\",\"time\":{\"interval\":{\"from\":\"2026-11-06T09:00:00Z\"}}}",
        "{\"type\":\"time\",\"time\":{\"interval\":{\"from\":\"2026-11-06T08:00:00Z\",\"to\":\"2026-11-06T09:00:00Z\",\"step\":1}}}")) {
      session.receive(bad);
      assertThat(browser.next("error").get("message").asString()).as(bad).startsWith("time not taken: ");
    }
    assertThat(told.drain()).as("nothing told").isEmpty();
  }

  @Test
  void theTimeIsReadAsTheWebSdkWritesIt() {
    assertThat(SessionWorker.userTime(JSON.parse("{}"))).isEqualTo(SessionTimes.Picked.NOW);
    assertThat(SessionWorker.userTime(JSON.parse("{\"time\":\"2026-11-06T08:00:00.5Z\"}")))
        .isEqualTo(new SessionTimes.Picked(Instant.parse("2026-11-06T08:00:00.500Z"), null, null));
    assertThat(SessionWorker.userTime(JSON.parse("{\"interval\":{\"from\":\"2026-11-06T08:00:00Z\",\"to\":\"2026-11-06T08:00:00Z\"}}")))
        .as("a start equal to the end").extracting(SessionTimes.Picked::to).isNotNull();
    assertThatThrownBy(() -> SessionWorker.userTime(JSON.parse("{\"time\":\"2026-11-06T08:00:00.1234Z\"}")))
        .as("at most milliseconds").isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new SessionTimes.Picked(null, Instant.parse("2026-11-06T08:00:00Z"), null))
        .as("an interval has both ends").isInstanceOf(IllegalArgumentException.class);
  }
}
