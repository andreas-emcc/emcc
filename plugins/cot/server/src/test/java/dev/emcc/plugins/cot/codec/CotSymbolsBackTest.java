package dev.emcc.plugins.cot.codec;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** A symbol to a CoT type (brief function 17): the APP-6B table in reverse, and the closed table for APP-6D and APP-6E. */
class CotSymbolsBackTest {

  private static String type(SymbolStandard standard, String sidc) {
    return CotSymbols.cotType(new Symbol(standard, sidc, null));
  }

  @Test
  void anApp6bSymbolGivesItsCotType() {
    assertThat(type(SymbolStandard.APP_6B, "SFGPUCI--------")).isEqualTo("a-f-G-U-C-I");
    assertThat(type(SymbolStandard.APP_6B, "SHAPMFQ--------")).isEqualTo("a-h-A-M-F-Q");
    assertThat(type(SymbolStandard.APP_6B, "SUGP-----------")).isEqualTo("a-u-G");
    assertThat(type(SymbolStandard.APP_6B, "SNSPCL---------")).isEqualTo("a-n-S-C-L");
  }

  @Test
  void everyFunctionOfTheTableMakesTheSameTypeBackForEveryAffiliation() {
    int checked = 0;
    for (Map.Entry<Character, Set<String>> dimension : CotSymbols.functions().entrySet()) {
      for (String function : dimension.getValue()) {
        for (char affiliation : "pufanshjk".toCharArray()) {
          StringBuilder type = new StringBuilder("a-").append(affiliation).append('-').append(dimension.getKey());
          function.chars().forEach(c -> type.append('-').append((char) c));
          String sidc = CotSymbols.sidc(type.toString());
          assertThat(type(SymbolStandard.APP_6B, sidc)).as(sidc).isEqualTo(type.toString());
          checked++;
        }
      }
    }
    assertThat(checked).isGreaterThan(1000);
  }

  @Test
  void aFunctionTheTableLacksFallsBackToItsParentAndThenToTheDimension() {
    assertThat(type(SymbolStandard.APP_6B, "SFGPUCIZ-------")).as("a longer function: the known prefix").isEqualTo("a-f-G-U-C-I");
    assertThat(type(SymbolStandard.APP_6B, "SFGPUCQQQQ-----")).isEqualTo("a-f-G-U-C");
    assertThat(type(SymbolStandard.APP_6B, "SFGPQQQ--------")).as("nothing known: the dimension's generic symbol").isEqualTo("a-f-G");
  }

  @Test
  void whatIsNotAWarfightingSymbolHasNoCotType() {
    assertThat(type(SymbolStandard.APP_6B, "GFGPGPP--------")).as("a tactical graphic").isNull();
    assertThat(type(SymbolStandard.APP_6B, "WAS-WSVP-------")).as("weather").isNull();
    assertThat(type(SymbolStandard.APP_6B, "SFXPUCI--------")).as("a dimension CoT has no letter for").isNull();
  }

  @Test
  void anApp6dSymbolGivesItsCotTypeThroughTheClosedTable() {
    assertThat(type(SymbolStandard.APP_6D, "10031000001211000000")).as("land unit, infantry, friend").isEqualTo("a-f-G-U-C-I");
    assertThat(type(SymbolStandard.APP_6D, "10061000001211000000")).as("hostile").isEqualTo("a-h-G-U-C-I");
    assertThat(type(SymbolStandard.APP_6D, "10011000001211000000")).as("unknown").isEqualTo("a-u-G-U-C-I");
    assertThat(type(SymbolStandard.APP_6D, "10041000001211000000")).as("neutral").isEqualTo("a-n-G-U-C-I");
    assertThat(type(SymbolStandard.APP_6D, "10031500001201000000")).as("land equipment, armoured vehicle").isEqualTo("a-f-G-E-V-A");
    assertThat(type(SymbolStandard.APP_6D, "10033000001200000000")).as("sea surface, combatant").isEqualTo("a-f-S-C");
    assertThat(type(SymbolStandard.APP_6D, "10030100001100000000")).as("air, military").isEqualTo("a-f-A-M");
  }

  @Test
  void anApp6dSymbolWithASubtypeTheTableLacksFallsBackToItsTypeThenItsEntityThenTheDimension() {
    // 121101 (a subtype of infantry) is not a row: its type 121100 is
    assertThat(type(SymbolStandard.APP_6D, "10031000001211010000")).isEqualTo("a-f-G-U-C-I");
    // 129900 is no row, and neither is 120000: the land unit's generic symbol
    assertThat(type(SymbolStandard.APP_6D, "10031000001299000000")).isEqualTo("a-f-G");
    assertThat(type(SymbolStandard.APP_6D, "10031000000000000000")).isEqualTo("a-f-G");
  }

  @Test
  void anApp6eSymbolIsReadByItsFirstTwentyDigits() {
    assertThat(type(SymbolStandard.APP_6E, "13031000001211000000" + "0000000001")).isEqualTo("a-f-G-U-C-I");
  }

  @Test
  void aSymbolSetWithNoCotDimensionHasNoType() {
    assertThat(type(SymbolStandard.APP_6D, "10032500001401000000")).as("control measures").isNull();
    assertThat(type(SymbolStandard.APP_6D, "10034000001100000000")).as("activities").isNull();
    assertThat(type(SymbolStandard.APP_6D, "10034500001100000000")).as("atmospheric").isNull();
    assertThat(type(SymbolStandard.APP_6D, "10036000001100000000")).as("cyberspace").isNull();
  }

  @Test
  void theNumericTableIsClosedAndEveryRowIsAKnownFunction() {
    assertThat(CotSymbolsNumeric.COUNT).isGreaterThan(100);
    for (String key : new String[] {"10121100", "10120500", "15120100", "30120000", "35110100", "01110000"}) {
      String row = CotSymbolsNumeric.of(key);
      assertThat(row).as(key).isNotNull();
      char dimension = row.charAt(0);
      String function = row.substring(1);
      assertThat(CotSymbols.functions().get(dimension)).as(key + " " + row).contains(function);
    }
    assertThat(CotSymbolsNumeric.of("10999999")).isNull();
  }
}
