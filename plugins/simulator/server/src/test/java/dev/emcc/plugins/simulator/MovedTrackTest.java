package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.store.Change;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** A track a user moved into another layer of Simulation (brief function 40, criterion 60; T-155, ADR-0053 point 8). */
class MovedTrackTest {

  private final Rig rig = new Rig();

  private Layer simulationLayer(String name) {
    UUID id = UUID.randomUUID();
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("layer-panel"),
        Change.createLayer(id, new LayerContent(name, 1, true, rig.ctx.defaultLabel(), Extensions.empty(), Picture.WORKSPACE))));
    return rig.ctx.store().layers().stream().filter(l -> l.id().equals(id)).findFirst().orElseThrow();
  }

  /** "Move to layer…" and "Copy to layer…" as a user does them (ADR-0053): an update of the layer, and a new object. */
  private static MapObjectContent inLayer(MapObjectContent c, Layer layer) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), layer.id(), c.geometry(), c.symbol(), c.style(), c.properties(),
        c.label(), c.extensions(), c.fieldSets(), c.relations());
  }

  @Test
  @DisplayName("Criterion 60: a running track moved by a user into a second Simulation layer moves on along its route there, its layerId kept; its copy in a third layer is not moved")
  void aMovedTrackStays() {
    Layer second = simulationLayer("Red force");
    Layer third = simulationLayer("Copies");
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    UUID route = rig.route(TWO_LEGS, Rig.single(track, "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]"));
    rig.started();
    rig.control(route, "start");
    rig.seconds(2);
    Actor user = new Actor("layer-panel", "u1", null);
    MapObject before = rig.object(track);
    Rig.applied(rig.ctx.store().applyAs(user, Change.updateObject(before, inLayer(before.content(), second))));
    UUID copy = UUID.randomUUID();
    MapObjectContent copied = inLayer(rig.object(track).content(), third);
    Rig.applied(rig.ctx.store().applyAs(user, Change.createObject(copy, copied)));
    rig.ctx.runUntilIdle();
    Position moved = rig.position(track);
    Position copyAt = rig.position(copy);

    rig.seconds(5);
    assertThat(rig.position(track)).as("moved on along its route").isNotEqualTo(moved);
    assertThat(rig.object(track).content().layerId()).as("in the layer the user put it in").isEqualTo(second.id());
    assertThat(rig.position(copy)).as("a copy is not on a route").isEqualTo(copyAt);
    assertThat(rig.object(copy).content().layerId()).isEqualTo(third.id());
  }
}
