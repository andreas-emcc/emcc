package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.store.Change;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A scenario imported as new (brief function 32, criterion 46): a route created after its tracks
 * keeps them. The web part creates the routes last (the ITA's finding, 2026-11-08).
 */
class ImportTest {

  private static final String POINTS = "[{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]";

  private final Rig rig = new Rig().started();

  private Layer newLayer() {
    UUID id = UUID.randomUUID();
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin(Manifest.id()),
        Change.createLayer(id, new LayerContent("Imported", 2, true, rig.ctx.defaultLabel(), Extensions.empty(), Picture.WORKSPACE))));
    rig.ctx.runUntilIdle();
    return rig.ctx.store().layers().stream().filter(l -> l.id().equals(id)).findFirst().orElseThrow();
  }

  @Test
  @DisplayName("Criterion 46: a route created after its tracks, in a new layer, keeps them")
  void tracksFirst() {
    rig.control("reset");
    Layer layer = newLayer();
    UUID track = rig.symbol(layer, TWO_LEGS.getFirst());
    rig.ctx.runUntilIdle();
    UUID route = rig.route(layer, TWO_LEGS, Rig.single(track, POINTS));
    rig.ctx.runUntilIdle();
    rig.seconds(2);
    assertThat(rig.extension(route).get("groups").toString()).contains(track.toString());
  }

  @Test
  @DisplayName("Function 9a: a route created before its tracks loses them, which is why the import creates the routes last")
  void routeFirst() {
    rig.control("reset");
    Layer layer = newLayer();
    UUID track = UUID.randomUUID();
    UUID route = rig.route(layer, TWO_LEGS, Rig.single(track, POINTS));
    rig.ctx.runUntilIdle();
    rig.symbolWithId(layer, track, TWO_LEGS.getFirst());
    rig.ctx.runUntilIdle();
    rig.seconds(2);
    assertThat(rig.extension(route).get("groups").toString()).doesNotContain(track.toString());
  }
}
