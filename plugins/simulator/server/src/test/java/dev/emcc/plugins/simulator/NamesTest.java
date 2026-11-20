package dev.emcc.plugins.simulator;

import static dev.emcc.plugins.simulator.Routes.TWO_LEGS;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.store.Change;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Criterion 33 (function 10; T-121): "Put on route" names an object that has no name, so that outputs such as cot send a callsign (A73 to A76). */
class NamesTest {

  private static final String STEADY = "{\"points\": [{\"speed\": 100}, {\"speed\": 100}, {\"speed\": 100}]}";

  private final Rig rig = new Rig();

  private UUID symbol(@Nullable String name) {
    UUID id = UUID.randomUUID();
    var content = new MapObjectContent(MapObjectContent.SYMBOL, DataType.GENERAL, MapObjectContent.MANUAL, null, rig.layer.id(),
        new Geometry.Point(Position.of(17.0, 58.0)), new Symbol(SymbolStandard.APP_6D, Rig.SIDC, null), null,
        name == null ? null : new ObjectProperties(name, null), rig.ctx.defaultLabel(), Extensions.empty());
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.createObject(id, content)));
    return id;
  }

  private @Nullable String name(UUID id) {
    ObjectProperties p = rig.object(id).content().properties();
    return p == null ? null : p.name();
  }

  @Test
  @DisplayName("Criterion 33; A73, A74: unnamed and blank-named objects get the route's name and a number in the order put; a named one keeps its name")
  void namedAfterTheRoute() {
    UUID a = symbol(null);
    UUID named = symbol("Viper");
    UUID b = symbol("  ");
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    rig.putOnRoute(route, "convoy", ", \"spacing\": 100", a, named, b);
    assertThat(List.of(name(a), name(named), name(b))).containsExactly("Route 1-1", "Viper", "Route 1-2");
    assertThat(rig.ctx.store().unsaved()).isEmpty();
  }

  @Test
  @DisplayName("Criterion 33; A74: the number follows the highest one in Simulation; a route without a name gives \"Track-n\"")
  void theNextNumber() {
    symbol("Route 1-7");
    symbol("Route 1-x");
    UUID a = symbol(null);
    UUID route = rig.route(TWO_LEGS, STEADY);
    UUID nameless = UUID.randomUUID();
    MapObjectContent content = rig.routeContent(rig.layer, TWO_LEGS, Routes.json(STEADY), "Route 1");
    content = new MapObjectContent(content.type(), content.dataType(), content.dataSource(), content.time(), content.layerId(), content.geometry(),
        content.symbol(), content.style(), null, content.label(), content.extensions());
    Rig.applied(rig.ctx.store().applyAs(Actor.plugin(Manifest.id()), Change.createObject(nameless, content)));
    UUID b = symbol(null);
    rig.started();
    rig.putOnRoute(route, "single", "", a);
    rig.putOnRoute(nameless, "single", "", b);
    assertThat(name(a)).isEqualTo("Route 1-8");
    assertThat(name(b)).isEqualTo("Track-1");
  }

  @Test
  @DisplayName("Criterion 33; A76: the name is an ordinary one: it reaches the outputs, a reset keeps it, and it stays after \"Take off route\" and a new put")
  void anOrdinaryName() {
    UUID a = symbol(null);
    UUID route = rig.route(TWO_LEGS, STEADY);
    rig.started();
    rig.chooseTak();
    rig.putOnRoute(route, "single", "", a);
    rig.control(route, "start");
    rig.seconds(1);
    ChannelItem.Update sent = rig.sentToTak().stream().filter(ChannelItem.Update.class::isInstance).map(ChannelItem.Update.class::cast)
        .filter(u -> u.id().equals(a)).reduce((x, y) -> y).orElseThrow();
    assertThat(sent.content().properties().name()).isEqualTo("Route 1-1");
    rig.control(route, "reset");
    assertThat(name(a)).isEqualTo("Route 1-1");
    rig.takeOffRoute(a);
    rig.putOnRoute(route, "single", "", a);
    assertThat(name(a)).isEqualTo("Route 1-1");
  }
}
