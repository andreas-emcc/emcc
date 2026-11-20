package dev.emcc.plugins.cot.codec;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The conversion between a MIL-STD-2525C symbol (the 15-character code ATAK and WinTAK send) and an APP-6D or APP-6E symbol (the 20
 * digits the model holds), brief function 29.
 *
 * <p>The symbol itself (the dimension and the function, positions 3 and 5 to 10) comes from {@link Sidc2525cTable}, which is derived
 * from mil-sym-ts 2.10.9 (Apache-2.0): symbol set, entity and the two sectors. The positions the table stars are fixed tables here:
 * the identity (2nd character) with the context, the status (4th), headquarters, task force and dummy (11th), the echelon (12th) and
 * the mobility (11th and 12th). Their digits are from APP-6(E)(2) Annex A (tables A-2 and A-6 to A-8) and agree with mil-sym-ts's
 * {@code C2DLookup.getDCode} and milsymbol 3.0.4's letter-code reading. The country code (13th and 14th) and the order of battle (15th)
 * have no equivalent and are left out.
 *
 * <pre>{@code
 * Sidc2525c.toApp6d("SFG*UCI---AF***")      // "10031002161211000000": friend, present, HQ, battalion, infantry
 * Sidc2525c.toSidc2525c("10031002161211000000") // "SFG*UCI---AF***"
 * }</pre>
 *
 * <p>ATAK's plain unit {@code S*G*U-----} is a land unit with no function (entity {@code 000000}) and its echelon, not the table's
 * {@code 110000} Command and Control (owner, ME A); the other way round entity {@code 000000} with an echelon goes out as {@code U-----},
 * without one as {@code ------}, and {@code 110000} goes out as {@code U-----}.
 */
final class Sidc2525c {

  /** A row of the table. */
  private record Row(String version, String set, String entity, String sector1, String sector2) {}

  private static final String PLAIN_UNIT = "S*G*U-----*****";
  private static final String EMPTY_LAND_FRAME = "S*G*------*****";

  /** Rows by 2525C basic id. */
  private static final Map<String, Row> BY_BASIC = new LinkedHashMap<>();
  /** The first basic id (in the table's order) of each (symbol set, entity, sector 1, sector 2). */
  private static final Map<String, String> BY_KEY = new HashMap<>();

  static {
    for (String chunk : Sidc2525cTable.CHUNKS) {
      for (String line : chunk.split("\n")) {
        String[] p = line.trim().split(" ");
        if (p.length != 6) {
          continue;
        }
        BY_BASIC.put(p[0], new Row(p[1], p[2], p[3], p[4], p[5]));
        BY_KEY.putIfAbsent(p[2] + p[3] + p[4] + p[5], p[0]);
      }
    }
    if (BY_BASIC.size() != Sidc2525cTable.COUNT) {
      throw new IllegalStateException("Sidc2525cTable: " + BY_BASIC.size() + " rows read, " + Sidc2525cTable.COUNT + " expected");
    }
    // The table has an empty frame for the dimensions Z, A, P and G but not for sea surface (symbol set 30) and subsurface (35): ours,
    // so that a mobility or an echelon on them has a symbol (criterion 40: SFU*------NS***).
    for (String[] frame : new String[][] {{"S*S*------*****", "30"}, {"S*U*------*****", "35"}}) {
      BY_BASIC.put(frame[0], new Row("11", frame[1], "000000", "00", "00"));
      BY_KEY.putIfAbsent(frame[1] + "000000" + "0000", frame[0]);
    }
  }

  /** 2525C's 2nd character to the context (0 reality, 1 exercise) and the identity digit; the reality letters, then the exercise ones. */
  private static final String REALITY = "PUAFNSH";
  private static final String EXERCISE = "GWMDLJK";

  /** The 4th character to the status digit; {@code *}, {@code -}, {@code P} and every other character count as present. */
  private static final String STATUS = "PACDXF";

  /** The 11th character to the headquarters, task force and dummy digit: A to G. */
  private static final String HQTFD_LETTERS = "ABCDEFG";
  private static final String HQTFD_DIGITS = "2637415";

  /** The echelon: the 12th character A to N and the two-digit amplifier. */
  private static final String ECHELON_LETTERS = "ABCDEFGHIJKLMN";
  private static final List<String> ECHELON_DIGITS = List.of("11", "12", "13", "14", "15", "16", "17", "18", "21", "22", "23", "24", "25", "26");

  /** The mobility: the 11th and 12th characters and the two-digit amplifier. */
  private static final List<String> MOBILITY_LETTERS = List.of("MO", "MP", "MQ", "MR", "MS", "MT", "MW", "MU", "MV", "MX", "MY", "NS", "NL");
  private static final List<String> MOBILITY_DIGITS = List.of("31", "32", "33", "34", "35", "36", "37", "41", "42", "51", "52", "61", "62");

  private Sidc2525c() {}

  /** The number of rows, for tests: the table's and the two frames of the static initialiser. */
  static int rows() {
    return BY_BASIC.size();
  }

  /** The basic ids of the table, in its order, for tests. */
  static Iterable<String> basicIds() {
    return BY_BASIC.keySet();
  }

  /** The table's row for a basic id as {@code version set entity sector1 sector2}, for tests. */
  static @Nullable String row(String basic) {
    Row r = BY_BASIC.get(basic);
    return r == null ? null : r.version + " " + r.set + " " + r.entity + " " + r.sector1 + " " + r.sector2;
  }

  /** The first basic id (in the table's order) of a symbol set, entity and the two sectors, for tests. */
  static @Nullable String basicOf(String set, String entity, String sector1, String sector2) {
    return BY_KEY.get(set + entity + sector1 + sector2);
  }

  // ---------------------------------------------------------------- 2525C to APP-6D

  /**
   * The APP-6D symbol (20 digits) for a 2525C code, or {@code null} if there is none: not 15 characters, not a symbol ({@code S}), an
   * identity or status character 2525C does not have, or a function the table lacks and no parent of it, nor the dimension's empty
   * frame, is in it. A function the table lacks gives its parent: the last function character that is not a dash is dropped until a
   * row is found.
   */
  static @Nullable String toApp6d(String code) {
    String sidc = code.toUpperCase(java.util.Locale.ROOT);
    if (sidc.length() != 15 || sidc.charAt(0) != 'S') {
      return null;
    }
    for (int i = 0; i < sidc.length(); i++) {
      char c = sidc.charAt(i);
      if (!(c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '*' || c == '-')) {
        return null;
      }
    }
    int reality = REALITY.indexOf(sidc.charAt(1));
    int exercise = EXERCISE.indexOf(sidc.charAt(1));
    if (reality < 0 && exercise < 0) {
      return null;
    }
    int context = reality >= 0 ? 0 : 1;
    int identity = reality >= 0 ? reality : exercise;
    char statusChar = sidc.charAt(3);
    int status = Math.max(0, STATUS.indexOf(statusChar)); // any other character counts as present, as mil-sym-ts's getDCode has it (WinTAK writes SFSSCL---------)
    char dimension = sidc.charAt(2);
    String function = sidc.substring(4, 10);
    Row row = null;
    while (row == null) {
      row = BY_BASIC.get("S*" + dimension + "*" + function + "*****");
      if (row != null) {
        break;
      }
      int last = lastFunctionCharacter(function);
      if (last < 0) {
        break;
      }
      function = function.substring(0, last) + "-" + function.substring(last + 1);
    }
    if (row == null) {
      row = BY_BASIC.get("S*" + dimension + "*------*****");
      if (row == null) {
        return null;
      }
    }
    String entity = row.entity;
    if (PLAIN_UNIT.equals("S*" + dimension + "*" + function + "*****")) {
      entity = "000000"; // ATAK's plain unit: a unit with no function, not Command and Control (owner, ME A)
    }
    char c11 = sidc.charAt(10);
    char c12 = sidc.charAt(11);
    int hqtfd = 0;
    String amplifier = "00";
    int mobility = (c11 == 'M' || c11 == 'N') ? indexOf(MOBILITY_LETTERS, "" + c11 + c12) : -1;
    if (mobility >= 0) {
      amplifier = MOBILITY_DIGITS.get(mobility); // position 11 holds the mobility, so it holds no HQ, task force or dummy
    } else {
      int h = HQTFD_LETTERS.indexOf(c11);
      hqtfd = h < 0 ? 0 : HQTFD_DIGITS.charAt(h) - '0';
      int e = ECHELON_LETTERS.indexOf(c12);
      amplifier = e < 0 ? "00" : ECHELON_DIGITS.get(e);
    }
    return row.version + context + identity + row.set + status + hqtfd + amplifier + entity + row.sector1 + row.sector2;
  }

  private static int lastFunctionCharacter(String function) {
    for (int i = function.length() - 1; i >= 0; i--) {
      if (function.charAt(i) != '-') {
        return i;
      }
    }
    return -1;
  }

  private static int indexOf(List<String> values, String wanted) {
    return values.indexOf(wanted);
  }

  // ---------------------------------------------------------------- APP-6D to 2525C

  /**
   * The 2525C code (15 characters, ATAK's form: {@code *} for an empty position) for an APP-6D or APP-6E symbol (its first 20 digits),
   * or {@code null} if there is none: not 20 digits, an identity or status digit 2525C does not have, or no symbol set frame. The
   * symbol is found by (set, entity, sector 1, sector 2); not found, then with the sectors {@code 00}, then the entity's parent (its
   * last two, then four digits zeroed), then the symbol set's empty frame. Where several 2525C ids have the same key, the first in the
   * table's order.
   */
  static @Nullable String toSidc2525c(String sidc) {
    if (sidc.length() < 20) {
      return null;
    }
    for (int i = 0; i < 20; i++) {
      if (sidc.charAt(i) < '0' || sidc.charAt(i) > '9') {
        return null;
      }
    }
    int context = sidc.charAt(2) - '0';
    int identity = sidc.charAt(3) - '0';
    if (identity > 6) {
      return null;
    }
    boolean exercise = context == 1 || context == 5 || context == 6;
    char identityLetter = (exercise ? EXERCISE : REALITY).charAt(identity);
    int status = sidc.charAt(6) - '0';
    if (status > 5) {
      return null;
    }
    char statusLetter = status == 0 ? '*' : STATUS.charAt(status);
    String set = sidc.substring(4, 6);
    int hqtfd = sidc.charAt(7) - '0';
    String amplifier = sidc.substring(8, 10);
    String entity = sidc.substring(10, 16);
    String sector1 = sidc.substring(16, 18);
    String sector2 = sidc.substring(18, 20);
    String basic = basicFor(set, entity, sector1, sector2, amplifier);
    if (basic == null) {
      return null;
    }
    int mobility = indexOf(MOBILITY_DIGITS, amplifier);
    char c11 = '*';
    char c12 = '*';
    if (mobility >= 0) {
      c11 = MOBILITY_LETTERS.get(mobility).charAt(0);
      c12 = MOBILITY_LETTERS.get(mobility).charAt(1);
    } else {
      if (hqtfd >= 1 && hqtfd <= 7) {
        c11 = HQTFD_LETTERS.charAt(HQTFD_DIGITS.indexOf((char) ('0' + hqtfd)));
      }
      int e = indexOf(ECHELON_DIGITS, amplifier);
      if (e >= 0) {
        c12 = ECHELON_LETTERS.charAt(e);
      }
    }
    return "S" + identityLetter + basic.charAt(2) + statusLetter + basic.substring(4, 10) + c11 + c12 + "***";
  }

  private static @Nullable String basicFor(String set, String entity, String sector1, String sector2, String amplifier) {
    if (set.equals("10") && entity.equals("000000")) {
      // A land unit with no function (ME A): with an echelon it is ATAK's plain unit, without one the empty frame.
      return indexOf(ECHELON_DIGITS, amplifier) >= 0 ? PLAIN_UNIT : EMPTY_LAND_FRAME;
    }
    String[] keys = {
      set + entity + sector1 + sector2,
      set + entity + "0000",
      set + entity.substring(0, 4) + "00" + "0000",
      set + entity.substring(0, 2) + "0000" + "0000",
      set + "000000" + "0000"};
    for (String key : keys) {
      String basic = BY_KEY.get(key);
      if (basic != null) {
        return basic;
      }
    }
    return null;
  }
}
