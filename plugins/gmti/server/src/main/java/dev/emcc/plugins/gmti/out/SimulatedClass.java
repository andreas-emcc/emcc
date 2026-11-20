package dev.emcc.plugins.gmti.out;

import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import org.jspecify.annotations.Nullable;

/**
 * The simulated target class ({@code D32.10}, 128 to 255; AEDP Table 3-11) of a detected track, from
 * its symbol (reference 4.3; brief section 3): a ground vehicle is 129 tracked or 130 wheeled by its
 * entity, rotary wing 131, fixed wing 132, a surface vessel 134 (a {@code vessel} symbol too), a
 * dismount 137, anything else 255 unknown.
 */
final class SimulatedClass {

  static final int TRACKED = 129;
  static final int WHEELED = 130;
  static final int ROTARY_WING = 131;
  static final int FIXED_WING = 132;
  static final int MARITIME = 134;
  static final int PERSON = 137;
  static final int UNKNOWN = 255;

  private SimulatedClass() {}

  static int of(@Nullable Symbol symbol) {
    if (symbol == null) {
      return UNKNOWN;
    }
    if (symbol.standard() == SymbolStandard.VESSEL) {
      return MARITIME;
    }
    String s = symbol.sidc();
    if ((symbol.standard() == SymbolStandard.APP_6D || symbol.standard() == SymbolStandard.APP_6E) && s.length() >= 16 && s.chars().allMatch(Character::isDigit)) {
      String set = s.substring(4, 6);
      String amplifier = s.substring(8, 10);
      String entity = s.substring(10, 16);
      return switch (set) {
        case "01" -> entity.startsWith("1102") ? ROTARY_WING : entity.startsWith("1101") ? FIXED_WING : UNKNOWN;
        case "10" -> entity.startsWith("1205") || entity.startsWith("121102") ? TRACKED : WHEELED; // armour and mechanized are tracked
        case "15" -> amplifier.equals("33") || amplifier.equals("34") || entity.startsWith("1201") || entity.startsWith("1202") ? TRACKED : WHEELED;
        case "27" -> PERSON;  // dismounted individual (the ACA's R3)
        case "30" -> MARITIME;
        default -> UNKNOWN;
      };
    }
    if (symbol.standard() == SymbolStandard.APP_6B && s.length() >= 3) {
      char dimension = Character.toUpperCase(s.charAt(2));
      if (dimension == 'S') {
        return MARITIME;
      }
      if (dimension == 'G') {
        return s.length() >= 6 && s.substring(4, 6).equalsIgnoreCase("EV") ? WHEELED : UNKNOWN;
      }
    }
    return UNKNOWN;
  }
}
