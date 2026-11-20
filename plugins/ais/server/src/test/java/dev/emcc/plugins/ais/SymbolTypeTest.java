package dev.emcc.plugins.ais;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.plugins.ais.transport.Link;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.testkit.TestJson;
import org.junit.jupiter.api.Test;

/** The acceptance criteria 16 to 18 of the brief ({@code docs/plugins/briefs/ais.md}, section 10): vessel symbols and the field set. */
class SymbolTypeTest {

  private static final String VESSEL = Rig.link("feed", "\"standardIdentity\":\"neutral\",\"symbolType\":\"vessel\"");
  private static final String STORED = Rig.link("feed", "\"standardIdentity\":\"neutral\""); // a link stored before M5: no symbolType

  private static JsonObject entry(String json) {
    return (JsonObject) TestJson.parse(json);
  }

  @Test
  void aLinkReadsItsSymbolTypeAndAStoredLinkWithoutOneIsApp6() {
    assertThat(Link.from(entry(VESSEL)).symbolType()).isEqualTo(SymbolType.VESSEL);
    assertThat(Link.from(entry(Rig.link("feed", "\"symbolType\":\"app6\""))).symbolType()).isEqualTo(SymbolType.APP6);
    assertThat(Link.from(entry(STORED)).symbolType()).isEqualTo(SymbolType.APP6);
    org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () -> Link.from(entry(Rig.link("feed", "\"symbolType\":\"hull\""))));
  }

  @Test
  void aChangeOfTheSymbolTypeNeedsNoReconnect() {
    assertThat(Link.from(entry(VESSEL)).sameConnection(Link.from(entry(STORED)))).isTrue();
  }

  @Test
  void criterion16_aVesselLinkDrawsVesselSymbolsWithDirectionAndSpeed() {
    var rig = new Rig(VESSEL);
    rig.receive("feed", Ais.classA(1, 366_000_001, 0, 64, 18.0723, 59.3311, 2125, 511));
    MapObject ship = rig.ship(366_000_001);
    assertThat(ship.content().symbol().standard()).isEqualTo(SymbolStandard.VESSEL);
    assertThat(ship.content().symbol().sidc()).as("before its static message: neutral, type 0").isEqualTo("0400");
    assertThat(Rig.at(ship).longitude()).isCloseTo(18.0723, within(1e-4));
    assertThat(Rig.at(ship).latitude()).isCloseTo(59.3311, within(1e-4));

    rig.receive("feed", Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 71, 100, 20, 10, 12, 85, "STOCKHOLM"));
    var symbol = rig.ship(366_000_001).content().symbol();
    assertThat(symbol.standard()).isEqualTo(SymbolStandard.VESSEL);
    assertThat(symbol.sidc()).isEqualTo("0471");
    assertThat(symbol.vesselShipType()).isEqualTo(71);
    assertThat(symbol.modifiers().direction()).isEqualTo(212.5);
    assertThat(symbol.modifiers().speed()).isCloseTo(6.4 * 0.514444, within(0.001));
    assertThat(symbol.modifiers().text(dev.emcc.sdk.model.TextModifier.UNIQUE_DESIGNATION)).isEqualTo("TESTSHIP");
  }

  @Test
  void theIdentityOfTheLinkIsTheVesselSymbolsSecondDigit() {
    var rig = new Rig(Rig.link("feed", "\"standardIdentity\":\"hostile\",\"symbolType\":\"vessel\""));
    rig.receive("feed", Ais.classB(230_111_222, 55, 24.9384, 60.1699, 1800, 511));
    assertThat(rig.ship(230_111_222).content().symbol().sidc()).isEqualTo("0600");
  }

  @Test
  void criterion17_aStoredLinkKeepsApp6AndAChangeToVesselTurnsItsShipsAtTheNextUpdate() {
    var rig = new Rig(STORED);
    rig.receive("feed", Ais.classA(1, 366_000_001, 0, 0, 18.0, 59.0, 0, 0));
    assertThat(rig.ship(366_000_001).content().symbol().standard()).isEqualTo(SymbolStandard.APP_6D);
    assertThat(rig.ship(366_000_001).content().symbol().sidc()).isEqualTo("10043000001400000000");

    rig.useLinks(VESSEL);
    assertThat(rig.ship(366_000_001).content().symbol().standard()).as("not before the next update").isEqualTo(SymbolStandard.APP_6D);
    rig.receive("feed", Ais.classA(1, 366_000_001, 0, 0, 18.5, 59.5, 0, 0));
    assertThat(rig.ship(366_000_001).content().symbol().standard()).isEqualTo(SymbolStandard.VESSEL);
    assertThat(rig.ship(366_000_001).content().symbol().sidc()).isEqualTo("0400");

    rig.useLinks(STORED); // and back
    rig.receive("feed", Ais.voyage(366_000_001, 0, "", "", 80, 0, 0, 0, 0, 0, ""));
    assertThat(rig.ship(366_000_001).content().symbol().standard()).isEqualTo(SymbolStandard.APP_6D);
    assertThat(rig.ship(366_000_001).content().symbol().sidc()).isEqualTo("10043000001401090000");
  }

  @Test
  void aShipWhoseLinkIsGoneKeepsItsStandardAndIdentity() {
    var rig = new Rig(VESSEL);
    rig.receive("feed", Ais.classA(1, 1, 0, 0, 18.0, 59.0, 0, 0));
    rig.useLinks(Rig.link("other", "\"standardIdentity\":\"friend\""));
    rig.receive("other", Ais.classA(1, 1, 0, 0, 18.5, 59.5, 0, 0)); // the other link updates it; the stored ship decides
    assertThat(rig.ship(1).content().symbol().sidc()).isEqualTo("0400");
  }

  @Test
  void criterion18_theManifestDeclaresTheSetAndEveryShipCarriesItFromItsCreate() {
    var rig = new Rig(VESSEL);
    assertThat(rig.ctx.fieldSets()).extracting(dev.emcc.sdk.FieldSet::id).containsExactly("ais.ship");
    var set = rig.ctx.fieldSets().getFirst();
    assertThat(set.label()).isEqualTo("AIS ship");
    assertThat(set.fields()).containsExactly("callSign", "imo", "shipType", "navStatus", "heading", "length", "beam", "draught", "destination", "class");
    assertThat(rig.ctx.declaredFields()).hasSize(10).allSatisfy(f -> {
      assertThat(f.editableByOthers()).as(f.name()).isTrue();
      assertThat(f.dataTypes()).as(f.name()).isEmpty();
    });

    rig.receive("feed", Ais.classA(1, 366_000_001, 0, 0, 18.0, 59.0, 0, 0));
    assertThat(rig.ship(366_000_001).content().fieldSets()).containsExactly("ais.ship");
    rig.receive("feed", Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 71, 100, 20, 10, 12, 85, "STOCKHOLM"));
    assertThat(rig.ship(366_000_001).content().fieldSets()).containsExactly("ais.ship");
    JsonObject ais = rig.ship(366_000_001).content().extensions().get("ais");
    for (String field : rig.ctx.fieldSets().getFirst().fields()) {
      assertThat(ais.has(field)).as("the value of " + field + " is where section 3 puts it").isTrue();
    }
  }

  @Test
  void theShipsOfApp6LinksCarryTheSetToo() {
    var rig = new Rig(STORED);
    rig.receive("feed", Ais.classA(1, 1, 0, 0, 18.0, 59.0, 0, 0));
    assertThat(rig.ship(1).content().fieldSets()).containsExactly("ais.ship");
  }

  @Test
  void criterion20_theDataTypeNamesTheSetAndAShipCarriesItOnce() {
    var rig = new Rig(VESSEL);
    assertThat(rig.ctx.dataTypes()).filteredOn(t -> t.id().equals("ais.vessel")).singleElement()
        .satisfies(t -> assertThat(t.fieldSets()).containsExactly("ais.ship"));
    rig.receive("feed", Ais.classA(1, 366_000_001, 0, 0, 18.0, 59.0, 0, 0));
    assertThat(rig.ship(366_000_001).content().fieldSets()).containsExactly("ais.ship");
  }
}
