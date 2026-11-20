package dev.emcc.plugins.cot.codec;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The conversion between 2525C and APP-6D (brief function 29; criteria 39 to 42). */
class Sidc2525cTest {

  /** The parts of an APP-6D code: version, context, identity, set, status, HQ/TF/dummy, amplifier, entity, sector 1, sector 2. */
  private record Parts(String version, char context, char identity, String set, char status, char hqtfd, String amplifier, String entity, String s1, String s2) {
    static Parts of(String code) {
      assertThat(code).as("converted").isNotNull().hasSize(20);
      return new Parts(code.substring(0, 2), code.charAt(2), code.charAt(3), code.substring(4, 6), code.charAt(6), code.charAt(7), code.substring(8, 10),
          code.substring(10, 16), code.substring(16, 18), code.substring(18, 20));
    }
  }

  private static Parts d(String c) {
    return Parts.of(Sidc2525c.toApp6d(c));
  }

  // ---------------------------------------------------------------- criterion 40: the positions the table stars

  @Test
  void headquartersAndEchelonAreTheDigitsOfTheStandard() {
    Parts p = d("SFG*UCI---AF***");
    assertThat(p.hqtfd()).as("headquarters").isEqualTo('2');
    assertThat(p.amplifier()).as("battalion").isEqualTo("16");
    assertThat(p.set()).isEqualTo("10");
    assertThat(p.entity()).as("infantry").isEqualTo("121100");
    assertThat(p.context()).isEqualTo('0');
    assertThat(p.identity()).isEqualTo('3');
    assertThat(p.status()).isEqualTo('0');
  }

  @Test
  void everyHeadquartersTaskForceAndDummyLetterGivesItsDigit() {
    // A HQ 2, B task force HQ 6, C feint/dummy HQ 3, D feint/dummy task force HQ 7, E task force 4, F feint/dummy 1, G feint/dummy task force 5
    Map<Character, Character> expected = Map.of('A', '2', 'B', '6', 'C', '3', 'D', '7', 'E', '4', 'F', '1', 'G', '5');
    expected.forEach((letter, digit) -> {
      String code = "SFG*UCI---" + letter + "E***";
      assertThat(d(code).hqtfd()).as(code).isEqualTo(digit);
      assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d(code))).as("back: " + code).isEqualTo(code);
    });
    assertThat(d("SFG*UCI---*E***").hqtfd()).as("none").isEqualTo('0');
    assertThat(d("SFG*UCI----E***").hqtfd()).as("a dash is none").isEqualTo('0');
    assertThat(d("SFG*UCI---HE***").hqtfd()).as("H (installation) has no equivalent and is left out").isEqualTo('0');
  }

  @Test
  void theEchelonsGoFromTeamToCommand() {
    String letters = "ABCDEFGHIJKLMN";
    String[] digits = {"11", "12", "13", "14", "15", "16", "17", "18", "21", "22", "23", "24", "25", "26"};
    for (int i = 0; i < letters.length(); i++) {
      String code = "SFG*UCI---*" + letters.charAt(i) + "***";
      assertThat(d(code).amplifier()).as(code).isEqualTo(digits[i]);
      assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d(code))).isEqualTo(code);
    }
    assertThat(d("SFG*UCI---*****").amplifier()).as("none").isEqualTo("00");
  }

  @Test
  void mobilityIsThe11thAnd12thCharactersAndWinsOverHeadquarters() {
    assertThat(d("SFG*E-----MQ***").amplifier()).isEqualTo("33");
    assertThat(d("SFG*E-----MQ***").set()).isEqualTo("15");
    assertThat(d("SFU*------NS***").amplifier()).isEqualTo("61");
    String[] letters = {"MO", "MP", "MQ", "MR", "MS", "MT", "MW", "MU", "MV", "MX", "MY", "NS", "NL"};
    String[] digits = {"31", "32", "33", "34", "35", "36", "37", "41", "42", "51", "52", "61", "62"};
    for (int i = 0; i < letters.length; i++) {
      String code = "SFG*E-----" + letters[i] + "***";
      assertThat(d(code).amplifier()).as(code).isEqualTo(digits[i]);
      assertThat(d(code).hqtfd()).as("position 11 holds the mobility").isEqualTo('0');
      assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d(code))).as("back " + code).isEqualTo(code);
    }
    // an HQ digit beside a mobility amplifier: the mobility wins, the HQ is left out (brief: "without an equivalent")
    String app6d = Sidc2525c.toApp6d("SFG*E-----MQ***");
    String withHq = app6d.substring(0, 7) + "2" + app6d.substring(8);
    assertThat(Sidc2525c.toSidc2525c(withHq)).isEqualTo("SFG*E-----MQ***");
  }

  @Test
  void contextAndIdentityFollowTheLetters() {
    String reality = "PUAFNSH";
    String exercise = "GWMDLJK";
    for (int i = 0; i < 7; i++) {
      Parts r = d("S" + reality.charAt(i) + "G*U-----*E***");
      assertThat(r.context()).isEqualTo('0');
      assertThat(r.identity()).isEqualTo((char) ('0' + i));
      Parts e = d("S" + exercise.charAt(i) + "G*U-----*E***");
      assertThat(e.context()).as("exercise " + exercise.charAt(i)).isEqualTo('1');
      assertThat(e.identity()).isEqualTo((char) ('0' + i));
      assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d("S" + reality.charAt(i) + "G*U-----*E***"))).isEqualTo("S" + reality.charAt(i) + "G*U-----*E***");
      assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d("S" + exercise.charAt(i) + "G*U-----*E***"))).isEqualTo("S" + exercise.charAt(i) + "G*U-----*E***");
    }
    assertThat(d("SDG*U-----*E***").context()).as("exercise friend").isEqualTo('1');
    assertThat(d("SDG*U-----*E***").identity()).isEqualTo('3');
    assertThat(d("SKG*U-----*E***").identity()).as("exercise hostile (faker)").isEqualTo('6');
    assertThat(Sidc2525c.toApp6d("SXG*U-----*E***")).as("X is no identity").isNull();
  }

  @Test
  void statusFollowsTheLettersAndPresentIsStarOrP() {
    Map<Character, Character> expected = Map.of('*', '0', 'P', '0', 'A', '1', 'C', '2', 'D', '3', 'X', '4', 'F', '5');
    expected.forEach((letter, digit) -> assertThat(d("SFG" + letter + "UCI---*E***").status()).as("status " + letter).isEqualTo(digit));
    assertThat(d("SFGZUCI---*E***").status()).as("any other character counts as present (WinTAK writes SFSSCL---------)").isEqualTo('0');
    // out: present goes out as * (as ATAK writes it)
    assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d("SFGPUCI---*E***"))).isEqualTo("SFG*UCI---*E***");
    assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d("SFGAUCI---*E***"))).isEqualTo("SFGAUCI---*E***");
  }

  @Test
  void contextsFiveAndSixGiveTheExerciseLettersAndEveryOtherTheRealityOnes() {
    String base = Sidc2525c.toApp6d("SFG*UCI---*E***"); // context 0, friend
    for (char context : new char[] {'0', '2', '3', '4', '7', '8', '9'}) {
      assertThat(Sidc2525c.toSidc2525c(base.substring(0, 2) + context + base.substring(3))).as("context " + context).isEqualTo("SFG*UCI---*E***");
    }
    for (char context : new char[] {'1', '5', '6'}) {
      assertThat(Sidc2525c.toSidc2525c(base.substring(0, 2) + context + base.substring(3))).as("context " + context).isEqualTo("SDG*UCI---*E***");
    }
    assertThat(Sidc2525c.toSidc2525c(base.substring(0, 3) + "7" + base.substring(4))).as("identity 7 has no 2525C letter").isNull();
  }

  // ---------------------------------------------------------------- the symbol and its fallbacks (criterion 39)

  @Test
  void aFunctionTheTableLacksGivesItsParentAndAnUnknownDimensionNothing() {
    // SFG*EWDLS-*****: a version 15 record, left out: it falls back to its parent
    assertThat(Sidc2525c.row("S*G*EWDLS-*****")).isNull();
    Parts p = d("SFG*EWDLS-*****");
    assertThat(p.set()).isEqualTo("15");
    String entity = null;
    for (String parent : new String[] {"S*G*EWDL--*****", "S*G*EWD---*****", "S*G*EW----*****", "S*G*E-----*****"}) {
      if (entity == null && Sidc2525c.row(parent) != null) {
        entity = Sidc2525c.row(parent).split(" ")[2];
      }
    }
    assertThat(p.entity()).as("the first parent the table has").isEqualTo(entity);
    assertThat(Sidc2525c.toApp6d("SFG*UCI--Z*****")).as("a made-up last character gives infantry (UCI)").isNotNull();
    assertThat(d("SFG*UCI--Z*****").entity()).isEqualTo("121100");
    assertThat(Sidc2525c.toApp6d("SFG*UCI---*E**")).as("14 characters").isNull();
    assertThat(Sidc2525c.toApp6d("GFG*UCI---*E***")).as("a graphic").isNull();
    assertThat(Sidc2525c.toApp6d("SFQ*UCI---*E***")).as("a dimension that does not exist: no frame either").isNull();
  }

  @Test
  void lowerCaseIsRead() {
    assertThat(Sidc2525c.toApp6d("sfg*uci---*e***")).isEqualTo(Sidc2525c.toApp6d("SFG*UCI---*E***")).isNotNull();
  }

  // ---------------------------------------------------------------- ME A: a plain unit

  @Test
  void aPlainUnitIsALandUnitWithNoFunctionAndItsEchelonNotCommandAndControl() {
    assertThat(Sidc2525c.row("S*G*U-----*****")).as("the table has it as Command and Control").contains("110000");
    Parts p = d("SFG*U-----*E***");
    assertThat(p.set()).isEqualTo("10");
    assertThat(p.entity()).isEqualTo("000000");
    assertThat(p.amplifier()).isEqualTo("15");
    assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d("SFG*U-----*E***"))).isEqualTo("SFG*U-----*E***");
    // without an echelon: entity 000000 goes out as the empty frame; a 110000 comes back as a plain unit
    assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d("SFG*U-----*****"))).isEqualTo("SFG*------*****");
    assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d("SFG*------*****"))).isEqualTo("SFG*------*****");
    String commandAndControl = "10031000001100000000";
    assertThat(Sidc2525c.toSidc2525c(commandAndControl)).as("110000 goes out as U-----").isEqualTo("SFG*U-----*****");
    assertThat(Sidc2525c.toSidc2525c("10031000151100000000")).as("110000 with an echelon").isEqualTo("SFG*U-----*E***");
  }

  // ---------------------------------------------------------------- criterion 41: out

  @Test
  void aBattalionHeadquartersGoesOutAsAtakWritesIt() {
    assertThat(Sidc2525c.toSidc2525c("10031002161211000000")).isEqualTo("SFG*UCI---AF***");
  }

  @Test
  void anArmourCodeGoesOutAsUcaNotUcat() {
    assertThat(Sidc2525c.toSidc2525c("10031000001205000000")).isEqualTo("SFG*UCA---*****");
  }

  @Test
  void aSectorNoTwentyFiveHundredCIdHasGoesOutWithItsParentsCode() {
    // infantry with sector 1 = 99 (no 2525C id has it): the code of infantry itself
    assertThat(Sidc2525c.toSidc2525c("10031000001211009900")).isEqualTo("SFG*UCI---*****");
    // an entity the table lacks: its parent (entity without its last two digits, then four)
    assertThat(Sidc2525c.toSidc2525c("10031000001211990000")).isEqualTo("SFG*UCI---*****");
    // a symbol set the table has nothing for gives nothing
    assertThat(Sidc2525c.toSidc2525c("10031099991211000000")).isNull();
  }

  @Test
  void aCodeThatIsNotTwentyDigitsGivesNothingAndAnAppSixEOneUsesItsFirstTwenty() {
    assertThat(Sidc2525c.toSidc2525c("1003100000121100000")).isNull();
    assertThat(Sidc2525c.toSidc2525c("1003100000121100000A")).isNull();
    assertThat(Sidc2525c.toSidc2525c("300310000012110000000000000000")).isEqualTo("SFG*UCI---*****");
  }

  // ---------------------------------------------------------------- criterion 42: the table, both ways

  /** The keys (symbol set, entity, sectors) that more than one 2525C id has, and the ids of each in the table's order. */
  private static Map<String, List<String>> keys() {
    Map<String, List<String>> keys = new HashMap<>();
    for (String basic : Sidc2525c.basicIds()) {
      String[] r = Sidc2525c.row(basic).split(" ");
      keys.computeIfAbsent(r[1] + r[2] + r[3] + r[4], k -> new ArrayList<>()).add(basic);
    }
    return keys;
  }

  @Test
  void theTableHasItsRowsAndNoneOfVersionFifteen() {
    assertThat(Sidc2525c.rows()).as("the table's rows and two empty frames").isEqualTo(Sidc2525cTable.COUNT + 2).isGreaterThan(700);
    for (String basic : Sidc2525c.basicIds()) {
      String version = Sidc2525c.row(basic).split(" ")[0];
      assertThat(version).as(basic).isIn("10", "11");
    }
  }

  @Test
  void theKeysThatSeveralIdsHaveTakeTheFirstInTheTablesOrder() {
    Map<String, List<String>> ambiguous = new HashMap<>();
    keys().forEach((k, v) -> {
      if (v.size() > 1) {
        ambiguous.put(k, v);
      }
    });
    assertThat(ambiguous).as("the symbols' ambiguous keys (the PDA's 14 include the other schemes)").hasSize(7);
    assertThat(ambiguous.get("101205000000")).startsWith("S*G*UCA---*****");
    assertThat(ambiguous.get("101205000051")).startsWith("S*G*UCAW--*****");
    assertThat(ambiguous.get("101301020019")).startsWith("S*G*UCDML-*****");
    assertThat(ambiguous.get("201200000000")).startsWith("S*G*IR----*****");
    ambiguous.forEach((key, ids) -> assertThat(Sidc2525c.basicOf(key.substring(0, 2), key.substring(2, 8), key.substring(8, 10), key.substring(10, 12))).isEqualTo(ids.get(0)));
  }

  @Test
  void everySymbolOfTheTableGoesToAppSixDAndBackToTheSameBasicIdExceptTheAmbiguousAndThePlainUnit() {
    Map<String, List<String>> keys = keys();
    int checked = 0;
    for (String basic : Sidc2525c.basicIds()) {
      String[] r = Sidc2525c.row(basic).split(" ");
      List<String> sameKey = keys.get(r[1] + r[2] + r[3] + r[4]);
      if (sameKey.size() > 1 && !sameKey.get(0).equals(basic)) {
        continue; // the key is the first one's
      }
      // an exercise hostile, planned, with an echelon where the dimension takes one: every position the table does not hold is kept
      String code = "S" + "K" + basic.charAt(2) + "A" + basic.substring(4, 10) + "**" + "***";
      String d = Sidc2525c.toApp6d(code);
      assertThat(d).as(code).isNotNull().hasSize(20);
      assertThat(d.substring(0, 2)).as("version " + basic).isEqualTo(r[0]);
      String back = Sidc2525c.toSidc2525c(d);
      if (basic.equals("S*G*U-----*****")) {
        assertThat(back).as("a plain unit without an echelon comes back empty").isEqualTo("SKGA------*****");
      } else {
        assertThat(back).as(basic).isEqualTo("SK" + basic.charAt(2) + "A" + basic.substring(4, 10) + "*****");
      }
      checked++;
    }
    assertThat(checked).isGreaterThan(700);
  }

  @Test
  void aPlainUnitWithAnEchelonAndCommandAndControlComeBackAsAPlainUnit() {
    String d = Sidc2525c.toApp6d("SFG*U-----*F***");
    assertThat(d.substring(10, 16)).isEqualTo("000000");
    assertThat(Sidc2525c.toSidc2525c(d)).isEqualTo("SFG*U-----*F***");
    String c2 = "10031000001100000000";
    assertThat(Sidc2525c.toSidc2525c(c2)).isEqualTo("SFG*U-----*****");
    assertThat(Sidc2525c.toSidc2525c(Sidc2525c.toApp6d(Sidc2525c.toSidc2525c(c2)))).isEqualTo("SFG*------*****");
  }
}
