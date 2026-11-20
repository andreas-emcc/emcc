package dev.emcc.plugins.simulator;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The engine's own workspace filter, without the store's (ECore does not filter by workspace before
 * T-080; the test kit's store does, so {@link EngineTest} cannot show this alone).
 */
class PictureTest {

  private final Rig rig = new Rig();

  @Test
  @DisplayName("Function 2: View's layers and their objects never enter the picture, even when the store sends them")
  void keepsOnlySimulationLayers() {
    UUID inSimulation = rig.symbol(Position.of(18.0, 59.3));
    UUID inView = rig.symbol(rig.viewLayer, Position.of(18.0, 59.3));
    List<MapObject> everything = rig.ctx.store().objects();
    List<Layer> everyLayer = rig.ctx.store().layers();

    var picture = new Picture();
    picture.replace(everything, everyLayer, 10);
    assertThat(picture.objects()).extracting(MapObject::id).containsExactly(inSimulation);

    // A change in a View layer, as an unfiltered subscription would deliver it, is ignored too.
    MapObject view = rig.object(inView);
    ChangeOutcome moved = rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(view, view.content()));
    picture.changes(List.of(((ChangeOutcome.Applied) moved).event()));
    assertThat(picture.object(inView)).isNull();
  }

  @Test
  void aRestartedWorkerKeepsTheChangesThatArriveBeforeItsPicture() {
    var picture = new Picture();
    UUID track = rig.symbol(Position.of(18.0, 59.3));
    MapObject first = rig.object(track);
    List<MapObject> before = rig.ctx.store().objects();
    List<Layer> layers = rig.ctx.store().layers();
    ChangeOutcome later = rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.updateObject(first, first.content()));
    var event = ((ChangeOutcome.Applied) later).event();

    assertThat(picture.changes(List.of(event))).isTrue();
    assertThat(picture.loaded()).isFalse();
    picture.replace(before, layers, event.sequenceNo() - 1);
    assertThat(picture.object(track).version()).isEqualTo(2);
    assertThat(picture.newSnapshots()).isZero();
  }
}
