package dev.emcc.plugins.ais;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.SecurityLabel;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Work package 3: links at runtime, the layers they write to, and the ships in them. */
class LinksTest {

  private static Ais.Msg stockholm(long mmsi, double lon, double lat) {
    return Ais.classA(1, mmsi, 0, 100, lon, lat, 2705, 90);
  }

  @Test
  void aShipIsCreatedInANewLayerNamedLikeTheLinkWithTheLinkAsItsDataSource() {
    var rig = new Rig(Rig.link("harbour", ""));
    rig.receive("harbour", stockholm(265_123_456, 18.0723, 59.3311));

    assertThat(rig.ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("harbour");
    MapObject ship = rig.ship(265_123_456);
    assertThat(ship.content().dataSource()).isEqualTo("harbour");
    assertThat(ship.content().dataType()).isEqualTo("ais.vessel");
    assertThat(ship.content().layerId()).isEqualTo(rig.ctx.store().layers().getFirst().id());
    assertThat(ship.meta().externalRef().system()).isEqualTo("ais");
    assertThat(Rig.at(ship).longitude()).isCloseTo(18.0723, within(1e-6));
    assertThat(Rig.at(ship).latitude()).isCloseTo(59.3311, within(1e-6));
  }

  @Test
  void criterion11_newLayerWithANameMakesOneLayerThatLinksNamingItShare() {
    var rig = new Rig(
        Rig.link("north", "\"targetLayer\":{\"name\":\"Harbour ships\"}"),
        Rig.link("south", "\"targetLayer\":{\"name\":\"Harbour ships\"}"));
    rig.receive("north", stockholm(1, 18.0, 59.0));
    rig.receive("south", stockholm(2, 19.0, 58.0));

    assertThat(rig.ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("Harbour ships");
    assertThat(rig.ship(1).content().layerId()).isEqualTo(rig.ship(2).content().layerId());
    assertThat(rig.ship(1).content().dataSource()).isEqualTo("north");
    assertThat(rig.ship(2).content().dataSource()).isEqualTo("south");
  }

  @Test
  void aPickedLayerIsUsedAndNoLayerIsMade() {
    var rig = new Rig();
    Layer picked = rig.ctx.store().seedLayer("Existing");
    rig.ctx.store().gap();
    rig.useLinks(Rig.link("feed", "\"targetLayer\":{\"id\":\"" + picked.id() + "\",\"name\":\"Existing\"}"));
    rig.receive("feed", stockholm(1, 18.0, 59.0));

    assertThat(rig.ship(1).content().layerId()).isEqualTo(picked.id());
    assertThat(rig.requests(Operation.CREATE, dev.emcc.sdk.model.EntityType.LAYER)).isZero();
  }

  @Test
  void aPickedLayerThatIsDeletedLaterIsMadeAgainAtTheNextShipUnderItsName() {
    var rig = new Rig();
    Layer picked = rig.ctx.store().seedLayer("Harbour");
    rig.ctx.store().gap();
    rig.useLinks(Rig.link("feed", "\"targetLayer\":{\"id\":\"" + picked.id() + "\",\"name\":\"Harbour\"}"));
    rig.receive("feed", stockholm(1, 18.0, 59.0));
    assertThat(rig.ship(1).content().layerId()).isEqualTo(picked.id());

    // someone empties the layer and deletes it (model rule 11: only an empty layer goes)
    var other = dev.emcc.sdk.model.Actor.plugin("draw-symbols");
    rig.ctx.store().applyAs(other, dev.emcc.sdk.store.Change.deleteObject(rig.ship(1)));
    rig.ctx.store().applyAs(other, dev.emcc.sdk.store.Change.deleteLayer(rig.ctx.store().layers().getFirst()));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.store().layers()).isEmpty();

    rig.receive("feed", stockholm(2, 19.0, 58.0));
    assertThat(rig.ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("Harbour");
    assertThat(rig.ship(2).content().layerId()).isEqualTo(rig.ctx.store().layers().getFirst().id());
  }

  @Test
  void criterion21_aShipAUserMovedStaysWhereTheyPutItAndACopyIsNeverUpdated() {
    var rig = new Rig();
    Layer home = rig.ctx.store().seedLayer("Home");
    Layer mine = rig.ctx.store().seedLayer("Mine");
    rig.ctx.store().gap();
    rig.useLinks(Rig.link("feed", "\"targetLayer\":{\"id\":\"" + home.id() + "\",\"name\":\"Home\"}"));
    rig.receive("feed", stockholm(1, 18.0, 59.0));
    assertThat(rig.ship(1).content().layerId()).isEqualTo(home.id());

    // a user moves it into another layer: an update with a new layerId
    var user = dev.emcc.sdk.model.Actor.plugin("draw-symbols");
    MapObject ship = rig.ship(1);
    var c = ship.content();
    var moved = new dev.emcc.sdk.model.MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), mine.id(), c.geometry(), c.symbol(),
        c.style(), c.properties(), c.label(), c.extensions(), c.fieldSets(), c.relations());
    rig.ctx.store().applyAs(user, dev.emcc.sdk.store.Change.updateObject(ship, moved));
    rig.ctx.runUntilIdle();
    assertThat(rig.ship(1).content().layerId()).isEqualTo(mine.id());

    // the next report updates it where it is; a new ship goes to the link's layer
    rig.receive("feed", stockholm(1, 19.0, 58.0));
    rig.receive("feed", stockholm(2, 20.0, 57.0));
    assertThat(rig.ship(1).content().layerId()).isEqualTo(mine.id());
    assertThat(Rig.at(rig.ship(1)).longitude()).isCloseTo(19.0, within(1e-4));
    assertThat(rig.ship(2).content().layerId()).isEqualTo(home.id());
    assertThat(rig.ships()).hasSize(2);

    // a copy has no externalRef: it is not updated, and the original goes on
    var copy = dev.emcc.sdk.store.Change.createObject(java.util.UUID.randomUUID(), moved);
    rig.ctx.store().applyAs(user, copy);
    rig.ctx.runUntilIdle();
    rig.receive("feed", stockholm(1, 21.0, 56.0));
    assertThat(rig.ships()).hasSize(3);
    assertThat(rig.ships().stream().filter(o -> o.meta().externalRef() == null).findFirst().orElseThrow().content().geometry())
        .isEqualTo(moved.geometry());
    assertThat(Rig.at(rig.ship(1)).longitude()).isCloseTo(21.0, within(1e-4));
    assertThat(rig.ship(1).content().layerId()).isEqualTo(mine.id());
  }

  @Test
  void aLayerThatIsGoneIsMadeAgainUnderTheNameTheFormShowed() {
    var rig = new Rig();
    rig.useLinks(Rig.link("feed", "\"targetLayer\":{\"id\":\"018b2f4e-0000-7000-8000-000000000009\",\"name\":\"Lost layer\"}"));
    rig.receive("feed", stockholm(1, 18.0, 59.0));

    assertThat(rig.ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("Lost layer");
    assertThat(rig.ship(1).content().layerId()).isEqualTo(rig.ctx.store().layers().getFirst().id());
  }

  @Test
  void criterion8_aRestartKeepsTheLayerAndTheNextPositionUpdatesTheSameShipFoundByItsExternalRef() {
    var first = new Rig(Rig.link("harbour", ""));
    first.receive("harbour", stockholm(2_190_047, 18.0723, 59.3311));
    first.plugin.stop();

    // A new server run: the same store content and plugin documents, a fresh plugin.
    var second = new Rig(context -> {
      first.ctx.store().layers().forEach(context.store()::seed);
      first.ctx.store().objects().forEach(context.store()::seed);
      first.ctx.documents().stored().forEach(context.documents()::seed);
    }, Rig.link("harbour", ""));
    second.ctx.store().gap(); // the subscription sees the seeded content, as it would at the start of a run
    second.ctx.runUntilIdle();
    second.receive("harbour", stockholm(2_190_047, 19.5, 58.5));

    assertThat(second.ships()).hasSize(1);
    assertThat(Rig.at(second.ship(2_190_047)).longitude()).isCloseTo(19.5, within(1e-6));
    assertThat(second.ship(2_190_047).id()).isEqualTo(first.ship(2_190_047).id());
    assertThat(second.ship(2_190_047).meta().externalRef()).isEqualTo(new dev.emcc.sdk.model.ExternalRef("ais", "002190047")); // leading zeros kept
    assertThat(second.requests(Operation.CREATE)).as("neither the layer nor a ship is made again").isZero();
    assertThat(second.ctx.store().layers()).hasSize(1);
  }

  @Test
  void criterion11_aNewLayerIsKeptAfterARestartAndIsNotMadeAgain() {
    var first = new Rig(Rig.link("harbour", "\"targetLayer\":{\"name\":\"Harbour ships\"}"));
    first.receive("harbour", stockholm(1, 18.0, 59.0));
    first.plugin.stop();
    var second = new Rig(context -> {
      first.ctx.store().layers().forEach(context.store()::seed);
      first.ctx.store().objects().forEach(context.store()::seed);
      first.ctx.documents().stored().forEach(context.documents()::seed);
    }, Rig.link("harbour", "\"targetLayer\":{\"name\":\"Harbour ships\"}"));
    second.ctx.store().gap();
    second.ctx.runUntilIdle();
    second.receive("harbour", stockholm(2, 19.0, 58.0)); // a new ship goes to the same layer
    assertThat(second.ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("Harbour ships");
    assertThat(second.requests(Operation.CREATE, dev.emcc.sdk.model.EntityType.LAYER)).isZero();
    assertThat(second.ship(2).content().layerId()).isEqualTo(first.ship(1).content().layerId());
  }

  @Test
  void criterion11_theLinksLabelIsTheLabelOfItsLayerAndShipsElseTheServersDefault() {
    var rig = new Rig(
        Rig.link("secret", "\"label\":{\"policy\":\"NATO\",\"classification\":\"RESTRICTED\"}"),
        Rig.link("plain", ""));
    rig.receive("secret", stockholm(1, 18.0, 59.0));
    rig.receive("plain", stockholm(2, 19.0, 58.0));

    SecurityLabel restricted = SecurityLabel.of("NATO", "RESTRICTED");
    assertThat(rig.ship(1).content().label()).isEqualTo(restricted);
    assertThat(layer("secret", rig).content().label()).isEqualTo(restricted);
    assertThat(rig.ship(2).content().label()).isEqualTo(rig.ctx.defaultLabel());
    assertThat(layer("plain", rig).content().label()).isEqualTo(rig.ctx.defaultLabel());
  }

  private static Layer layer(String name, Rig rig) {
    return rig.ctx.store().layers().stream().filter(l -> l.content().name().equals(name)).findFirst().orElseThrow();
  }

  @Test
  void theStandardIdentityOfTheLinkIsInTheShipsSymbol() {
    var rig = new Rig(Rig.link("civil", "\"standardIdentity\":\"neutral\""), Rig.link("unsure", ""));
    rig.receive("civil", stockholm(1, 18.0, 59.0));
    rig.receive("unsure", stockholm(2, 19.0, 58.0));

    assertThat(rig.ship(1).content().symbol().sidc().charAt(3)).isEqualTo('4');
    assertThat(rig.ship(2).content().symbol().sidc().charAt(3)).isEqualTo('1'); // the default: unknown
  }

  @Test
  void criterion11_aLinkIsAddedChangedAndRemovedAtRuntime() {
    var rig = new Rig();
    rig.receive("late", stockholm(1, 18.0, 59.0));
    assertThat(rig.ships()).as("a link that does not exist yet").isEmpty();

    rig.useLinks(Rig.link("late", ""));
    assertThat(rig.ctx.pluginStatus().detail()).contains("late");
    rig.receive("late", stockholm(1, 18.0, 59.0));
    assertThat(rig.ships()).hasSize(1);
    assertThat(rig.ship(1).content().symbol().sidc().charAt(3)).isEqualTo('1');

    // changed: the identity and the label apply to the ships it writes next
    rig.useLinks(Rig.link("late", "\"standardIdentity\":\"hostile\",\"label\":{\"policy\":\"NATO\",\"classification\":\"RESTRICTED\"}"));
    rig.receive("late", stockholm(1, 18.5, 59.5));
    assertThat(rig.ship(1).content().symbol().sidc().charAt(3)).isEqualTo('6');
    assertThat(rig.ship(1).content().label()).isEqualTo(SecurityLabel.of("NATO", "RESTRICTED"));
    assertThat(rig.ships()).hasSize(1);

    // removed: what it receives is no longer written
    rig.useLinks();
    rig.receive("late", stockholm(1, 20.0, 60.0));
    assertThat(Rig.at(rig.ship(1)).longitude()).isCloseTo(18.5, within(1e-6));
    assertThat(rig.ctx.pluginStatus().detail()).isEqualTo("no links");
  }

  @Test
  void aChangedTargetLayerSendsTheNextNewShipsThere() {
    var rig = new Rig(Rig.link("feed", ""));
    rig.receive("feed", stockholm(1, 18.0, 59.0));
    rig.useLinks(Rig.link("feed", "\"targetLayer\":{\"name\":\"Elsewhere\"}"));
    rig.receive("feed", stockholm(2, 19.0, 58.0));

    assertThat(rig.ctx.store().layers()).extracting(l -> l.content().name()).containsExactlyInAnyOrder("feed", "Elsewhere");
    assertThat(layerOf(rig, 2)).isEqualTo("Elsewhere");
    assertThat(layerOf(rig, 1)).isEqualTo("feed"); // a ship stays where it is
  }

  private static String layerOf(Rig rig, int mmsi) {
    return rig.ctx.store().layers().stream().filter(l -> l.id().equals(rig.ship(mmsi).content().layerId())).findFirst().orElseThrow().content().name();
  }

  @Test
  void aShipTwoLinksReceiveBelongsToTheLinkThatMadeIt() {
    var rig = new Rig(Rig.link("first", ""), Rig.link("second", ""));
    rig.receive("first", stockholm(1, 18.0, 59.0));
    rig.receive("second", stockholm(1, 18.5, 59.5));

    assertThat(rig.ships()).hasSize(1);
    MapObject ship = rig.ship(1);
    assertThat(ship.content().dataSource()).isEqualTo("first");
    assertThat(Rig.at(ship).longitude()).isCloseTo(18.5, within(1e-6));
    assertThat(rig.ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("first");
  }

  @Test
  void criterion13_fiftyPositionsOfOneShipWhileItsUpdateIsInFlightCostTwoChangeRequestsAtMost() {
    var rig = new Rig(Rig.link("busy", ""));
    rig.receive("busy", stockholm(1, 18.0, 59.0)); // the ship exists
    long before = rig.requests(Operation.UPDATE);
    for (int i = 1; i <= 50; i++) {
      rig.send("busy", stockholm(1, 18.0 + i / 100.0, 59.0 + i / 100.0));
    }
    rig.ctx.runUntilIdle();

    assertThat(rig.requests(Operation.UPDATE) - before).isLessThanOrEqualTo(2);
    assertThat(Rig.at(rig.ship(1)).longitude()).isCloseTo(18.50, within(1e-6));
    assertThat(Rig.at(rig.ship(1)).latitude()).isCloseTo(59.50, within(1e-6));
  }

  @Test
  void manyShipsAreManyObjectsAndManyLinksNeedNoMoreLayersThanTheyName() {
    var rig = new Rig(Rig.link("busy", ""));
    for (int i = 1; i <= 200; i++) {
      rig.send("busy", stockholm(i, 18.0 + i / 1000.0, 59.0));
    }
    rig.ctx.runUntilIdle();
    assertThat(rig.ships()).hasSize(200);
    assertThat(rig.ctx.store().layers()).hasSize(1);
    List<Long> versions = rig.ships().stream().map(MapObject::version).toList();
    assertThat(versions).allMatch(v -> v == 1L);
  }
}
