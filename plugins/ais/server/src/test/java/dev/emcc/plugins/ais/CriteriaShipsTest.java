package dev.emcc.plugins.ais;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.TextModifier;
import org.junit.jupiter.api.Test;

/** The acceptance criteria 6, 7 and 9 of the brief ({@code docs/plugins/briefs/ais.md}, section 8), against the fake object store. */
class CriteriaShipsTest {

  private static final String LINK = Rig.link("feed", "");

  @Test
  void criterion6_staticDataBeforeAPositionCreatesNothingAndGoesWithTheFirstPosition() {
    var rig = new Rig(LINK);
    rig.receive("feed", Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 71, 100, 20, 10, 12, 85, "STOCKHOLM"));
    assertThat(rig.ships()).isEmpty();
    assertThat(rig.requests(Operation.CREATE, EntityType.OBJECT)).isZero();
    assertThat(rig.ctx.store().layers()).as("no layer for a ship that is not there").isEmpty();

    rig.receive("feed", Ais.classA(1, 366_000_001, 0, 0, 18.0723, 59.3311, 0, 0));
    MapObject ship = rig.ship(366_000_001);
    assertThat(ship.content().properties().name()).isEqualTo("TESTSHIP");
    assertThat(ship.content().symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).isEqualTo("TESTSHIP");
    assertThat(ship.content().symbol().sidc()).isEqualTo("10013000001401000000"); // merchant ship, unknown identity
    JsonObject ais = ship.content().extensions().get("ais");
    assertThat(((JsonString) ais.get("callSign")).value()).isEqualTo("WDC1234");
    assertThat(((JsonNumber) ais.get("imo")).longValueExact()).isEqualTo(9_074_729);
    assertThat(((JsonString) ais.get("destination")).value()).isEqualTo("STOCKHOLM");
    assertThat(rig.requests(Operation.CREATE, EntityType.OBJECT)).isEqualTo(1);
  }

  @Test
  void criterion6_part24AThenPart24BGiveTheNameThenTheTypeAndTheCallSign() {
    var rig = new Rig(LINK);
    rig.receive("feed", Ais.partA(230_111_222, "SEA BREEZE"));
    rig.receive("feed", Ais.partB(230_111_222, 36, "OH1234", 8, 4, 2, 2));
    assertThat(rig.ships()).isEmpty();

    rig.receive("feed", Ais.classB(230_111_222, 55, 24.9384, 60.1699, 1800, 511));
    MapObject ship = rig.ship(230_111_222);
    assertThat(ship.content().properties().name()).isEqualTo("SEA BREEZE");
    assertThat(ship.content().symbol().sidc()).isEqualTo("10013000001400000000"); // 36: sailing, no entity of its own: generic civilian
    JsonObject ais = ship.content().extensions().get("ais");
    assertThat(((JsonString) ais.get("callSign")).value()).isEqualTo("OH1234");
    assertThat(((JsonNumber) ais.get("shipType")).longValueExact()).isEqualTo(36);
    assertThat(((JsonNumber) ais.get("length")).longValueExact()).isEqualTo(12);
    assertThat(((JsonString) ais.get("class")).value()).isEqualTo("B");
  }

  @Test
  void criterion6_staticDataThatArrivesLaterUpdatesTheShipAndAnUnchangedRepeatCostsNoRequest() {
    var rig = new Rig(LINK);
    rig.receive("feed", Ais.classA(1, 366_000_001, 0, 0, 18.0, 59.0, 0, 0));
    assertThat(rig.ship(366_000_001).content().properties().name()).isEqualTo("366000001");

    var voyage = Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 80, 100, 20, 10, 12, 85, "STOCKHOLM");
    rig.receive("feed", voyage);
    assertThat(rig.ship(366_000_001).content().properties().name()).isEqualTo("TESTSHIP");
    assertThat(rig.ship(366_000_001).content().symbol().sidc()).isEqualTo("10013000001401090000");
    long updates = rig.requests(Operation.UPDATE);
    rig.receive("feed", voyage); // the same again, as ships send it every few minutes
    assertThat(rig.requests(Operation.UPDATE)).isEqualTo(updates);
  }

  @Test
  void criterion7_theSidcFollowsTheShipTypeAndTheLinksStandardIdentity() {
    var rig = new Rig(Rig.link("feed", "\"standardIdentity\":\"neutral\""));
    int[][] types = {{30, 1}, {65, 2}, {71, 3}, {84, 4}, {0, 5}};
    String[] expected = {"10043000001402000000", "10043000001401100000", "10043000001401000000", "10043000001401090000", "10043000001400000000"};
    for (int[] t : types) {
      rig.receive("feed", Ais.voyage(t[1], 0, "", "", t[0], 0, 0, 0, 0, 0, ""));
      rig.receive("feed", Ais.classA(1, t[1], 0, 0, 18.0 + t[1] / 10.0, 59.0, 0, 0));
    }
    for (int i = 0; i < types.length; i++) {
      assertThat(rig.ship(types[i][1]).content().symbol().sidc()).as("ship type " + types[i][0]).isEqualTo(expected[i]);
      assertThat(rig.ship(types[i][1]).content().symbol().standard().json()).isEqualTo("APP-6D");
    }
  }

  @Test
  void criterion7_aShipWithoutAKnownTypeIsAGenericCivilian() {
    var rig = new Rig(LINK);
    rig.receive("feed", Ais.classA(1, 1, 0, 0, 18.0, 59.0, 0, 0));
    assertThat(rig.ship(1).content().symbol().sidc()).isEqualTo("10013000001400000000");
  }

  @Test
  void criterion9_theObjectsHaveTheDataTypeAndTheLinksNameAsDataSource() {
    var rig = new Rig(LINK);
    rig.receive("feed", Ais.classA(1, 1, 0, 0, 18.0, 59.0, 0, 0));
    assertThat(rig.ship(1).content().dataType()).isEqualTo("ais.vessel");
    assertThat(rig.ship(1).content().dataSource()).isEqualTo("feed");
  }

  @Test
  void criterion9_theManifestDeclaresTheTypeWithTheDefaultsOfTheBrief() {
    JsonArray types = (JsonArray) Manifest.read().get("dataTypes");
    assertThat(types.size()).isEqualTo(1);
    JsonObject type = (JsonObject) types.values().getFirst();
    assertThat(type.getString("id")).isEqualTo("ais.vessel");
    assertThat(type.getString("name")).isEqualTo("AIS vessel");
    JsonObject defaults = type.getObject("defaults");
    assertThat(defaults.getNumber("expiresAfterSeconds").longValueExact()).isEqualTo(600);
    assertThat(defaults.getBoolean("fadeWhenExpired")).isTrue();
    assertThat(defaults.getNumber("removeAfterExpirySeconds").longValueExact()).isEqualTo(1_800);
  }

  @Test
  void theManifestDeclaresInputConnectionsOnlyAndNoInternetHostByDefault() {
    JsonObject connections = (JsonObject) ((JsonArray) Manifest.read().get("connections")).values().getFirst();
    assertThat(connections.getString("direction")).isEqualTo("in");
    assertThat(connections.getString("settings")).isEqualTo("/links");
    assertThat(((JsonArray) connections.get("kinds")).values()).extracting(v -> ((JsonString) v).value()).containsExactlyInAnyOrder("udp", "tcp-client");
    assertThat(((JsonArray) Manifest.read().getObject("internet").get("hosts")).size()).isZero();
    assertThat(Manifest.read().getString("sdkVersion")).isEqualTo("^1.8.0");
  }
}
