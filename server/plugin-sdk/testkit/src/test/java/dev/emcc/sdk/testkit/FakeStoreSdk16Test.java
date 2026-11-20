package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.DisplayClass;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Text;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.6.0 (CR-0041 parts A and D): the fake store keeps core.text's text and the display class, as ECore does. */
class FakeStoreSdk16Test {

  private final FakePluginContext ctx = FakePluginContext.builder("nvg").build();
  private final Layer layer = ctx.store().seedLayer("Imported");

  private MapObjectContent text(double lon, String value) {
    // lon differs from lat, so a swapped order would show
    return new MapObjectContent(MapObjectContent.TEXT, MapObjectContent.GENERAL, "nvg-file", null, layer.id(),
        new Geometry.Point(Position.of(lon, 62.3908)), null, null, null, layer.content().label(), Extensions.empty(), List.of(), List.of(),
        new Text(value, 330.0, 16), null);
  }

  private MapObject create(MapObjectContent content) {
    var outcome = ctx.store().applyAs(Actor.plugin("nvg"), Change.createObject(UUID.randomUUID(), content));
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    return ctx.store().objects().stream().filter(o -> o.content().equals(content)).findFirst().orElseThrow();
  }

  @Test
  void aTextObjectKeepsItsTextOnCreateAndUpdate() {
    MapObject o = create(text(17.3069, "Bridge 12"));
    assertThat(o.content().text()).isEqualTo(new Text("Bridge 12", 330.0, 16));
    ctx.store().applyAs(Actor.plugin("nvg"), Change.updateObject(o, text(17.3069, "Bridge 12 closed")));
    assertThat(ctx.store().object(o.id()).content().text()).isEqualTo(new Text("Bridge 12 closed", 330.0, 16));
  }

  @Test
  void anObjectKeepsItsDisplayClass() {
    var area = new MapObjectContent(MapObjectContent.SHAPE, MapObjectContent.GENERAL, "north", null, layer.id(),
        new Geometry.Circle(Position.of(17.3069, 62.3908), 20_000), null, null, null, layer.content().label(), Extensions.empty())
        .withDisplayClass(DisplayClass.SENSOR_COVERAGE);
    assertThat(create(area).content().displayClass()).isEqualTo("sensor-coverage");
  }

  @Test
  void anUnsavedMoveOfATextObjectIsAMove() {
    MapObject o = create(text(17.3069, "Bridge 12"));
    var outcome = ctx.store().applyAs(Actor.plugin("nvg"), Change.updateObject(o, text(17.4000, "Bridge 12")).notSaved());
    assertThat(outcome).isInstanceOf(ChangeOutcome.Applied.class);
    assertThat(ctx.store().object(o.id()).content().text()).isEqualTo(new Text("Bridge 12", 330.0, 16));
    assertThat(ctx.store().applyAs(Actor.plugin("nvg"), Change.updateObject(ctx.store().object(o.id()), text(17.4000, "Other")).notSaved()))
        .as("a change of the text is no move").isInstanceOf(ChangeOutcome.Rejected.class);
  }
}
