package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Position;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Saving and restoring (ADR-0041; brief functions 19 to 21; criteria 17 to 20; A12, A22 to A24). */
class SavingTest {

  private static final String STEADY = "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]";

  private final Rig rig = new Rig();

  private static double metres(Position a, Position b) {
    return Geodesy.inverse(a, b).distanceMetres();
  }

  private Map<String, JsonObject> documents() {
    return rig.ctx.documents().stored();
  }

  private boolean lastWriteSaved(UUID id) {
    List<ChangeRequest> all = rig.ctx.store().requests().stream().filter(r -> r.entityId().equals(id)).toList();
    return !all.isEmpty() && !rig.ctx.store().unsaved().contains(all.getLast());
  }

  @Test
  @DisplayName("Criterion 18: a save before a run, at a pause and at the end, each at the next tick, with all tracks; no periodic save")
  void theSavingMoments() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, STEADY));
    rig.started();
    assertThat(documents()).isEmpty();
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(documents()).containsKeys(SavedState.STATE, "tracks-0");
    assertThat(lastWriteSaved(track)).as("the tick's move is saved with the state").isTrue();
    assertThat(documents().get("tracks-0").toString()).contains(track.toString());
    rig.seconds(20);
    assertThat(rig.ctx.pluginStatus().detail()).as("no periodic save").contains("saves 1,");
    assertThat(lastWriteSaved(track)).isFalse();
    rig.control(route, "pause");
    rig.seconds(1);
    assertThat(rig.ctx.pluginStatus().detail()).contains("saves 2,");
    assertThat(documents().get(SavedState.STATE).toString()).contains("paused");
  }

  @Test
  @DisplayName("Criteria 19 and 20 (plugin): after a crash, every track is placed from the saved state, paused")
  void aCrashComesBackAtTheLastSave() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, STEADY));
    rig.started();
    rig.control(route, "start");
    rig.seconds(10);
    rig.control(route, "pause");
    rig.seconds(1);
    Position saved = rig.position(track);
    rig.control(route, "start");
    rig.seconds(1); // the save before the run: here
    Position savedAgain = rig.position(track);
    rig.seconds(5); // moves, not saved

    rig.ctx.store().restart(); // a crash: the store comes back with what was saved
    rig.ctx.restart(rig.engine()); // and the worker starts again
    rig.ctx.runUntilIdle();
    assertThat(metres(rig.position(track), savedAgain)).isLessThan(0.01);
    assertThat(metres(saved, TWO_LEGS.getFirst())).isCloseTo(1_000, within(1.0));
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"state\":\"paused\"");
    assertThat(rig.object(track).content().symbol().modifiers().speed()).isZero();
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(metres(rig.position(track), TWO_LEGS.getFirst())).isCloseTo(1_200, within(1.0));
  }

  @Test
  @DisplayName("Function 21: the routes' lists decide; progress for another route or for no list counts as none; deleted tracks are counted")
  void theListsDecide() {
    UUID kept = rig.symbol(TWO_LEGS.getFirst());
    UUID otherRoute = rig.symbol(Position.of(17.0, 58.0));
    UUID offList = rig.symbol(Position.of(17.5, 58.0));
    UUID deleted = UUID.randomUUID();
    String groups = "[{\"kind\": \"single\", \"objects\": [{\"id\": \"" + kept + "\"}]}, {\"kind\": \"single\", \"objects\": [{\"id\": \"" + otherRoute + "\"}]}]";
    UUID route = rig.route(TWO_LEGS, "{\"points\": " + STEADY + ", \"groups\": " + groups + "}");
    var progress = new java.util.LinkedHashMap<UUID, SavedState.Progress>();
    progress.put(kept, new SavedState.Progress(route, false, 50, 0, 0.1, 1));
    progress.put(otherRoute, new SavedState.Progress(UUID.randomUUID(), false, 50, 0, 0.5, 1));
    progress.put(offList, new SavedState.Progress(route, false, 50, 0, 0.5, 1));
    progress.put(deleted, new SavedState.Progress(route, false, 50, 0, 0.5, 1));
    rig.ctx.documents().seed(SavedState.STATE, SavedState.state(Instant.EPOCH, Map.of(route, "running"), List.of(), 1, new dev.emcc.sdk.json.JsonArray(List.of())));
    rig.ctx.documents().seed("tracks-0", SavedState.tracks(progress).getFirst());
    rig.started();

    double firstLeg = metres(TWO_LEGS.get(0), TWO_LEGS.get(1));
    assertThat(metres(rig.position(kept), TWO_LEGS.getFirst())).isCloseTo(0.1 * firstLeg, within(0.5));
    assertThat(rig.position(otherRoute)).as("placed as Put on route places it").isEqualTo(TWO_LEGS.getFirst());
    assertThat(rig.position(offList)).as("on no list: stays where it is").isEqualTo(Position.of(17.5, 58.0));
    assertThat(rig.get("/routes/" + route).reply().body().toUtf8()).contains("\"state\":\"paused\"");
    assertThat(rig.ctx.pluginStatus().detail()).contains("tracks deleted 1");
  }

  @Test
  @DisplayName("ADR-0041 point 6: a clean stop pauses and saves, best effort")
  void aCleanStop() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, STEADY));
    rig.started();
    rig.control(route, "start");
    rig.seconds(5);
    rig.plugin.stop();
    rig.ctx.runUntilIdle();
    assertThat(lastWriteSaved(track)).isTrue();
    assertThat(rig.object(track).content().symbol().modifiers().speed()).isZero();
    assertThat(documents().get(SavedState.STATE).toString()).contains("paused");
    var progress = new java.util.HashMap<UUID, SavedState.Progress>();
    SavedState.readTracks(documents().get("tracks-0"), progress);
    assertThat(progress.get(track).seconds()).as("saved at the stop, not at the last saving moment").isEqualTo(5.0);
  }

  @Test
  @DisplayName("A23: while the saved state cannot be read, nothing moves and commands answer 503; it is read again at the next tick")
  void aStateThatCannotBeReadYet() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, STEADY));
    rig.ctx.documents().failNext("disk busy");
    rig.started();
    assertThat(rig.ctx.pluginStatus().detail()).startsWith("reading the saved state").contains("document failures 1");
    assertThat(rig.post("/routes/" + route + "/start", "{}").reply().status()).isEqualTo(503);
    rig.seconds(1);
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(metres(rig.position(track), TWO_LEGS.getFirst())).isCloseTo(100, within(1.0));
  }

  @Test
  @DisplayName("A24: more than 1 000 tracks are saved in several documents, and all come back")
  void manyTracks() {
    var groups = new StringBuilder();
    List<UUID> all = new java.util.ArrayList<>();
    for (int i = 0; i < SavedState.PER_DOCUMENT + 1; i++) {
      UUID t = rig.symbol(TWO_LEGS.getFirst());
      all.add(t);
      groups.append(i == 0 ? "" : ",").append("{\"kind\": \"single\", \"objects\": [{\"id\": \"").append(t).append("\"}]}");
    }
    UUID route = rig.route(TWO_LEGS, "{\"points\": " + STEADY + ", \"groups\": [" + groups + "]}");
    rig.started();
    rig.control(route, "start");
    rig.seconds(3);
    rig.control(route, "pause");
    rig.seconds(1);
    assertThat(documents()).containsKeys("tracks-0", "tracks-1");
    rig.ctx.store().restart();
    rig.ctx.restart(rig.engine());
    rig.ctx.runUntilIdle();
    assertThat(all).allSatisfy(t -> assertThat(metres(rig.position(t), TWO_LEGS.getFirst())).isCloseTo(300, within(1.0)));
  }

  @Test
  void aDocumentThatCannotBeWrittenIsCounted() {
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, STEADY));
    rig.started();
    rig.control(route, "start");
    rig.ctx.documents().failNext("disk full");
    rig.seconds(1);
    assertThat(rig.ctx.pluginStatus().detail()).contains("saves 1, document failures 1");
  }

  @Test
  @DisplayName("A24: a smaller save deletes the track documents it no longer needs")
  void leftoverDocumentsAreDeleted() {
    UUID route = rig.route(TWO_LEGS, "{\"points\": " + STEADY + "}");
    rig.ctx.documents().seed(SavedState.STATE, SavedState.state(Instant.EPOCH, Map.of(), List.of(), 3, new dev.emcc.sdk.json.JsonArray(List.of())));
    rig.ctx.documents().seed("tracks-0", JsonObject.empty());
    rig.ctx.documents().seed("tracks-1", JsonObject.empty());
    rig.ctx.documents().seed("tracks-2", JsonObject.empty());
    rig.started();
    rig.control(route, "start");
    rig.seconds(1);
    assertThat(documents()).containsKey(SavedState.STATE).doesNotContainKeys("tracks-0", "tracks-1", "tracks-2");
  }
}
