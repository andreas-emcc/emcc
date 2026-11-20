package dev.emcc.plugins.cot.codec;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class CotSymbolsTest {

  /** The model's pattern for an APP-6B SIDC (model/schemas/map-object.schema.json). */
  private static final Pattern APP_6B = Pattern.compile("^[A-Z0-9*-]{15}$");

  @Test
  void anAtomIsAffiliationDimensionAndFunction() {
    assertThat(CotSymbols.sidc("a-f-G-U-C-I")).isEqualTo("SFGPUCI--------"); // the example in model/examples
    assertThat(CotSymbols.sidc("a-h-G-U-C-A")).isEqualTo("SHGPUCA--------");
    assertThat(CotSymbols.sidc("a-n-A-M-F-F")).isEqualTo("SNAPMFF--------");
    assertThat(CotSymbols.sidc("a-u-S-C-L")).isEqualTo("SUSPCL---------");
    assertThat(CotSymbols.sidc("a-f-G-E-V-C")).isEqualTo("SFGPEVC--------");
  }

  @Test
  void everyAffiliationHasItsLetter() {
    String expected = "PUAFNSHJK";
    String letters = "puafnshjk";
    for (int i = 0; i < letters.length(); i++) {
      assertThat(CotSymbols.sidc("a-" + letters.charAt(i) + "-G-U-C-I")).isEqualTo("S" + expected.charAt(i) + "GPUCI--------");
    }
    assertThat(CotSymbols.sidc("a-o-G-U-C-I")).as("none specified: unknown").isEqualTo("SUGPUCI--------");
  }

  @Test
  void aFunctionTheTableLacksFallsBackToItsParentThenToTheGenericSymbol() {
    assertThat(CotSymbols.sidc("a-f-G-U-C-I-Z-Z")).as("a parent is known").isEqualTo("SFGPUCI--------");
    assertThat(CotSymbols.sidc("a-f-G-U-C-I-M-X")).isEqualTo("SFGPUCI--------");
    assertThat(CotSymbols.sidc("a-f-G-Q-Q-Q")).as("nothing is known").isEqualTo("SFGP-----------");
    assertThat(CotSymbols.sidc("a-f-G")).isEqualTo("SFGP-----------");
    assertThat(CotSymbols.sidc("a-h-A")).isEqualTo("SHAP-----------");
    assertThat(CotSymbols.sidc("a-f-S")).isEqualTo("SFSP-----------");
    assertThat(CotSymbols.sidc("a-f-U")).isEqualTo("SFUP-----------");
    assertThat(CotSymbols.sidc("a-f-P")).isEqualTo("SFPP-----------");
    assertThat(CotSymbols.sidc("a-f-F")).isEqualTo("SFFP-----------");
  }

  @Test
  void aMissingOrUnknownDimensionIsTheUnknownDimension() {
    assertThat(CotSymbols.sidc("a-f")).isEqualTo("SFZP-----------");
    assertThat(CotSymbols.sidc("a-f-X-U-C-I")).isEqualTo("SFZP-----------");
    assertThat(CotSymbols.sidc("a")).isEqualTo("SUZP-----------");
  }

  @Test
  void aFunctionStopsAtAPartThatIsNotOneLetter() {
    assertThat(CotSymbols.sidc("a-f-G-U-C-I-xyz-A")).isEqualTo("SFGPUCI--------");
    assertThat(CotSymbols.sidc("a-f-G-U-C-1")).isEqualTo("SFGPUC---------");
  }

  @Test
  void theCaseOfTheLettersDoesNotMatter() {
    assertThat(CotSymbols.sidc("a-F-g-u-c-i")).isEqualTo("SFGPUCI--------");
  }

  @Test
  void everySidcTheTableCanMakeFitsTheModelsPattern() {
    int checked = 0;
    for (var dimension : CotSymbols.functions().entrySet()) {
      for (String function : dimension.getValue()) {
        String sidc = CotSymbols.sidc("a-f-" + dimension.getKey() + "-" + String.join("-", function.split("")));
        assertThat(sidc).matches(APP_6B);
        assertThat(sidc.substring(4, 4 + function.length())).as(function + " is known, so it is used as it is").isEqualTo(function);
        checked++;
      }
    }
    assertThat(checked).isGreaterThan(200);
  }

  @Test
  void theTableIsClosed() {
    assertThat(CotSymbols.functions().keySet()).containsExactlyInAnyOrder('G', 'A', 'S', 'U', 'P', 'F');
    CotSymbols.functions().values().forEach(set -> set.forEach(f -> assertThat(f).matches("[A-Z]{1,3}")));
  }

  @Test
  void theGenericPointFitsTheModelsPattern() {
    assertThat(CotSymbols.POINT_SIDC).matches(APP_6B);
  }
}
