package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** SDK 1.4.0 part 3 (CR-0030 part 3, CR-0031): field sets, vessel symbols and relations in the Java types. */
class Part3TypesTest {

  private static final UUID LAYER = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01");
  private static final UUID A = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e21");
  private static final UUID B = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e22");
  private static final UUID C = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e23");

  private static MapObjectContent content() {
    // lon differs from lat, so a swapped order would show
    return new MapObjectContent("core.symbol", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, LAYER,
        new Geometry.Point(Position.of(11.8512, 57.6934)), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null),
        null, null, SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
  }

  @Test
  void theOlderConstructorGivesNoSetsOrRelationsAndTheCopiesKeepThem() {
    MapObjectContent c = content();
    assertThat(c.fieldSets()).isEmpty();
    assertThat(c.relations()).isEmpty();
    MapObjectContent withBoth = c.withFieldSet("cot.unit").withRelations(List.of(new Relation("gmti.pairing", A)));
    assertThat(withBoth.fieldSets()).containsExactly("cot.unit");
    assertThat(withBoth.withFieldSet("cot.unit")).as("a set it carries is not added twice").isSameAs(withBoth);
    assertThat(withBoth.withFieldSet("ais.ship").fieldSets()).containsExactly("cot.unit", "ais.ship");
    assertThat(withBoth.withFieldSets(List.of("ais.ship")).relations()).as("a copy keeps the relations").containsExactly(new Relation("gmti.pairing", A));
    assertThat(withBoth.withRelations(List.of()).fieldSets()).as("a copy keeps the sets").containsExactly("cot.unit");
    assertThat(c).isEqualTo(content().withFieldSets(List.of()).withRelations(List.of()));
  }

  @Test
  void setsAndRelationsAreCheckedAsTheSchemaDoes() {
    MapObjectContent c = content();
    assertThatThrownBy(() -> c.withFieldSets(List.of("cot.unit", "cot.unit"))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> c.withFieldSets(List.of("unit"))).isInstanceOf(IllegalArgumentException.class);
    var many = new ArrayList<String>();
    for (int i = 0; i <= MapObjectContent.MAX_FIELD_SETS; i++) {
      many.add("p" + i + ".set");
    }
    assertThatThrownBy(() -> c.withFieldSets(many)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> c.withRelations(List.of(new Relation("gmti.pairing", A), new Relation("gmti.pairing", A)))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Relation("pairing", A)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> c.withRelations(null)).isInstanceOf(NullPointerException.class).hasMessage("relations");
    var tooMany = new ArrayList<Relation>();
    for (int i = 0; i <= Relation.MAX_PER_OBJECT; i++) {
      tooMany.add(new Relation("gmti.pairing", new UUID(0, i)));
    }
    assertThatThrownBy(() -> c.withRelations(tooMany)).isInstanceOf(IllegalArgumentException.class);
    assertThat(c.withRelations(tooMany.subList(0, Relation.MAX_PER_OBJECT)).relations()).hasSize(1_024);
  }

  @Test
  void replaceKeepsOtherKindsAndListsEachIdOnce() {
    List<Relation> stored = List.of(new Relation("gmti.pairing", A), new Relation("other.link", C), new Relation("gmti.pairing", B));
    assertThat(Relation.replace(stored, "gmti.pairing", List.of(C, B, C)))
        .containsExactly(new Relation("other.link", C), new Relation("gmti.pairing", C), new Relation("gmti.pairing", B));
    assertThat(Relation.replace(stored, "gmti.pairing", List.of())).as("an empty report empties the kind").containsExactly(new Relation("other.link", C));
  }

  @Test
  void aVesselHasFourDigitsAndReadsThemBack() {
    Symbol ship = Symbol.vessel(Symbol.IDENTITY_NEUTRAL, 70, Modifiers.builder().direction(212.5).speed(6.4).build());
    assertThat(ship.standard()).isEqualTo(SymbolStandard.VESSEL);
    assertThat(ship.sidc()).isEqualTo("0470");
    assertThat(ship.isVessel()).isTrue();
    assertThat(ship.vesselContext()).isEqualTo(Symbol.CONTEXT_REALITY);
    assertThat(ship.vesselIdentity()).isEqualTo(4);
    assertThat(ship.vesselShipType()).isEqualTo(70);
    assertThat(Symbol.vessel(Symbol.CONTEXT_SIMULATION, Symbol.IDENTITY_HOSTILE, 7, null).sidc()).isEqualTo("2607");
    assertThat(SymbolStandard.fromJson("vessel")).isEqualTo(SymbolStandard.VESSEL);
    assertThatThrownBy(() -> new Symbol(SymbolStandard.VESSEL, "3470", null)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Symbol(SymbolStandard.VESSEL, "470", null)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Symbol.vessel(7, 70, null)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Symbol.vessel(4, 100, null)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null).vesselShipType()).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aFieldSetHasAFullIdAndItsPluginsFields() {
    FieldSet unit = new FieldSet("cot", "unit", "CoT unit", List.of("callsign", "role"));
    assertThat(unit.id()).isEqualTo("cot.unit");
    assertThat(unit.refs()).containsExactly(new FieldRef("cot", "callsign"), new FieldRef("cot", "role"));
    assertThatThrownBy(() -> new FieldSet("cot", "unit", "CoT unit", List.of())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new FieldSet("cot", "unit", "CoT unit", List.of("role", "role"))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new FieldSet("cot", "Unit", "CoT unit", List.of("role"))).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aRelationKindHasItsLineWithDefaults() {
    var kind = new RelationKind("gmti.pairing", "GMTI Pairing", RelationKind.Line.of("#FFFF00"), false);
    assertThat(kind.plugin()).isEqualTo("gmti");
    assertThat(kind.line()).isEqualTo(new RelationKind.Line("#FFFF00", 1, Style.Dash.SOLID, Style.Arrowhead.NONE));
    assertThat(RelationKind.Line.of("#FF0000", 2.5, Style.Dash.DASH, null).arrowhead()).isEqualTo(Style.Arrowhead.NONE);
    assertThatThrownBy(() -> RelationKind.Line.of("yellow")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new RelationKind.Line("#FFFF00", 0.4, Style.Dash.SOLID, Style.Arrowhead.NONE)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new RelationKind("pairing", "GMTI Pairing", RelationKind.Line.of("#FFFF00"), false)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aChannelNamesItsFieldSetAndTheOlderConstructorsHaveNone() {
    ChannelSpec spec = ChannelSpec.of("tak-north", "TAK North (out)", "cot").fieldSet("cot.unit").kinds(Set.of(ChannelKind.GROUND_TRUTH));
    assertThat(spec.fieldSet()).isEqualTo("cot.unit");
    assertThat(ChannelInfo.of("cot", spec).fieldSet()).isEqualTo("cot.unit");
    assertThat(ChannelSpec.of("tak-north", "TAK North (out)", "cot").fieldSet()).isNull();
    assertThat(new ChannelInfo(new ChannelId("cot", "tak-north"), "TAK", "cot", Set.of(), List.of(), Set.of(ChannelKind.GROUND_TRUTH)).fieldSet()).isNull();
    assertThatThrownBy(() -> spec.fieldSet("unit")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theNewListsAndFoldersAreAbstractSinceTheFreeze() throws NoSuchMethodException {
    // Default methods that threw until ECore had them; abstract since the 1.4.0 freeze, as W1 did for 1.2.0.
    for (String name : List.of("fieldSets", "relationKinds", "folders")) {
      var method = PluginContext.class.getMethod(name);
      assertThat(method.isDefault()).as(name).isFalse();
      assertThat(java.lang.reflect.Modifier.isAbstract(method.getModifiers())).as(name).isTrue();
    }
  }
}
