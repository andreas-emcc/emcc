package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.Samples;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.store.Change;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Brief function 31 and criterion 45 (M6, T-155; SDK 1.5.0 part 5, ADR-0053 point 8): a track a user moved into another layer stays
 * there, the next report updates it where it is, a new uid goes to the link's layer, and a copy (no external identity) is never updated.
 */
class MovedTrackTest {

  private static final Actor USER = Actor.plugin("draw-symbols");

  private Rig rig;

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static MapObjectContent in(MapObjectContent c, UUID layer) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), layer, c.geometry(), c.symbol(), c.style(), c.properties(), c.label(),
        c.extensions());
  }

  /** The object a user moved into another layer: an update with a new layer id, as "Move to layer…" does. */
  private Layer moveToElsewhere(String uid) {
    Layer elsewhere = rig.ctx.store().seedLayer("Elsewhere");
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    MapObject object = rig.object(uid);
    rig.ctx.store().applyAs(USER, Change.updateObject(object, in(object.content(), elsewhere.id())));
    rig.ctx.runUntilIdle();
    assertThat(rig.object(uid).content().layerId()).as("the user moved it").isEqualTo(elsewhere.id());
    return elsewhere;
  }

  private static double latitude(MapObject object) {
    return ((Geometry.Point) object.content().geometry()).coordinates().latitude();
  }

  private static double longitude(MapObject object) {
    return ((Geometry.Point) object.content().geometry()).coordinates().longitude();
  }

  @Test
  void aMovedTrackIsUpdatedWhereTheUserPutItAndANewOneGoesToTheLinksLayer() {
    rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("m1", 0, 59.0, 18.0));
    UUID linkLayer = rig.object("m1").content().layerId();
    Layer elsewhere = moveToElsewhere("m1");

    rig.feed("tak-north", Samples.at("m1", 10, 59.5, 18.5));
    MapObject moved = rig.object("m1");
    assertThat(moved.content().layerId()).as("the report did not take it back").isEqualTo(elsewhere.id());
    assertThat(latitude(moved)).as("latitude differs from longitude").isEqualTo(59.5);
    assertThat(longitude(moved)).isEqualTo(18.5);

    rig.feed("tak-north", Samples.at("m2", 20, 58.0, 17.0));
    assertThat(rig.object("m2").content().layerId()).as("a new uid goes to the link's layer").isEqualTo(linkLayer).isNotEqualTo(elsewhere.id());
  }

  @Test
  void anEventFromASecondLinkKeepsItThereToo() {
    rig = new Rig("tak-north", "tak-south");
    rig.feed("tak-north", Samples.at("m1", 0, 59.0, 18.0));
    Layer elsewhere = moveToElsewhere("m1");

    rig.feed("tak-south", Samples.at("m1", 10, 58.5, 17.5));
    MapObject moved = rig.object("m1");
    assertThat(moved.content().layerId()).isEqualTo(elsewhere.id());
    assertThat(latitude(moved)).isEqualTo(58.5);
    assertThat(longitude(moved)).isEqualTo(17.5);
  }

  @Test
  void aCopyHasNoExternalIdentityAndIsNeverUpdated() {
    rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("m1", 0, 59.0, 18.0));
    Layer elsewhere = moveToElsewhere("m1");
    // "Copy to layer…": a create with the original's content and no external reference
    var copyId = UUID.randomUUID();
    MapObject original = rig.object("m1");
    rig.ctx.store().applyAs(USER, Change.createObject(copyId, in(original.content(), elsewhere.id())));
    rig.ctx.runUntilIdle();
    MapObject copy = rig.ctx.store().object(copyId);
    assertThat(copy).isNotNull();
    assertThat(copy.meta().externalRef()).as("a copy has none").isNull();

    rig.feed("tak-north", Samples.at("m1", 10, 59.5, 18.5));
    assertThat(latitude(rig.object("m1"))).as("the original goes on").isEqualTo(59.5);
    MapObject copyAfter = rig.ctx.store().object(copyId);
    assertThat(latitude(copyAfter)).as("the copy stays as copied").isEqualTo(59.0);
    assertThat(longitude(copyAfter)).isEqualTo(18.0);
    assertThat(copyAfter.version()).isEqualTo(copy.version());
  }
}
