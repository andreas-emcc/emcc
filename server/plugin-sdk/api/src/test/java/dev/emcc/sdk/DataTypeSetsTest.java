package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

/** SDK 1.5.0 part 1 (CR-0038 points 2 and 6): a data type's field sets and whether users make it by hand. */
class DataTypeSetsTest {

  private static final DataType.Defaults VESSEL = new DataType.Defaults(600L, true, 1800L);

  @Test
  void theFiveArgumentConstructorHasNoSetsAndIsManual() {
    var vessel = new DataType("ais.vessel", "AIS vessel", null, "ais", VESSEL);
    assertThat(vessel.fieldSets()).isEmpty();
    assertThat(vessel.manual()).isTrue();
    assertThat(DataType.general().fieldSets()).isEmpty();
    assertThat(DataType.general().manual()).isTrue();
  }

  @Test
  void aDataTypeNamesItsPluginsSetsByFullId() {
    var vessel = new DataType("ais.vessel", "AIS vessel", null, "ais", VESSEL).withFieldSets("ais.ship");
    assertThat(vessel.fieldSets()).containsExactly("ais.ship");
    var detection = new DataType("gmti.detection", "GMTI detection", null, "gmti", VESSEL, List.of("gmti.report"), false);
    assertThat(detection.manual()).isFalse();
    assertThat(detection.withManual(true).fieldSets()).containsExactly("gmti.report");
  }

  @Test
  void setsAreTheDeclaringPluginsEachOnceAtMostEight() {
    var vessel = new DataType("ais.vessel", "AIS vessel", null, "ais", VESSEL);
    assertThatThrownBy(() -> vessel.withFieldSets("cot.unit")).hasMessageContaining("not its plugin's");
    assertThatThrownBy(() -> vessel.withFieldSets("ship")).as("a short id").hasMessageContaining("not its plugin's");
    assertThatThrownBy(() -> vessel.withFieldSets("ais.ship", "ais.ship")).hasMessageContaining("each once");
    assertThatThrownBy(() -> vessel.withFieldSets("ais.a", "ais.b", "ais.c", "ais.d", "ais.e", "ais.f", "ais.g", "ais.h", "ais.i"))
        .hasMessageContaining("at most 8");
    assertThatThrownBy(() -> new DataType("core.general", "General", null, null, DataType.Defaults.NONE, List.of("core.x"), true))
        .as("core.general has none").hasMessageContaining("not its plugin's");
  }
}
