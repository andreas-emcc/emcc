package dev.emcc.ecore;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.live.LiveGateway;
import dev.emcc.ecore.live.LiveSink;
import dev.emcc.ecore.persistence.ConfigStore;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.ecore.persistence.UserDocumentStore;
import dev.emcc.ecore.persistence.UserDocumentStore.Result;
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
import java.nio.file.Path;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * SDK 1.4.0 part 5 in ECore (ADR-0046, ADR-0052): each user's display choices as their own
 * document in {@code core}, the admin's defaults in ECore's configuration, both checked as the web
 * SDK's {@code displayChoicesProblem}, and the live notice to the user's browsers (owner, 2026-11-07).
 */
class DisplaySettingsTest {

  private static final ModelJson JSON = new ModelJson();

  @TempDir Path data;

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final WorkerHandle<StoreMsg> store = runtime.owner("core-store").spawn(
      WorkerOptions.<StoreMsg>of("object-store", () -> new ObjectStore(new PictureState(), runtime, Clock.systemUTC(), new DataTypes())));
  private final LiveGateway live = new LiveGateway(runtime, store, JSON, Clock.systemUTC(), 10, LiveGateway.DEFAULT_MAX_BUDGET);
  private final UserDocuments documents = new UserDocuments(runtime, new UserDocumentStore(null, JSON), id -> false);

  @AfterEach
  void close() {
    runtime.close();
  }

  /** A browser that keeps the types of the messages it gets. */
  private static final class Browser implements LiveSink {
    final Probe<String> types = new Probe<>();

    @Override
    public void send(String text) {
      types.add(JSON.parse(text).get("type").asString());
    }

    @Override
    public void ping() {}

    @Override
    public void close(int status, String reason) {}
  }

  private DisplaySettings display(Configuration configuration) {
    return new DisplaySettings(documents, configuration, live, JSON);
  }

  private static Result answer(java.util.function.Consumer<java.util.function.Consumer<Result>> call) {
    Probe<Result> answers = new Probe<>();
    call.accept(answers::add);
    Result answer = answers.next();
    assertThat(answers.drain()).as("one answer only").isEmpty();
    return answer;
  }

  @Test
  void theChecksAreTheWebSdksWordForWord() {
    Map<String, String> refused = Map.ofEntries(
        Map.entry("[]", "display settings are an object"),
        Map.entry("{\"size\":30}", "unknown display setting: size"),
        Map.entry("{\"symbolSize\":15}", "symbolSize is a whole number from 16 to 96"),
        Map.entry("{\"symbolSize\":30.5}", "symbolSize is a whole number from 16 to 96"),
        Map.entry("{\"symbolSize\":\"30\"}", "symbolSize is a whole number from 16 to 96"),
        Map.entry("{\"speedVectorMinutes\":61}", "speedVectorMinutes is a whole number from 0 to 60"),
        Map.entry("{\"speedVectorSeconds\":20}", "speedVectorSeconds is 0 or one of 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800"),
        Map.entry("{\"speedVectorSeconds\":5.5}", "speedVectorSeconds is 0 or one of 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800"),
        Map.entry("{\"speedVectorSeconds\":\"5\"}", "speedVectorSeconds is 0 or one of 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800"),
        Map.entry("{\"speedVectorSeconds\":3600}", "speedVectorSeconds is 0 or one of 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800"),
        Map.entry("{\"labels\":\"name\"}", "labels is a list of label ids"),
        Map.entry("{\"labels\":[\"callsign\"]}", "unknown label: callsign"),
        Map.entry("{\"labels\":[\"name\",\"name\"]}", "label listed twice: name"),
        Map.entry("{\"relations\":[]}", "relations maps a relation kind to true or false"),
        Map.entry("{\"relations\":{\"gmti-pairing\":1}}", "the switch of gmti-pairing is true or false"),
        // SDK 1.6.0 (CR-0041 part D): the display classes' switches
        Map.entry("{\"classes\":[]}", "classes maps a display class to true or false"),
        Map.entry("{\"classes\":{\"job-area\":true}}", "unknown display class: job-area"),
        Map.entry("{\"classes\":{\"dwell-area\":\"no\"}}", "the switch of dwell-area is true or false"),
        // SDK 1.8.0 (CR-0043 part A): the label places and the arrow
        Map.entry("{\"labels\":[],\"directionArrow\":true}", "labels is not stored together with labelPlaces or directionArrow"),
        Map.entry("{\"labels\":[\"name\"],\"labelPlaces\":{}}", "labels is not stored together with labelPlaces or directionArrow"),
        Map.entry("{\"labelPlaces\":[]}", "labelPlaces maps a place to a label or null"),
        Map.entry("{\"labelPlaces\":{\"middle\":\"name\"}}", "unknown label place: middle"),
        Map.entry("{\"labelPlaces\":{\"below\":\"direction\"}}", "unknown text label: direction"),
        Map.entry("{\"labelPlaces\":{\"below\":7}}", "unknown text label: 7"),
        Map.entry("{\"labelPlaces\":{\"below\":\"name\",\"topLeft\":\"name\"}}", "label placed twice: name"),
        Map.entry("{\"directionArrow\":\"yes\"}", "directionArrow is true or false"),
        // SDK 1.9.0 (CR-0048 section 6): black or blue friendly control measures
        Map.entry("{\"friendlyGraphicColour\":\"green\"}", "friendlyGraphicColour is black or blue"),
        Map.entry("{\"friendlyGraphicColour\":1}", "friendlyGraphicColour is black or blue"));
    refused.forEach((value, problem) -> assertThat(DisplaySettings.problem(JSON.parse(value))).as(value).isEqualTo(problem));

    for (String fine : List.of("{}", "{\"symbolSize\":16,\"speedVectorMinutes\":0}", "{\"symbolSize\":96.0,\"speedVectorMinutes\":60}",
        "{\"labels\":[]}", "{\"labels\":[\"direction\",\"name\"],\"relations\":{\"not-loaded\":false}}",
        "{\"speedVectorSeconds\":0}", "{\"speedVectorSeconds\":5}", "{\"speedVectorSeconds\":1800.0,\"speedVectorMinutes\":7}",
        "{\"classes\":{}}", "{\"classes\":{\"dwell-area\":false,\"sensor-coverage\":true}}",
        "{\"labelPlaces\":{},\"directionArrow\":false}", "{\"friendlyGraphicColour\":\"blue\"}", "{\"friendlyGraphicColour\":\"black\"}",
        "{\"labelPlaces\":{\"topLeft\":null,\"below\":\"speed\"}}",
        "{\"labelPlaces\":{\"topLeft\":\"name\",\"topRight\":\"uniqueDesignation\",\"bottomLeft\":null,\"bottomRight\":null,\"below\":null}}")) {
      assertThat(DisplaySettings.problem(JSON.parse(fine))).as(fine).isNull();
    }
    assertThat(DisplaySettings.LABEL_IDS).as("the web SDK's LABEL_IDS").hasSize(10).startsWith("name", "uniqueDesignation").endsWith("direction");
    assertThat(DisplaySettings.TEXT_LABEL_IDS).as("the web SDK's TEXT_LABEL_IDS").hasSize(9).doesNotContain("direction");
    assertThat(DisplaySettings.LABEL_PLACES).as("the web SDK's LABEL_PLACES").containsExactly("topLeft", "topRight", "bottomLeft", "bottomRight", "below");
  }

  @Test
  void eachUsersChoicesAreTheirOwnCheckedAndTheirBrowsersAreTold() {
    DisplaySettings display = display(new Configuration(new ConfigStore(null, JSON)));
    Browser alice = new Browser();
    Browser alice2 = new Browser();
    Browser bob = new Browser();
    live.open(Requester.user("u-alice", Set.of()), alice);
    live.open(Requester.user("u-alice", Set.of()), alice2);
    live.open(Requester.user("u-bob", Set.of()), bob);
    List.of(alice, alice2, bob).forEach(b -> assertThat(b.types.next()).isEqualTo("welcome"));

    assertThat(answer(a -> display.choices("u-alice", a))).as("none set").isEqualTo(new Result.Found("{}"));
    String choices = "{\"symbolSize\":40,\"labels\":[\"name\"],\"relations\":{\"not-loaded\":true}}";
    assertThat(answer(a -> display.setChoices("u-alice", JSON.parse(choices), a))).isEqualTo(new Result.Written());
    assertThat(alice.types.next()).isEqualTo("display");
    assertThat(alice2.types.next()).as("every browser of the user").isEqualTo("display");
    assertThat(answer(a -> display.choices("u-alice", a))).as("kept as given, a kind not loaded too (R5)").isEqualTo(new Result.Found(choices));
    assertThat(answer(a -> display.choices("u-bob", a))).isEqualTo(new Result.Found("{}"));

    assertThat(answer(a -> display.setChoices("u-alice", JSON.parse("{\"symbolSize\":100}"), a)))
        .isEqualTo(new Result.Refused(UserDocumentStore.Reason.INVALID, "symbolSize is a whole number from 16 to 96"));
    assertThat(answer(a -> display.setChoices("u-alice", JSON.parse("{}"), a))).as("Use defaults").isEqualTo(new Result.Written());
    assertThat(answer(a -> display.choices("u-alice", a))).isEqualTo(new Result.Found("{}"));
    assertThat(alice.types.next()).isEqualTo("display");

    display.setDefaults(JSON.parse("{\"speedVectorMinutes\":5}"));
    assertThat(bob.types.next()).as("bob got nothing before the defaults' notice").isEqualTo("display");
    assertThat(alice.types.next()).isEqualTo("display");
    assertThat(bob.types.drain()).isEmpty();
  }

  @Test
  void theShellsWayToItsDocumentsMayReadTheChoicesButNotWriteThem() {
    DisplaySettings display = display(new Configuration(new ConfigStore(null, JSON)));
    answer(a -> display.setChoices("u-alice", JSON.parse("{\"symbolSize\":40}"), a));

    Result refused = new Result.Refused(UserDocumentStore.Reason.INVALID, "the display settings are changed through /api/display");
    assertThat(answer(a -> documents.call(new UserDocuments.Call(UserDocuments.Kind.PUT, "u-alice", "core", "display", JSON.parse("{\"symbolSize\":1}")), a)))
        .isEqualTo(refused);
    assertThat(answer(a -> documents.call(new UserDocuments.Call(UserDocuments.Kind.DELETE, "u-alice", "core", "display", null), a)))
        .isEqualTo(refused);
    assertThat(answer(a -> documents.call(new UserDocuments.Call(UserDocuments.Kind.GET, "u-alice", "core", "display", null), a)))
        .isEqualTo(new Result.Found("{\"symbolSize\":40}"));
  }

  @Test
  void theAdminsDefaultsAreCheckedAndKeptWithTheConfiguration() {
    DisplaySettings display = display(new Configuration(new ConfigStore(data, JSON)));
    assertThat(display.defaults()).isEqualTo(JSON.parse("{}"));
    assertThatThrownBy(() -> display.setDefaults(JSON.parse("{\"labels\":[\"name\",\"name\"]}")))
        .isInstanceOf(IllegalArgumentException.class).hasMessage("label listed twice: name");

    display.setDefaults(JSON.parse("{\"symbolSize\":48,\"relations\":{\"gmti-pairing\":false}}"));
    display.setDefaults(JSON.parse("{\"symbolSize\":24,\"labels\":[]}"));

    DisplaySettings restarted = display(new Configuration(new ConfigStore(data, JSON)));
    assertThat(restarted.defaults()).as("replaced, and stored").hasToString("{\"symbolSize\":24,\"labels\":[]}");
  }
}
