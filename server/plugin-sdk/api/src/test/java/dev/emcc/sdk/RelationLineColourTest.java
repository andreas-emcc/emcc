package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.model.Style;
import org.junit.jupiter.api.Test;

/** SDK 1.6.0 part C (CR-0041; T-181): a relation line's colour from a setting. */
class RelationLineColourTest {

  @Test
  void aLineMayNameTheSettingThatGivesItsColour() {
    var line = RelationKind.Line.of("#FFFF00").withStrokeColorSetting("/pairingColour");
    assertThat(line.strokeColorSetting()).isEqualTo("/pairingColour");
    assertThat(line.strokeColor()).as("the fallback").isEqualTo("#FFFF00");
    assertThat(new RelationKind("gmti.pairing", "GMTI Pairing", line, true).line()).isEqualTo(line);
  }

  @Test
  void theOlderFormsHaveNone() {
    assertThat(RelationKind.Line.of("#FFFF00").strokeColorSetting()).isNull();
    assertThat(new RelationKind.Line("#FFFF00", 2, Style.Dash.DOT, Style.Arrowhead.END).strokeColorSetting()).isNull();
  }

  @Test
  void theSettingIsAJsonPointer() {
    var line = RelationKind.Line.of("#FFFF00");
    assertThatThrownBy(() -> line.withStrokeColorSetting("pairingColour")).hasMessageContaining("JSON Pointer");
    assertThatThrownBy(() -> line.withStrokeColorSetting("/")).hasMessageContaining("JSON Pointer");
    assertThatThrownBy(() -> line.withStrokeColorSetting("/a b")).hasMessageContaining("JSON Pointer");
    assertThat(line.withStrokeColorSetting("/colours/pairing").strokeColorSetting()).isEqualTo("/colours/pairing");
  }
}
