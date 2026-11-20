package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.testkit.FakePluginContext;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** From M4: the first layer (function 2; BT, BX; criterion 27) and the declared field in the outputs' tick (T-112). */
class M4Test {

  private static final DeclaredField TEAM = new DeclaredField("cot", "team", DeclaredField.Type.TEXT, "Team", null, null, null, null, null,
      false, List.of(), true, List.of());

  private static FakePluginContext context() {
    return FakePluginContext.builder(Manifest.id()).settings(Manifest.settingDefaults()).dataTypes(Rig.ROUTE).workspaces(Rig.SIMULATION).build();
  }

  private static List<Layer> simulationLayers(FakePluginContext ctx) {
    return ctx.store().layers().stream().filter(l -> Picture.WORKSPACE.equals(l.content().workspace())).toList();
  }

  private static void start(FakePluginContext ctx) {
    SimulatorPlugin plugin = new SimulatorPlugin(new Rig.FakeClock(ctx));
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  @Test
  @DisplayName("Criterion 27: a start with no Simulation layers creates \"Simulation\" there, with the default label; View's layers stay")
  void theFirstLayer() {
    FakePluginContext ctx = context();
    Layer view = ctx.store().seedLayer("Drawing");
    start(ctx);
    assertThat(simulationLayers(ctx)).singleElement().satisfies(l -> {
      assertThat(l.content().name()).isEqualTo("Simulation");
      assertThat(l.content().label()).isEqualTo(ctx.defaultLabel());
      assertThat(l.content().visible()).isTrue();
    });
    assertThat(ctx.store().layers()).contains(view).hasSize(2);
  }

  @Test
  @DisplayName("Criterion 27: with a Simulation layer, a start creates none; one deleted while running is not made again until the next start")
  void noSecondLayer() {
    FakePluginContext ctx = context();
    UUID id = UUID.randomUUID();
    ctx.store().applyAs(Actor.plugin("layer-panel"),
        Change.createLayer(id, new LayerContent("Red force", 1, true, ctx.defaultLabel(), Extensions.empty(), Picture.WORKSPACE)));
    start(ctx);
    assertThat(simulationLayers(ctx)).extracting(l -> l.content().name()).containsExactly("Red force");
    Layer red = simulationLayers(ctx).getFirst();
    ctx.store().applyAs(Actor.plugin("layer-panel"), Change.deleteLayer(red));
    ctx.runUntilIdle();
    assertThat(simulationLayers(ctx)).isEmpty();
  }

  @Test
  @DisplayName("T-112: an event that sets the name and a declared field sends both to the outputs in the same tick")
  void aDeclaredFieldInTheSameTick() {
    Rig rig = new Rig(TEAM);
    UUID track = rig.symbol(TWO_LEGS.getFirst());
    String set = "{\"kind\": \"set\", \"core\": {\"name\": \"Cyan one\"}, \"fields\": [{\"plugin\": \"cot\", \"name\": \"team\", \"value\": \"Cyan\"}]}";
    UUID route = rig.route(TWO_LEGS, Rig.single(track, "[{\"speed\": 100, \"events\": [" + set + "]}, {\"speed\": 100}, {\"speed\": 100}]"));
    rig.started();
    rig.chooseTak();
    rig.control(route, "start");
    boolean sawBoth = false;
    for (int t = 0; t < 3; t++) {
      int before = rig.sentToTak().size();
      rig.seconds(1);
      List<ChannelItem.Update> tick = rig.sentToTak().subList(before, rig.sentToTak().size()).stream()
          .filter(ChannelItem.Update.class::isInstance).map(ChannelItem.Update.class::cast).filter(u -> u.id().equals(track)).toList();
      assertThat(tick).hasSize(1);
      var content = tick.getFirst().content();
      boolean named = content.properties() != null && "Cyan one".equals(content.properties().name());
      var cot = content.extensions().get("cot");
      boolean teamed = cot != null && JsonString.of("Cyan").equals(cot.get("team"));
      assertThat(teamed).as("tick %d: the field comes with the name", t).isEqualTo(named);
      sawBoth |= named && teamed;
    }
    assertThat(sawBoth).isTrue();
    assertThat(rig.object(track).content().extensions().get("cot").get("team")).isEqualTo(JsonString.of("Cyan"));
  }
}
