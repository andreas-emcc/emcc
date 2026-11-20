package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.User;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Criterion 32 (function 25; BW, ADR-0042 point 5): the commands act through the server part, so they pass the layer lock. */
class LockTest {

  private static final String STEADY = "{\"points\": [{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]}";
  private static final User EDITOR = User.of("u1", "Editor", Set.of(Permissions.OBJECTS_EDIT, "plugin.simulator.edit"));

  private final Rig rig = new Rig();

  private void lock() {
    Layer current = rig.ctx.store().layers().stream().filter(l -> l.id().equals(rig.layer.id())).findFirst().orElseThrow();
    LayerContent c = current.content();
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("layer-panel"),
        Change.updateLayer(current, new LayerContent(c.name(), c.drawOrder(), c.visible(), c.label(), c.extensions(), c.workspace(), true))));
  }

  @Test
  @DisplayName("Criterion 32: in a locked layer, a user's change is refused, but put on route, start, the moves and take off route still run")
  void theCommandsPassTheLock() {
    UUID track = rig.symbol(Position.of(17.0, 58.0));
    UUID route = rig.route(TWO_LEGS, STEADY);
    lock();
    MapObject before = rig.object(track);
    ChangeOutcome user = rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), EDITOR, Change.deleteObject(before));
    assertThat(user).isInstanceOfSatisfying(ChangeOutcome.Rejected.class,
        r -> assertThat(r.rejection().code()).isEqualTo(ChangeRejection.Code.LAYER_LOCKED));
    rig.started();
    rig.putOnRoute(route, "single", "", track);
    assertThat(rig.position(track)).isEqualTo(TWO_LEGS.getFirst());
    rig.control(route, "start");
    rig.seconds(5);
    assertThat(rig.position(track)).isNotEqualTo(TWO_LEGS.getFirst());
    rig.takeOffRoute(track);
    assertThat(rig.extension(route).get("groups").toString()).doesNotContain(track.toString());
  }
}
