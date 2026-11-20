package dev.emcc.plugins.nvg.mapping;

import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.util.Locale;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * NVG's {@code symbol} ({@code <scheme>:<code>}) and the model's {@link Symbol} (brief, section 3;
 * owner Q3 and NV3):
 *
 * <ul>
 *   <li>{@code app6b:} with 15 characters: APP-6B;
 *   <li>{@code app6d:}, {@code app06:} or {@code app6e:} with a code of digits, decided by the code's
 *       version digits: 20 digits of version 10 to 12 are APP-6D; 20 or 30 digits of version 13 or 14
 *       are APP-6E; 30 digits of version 10 to 12 whose last ten are zeros are APP-6D, its first 20
 *       (ANET writes APP-6D so, NV3) <b>[spec check of the scheme names]</b>;
 *   <li>anything else ({@code 2525b:}, {@code app6a:}, {@code unknown:unknown}, ...): APP-6D's unknown
 *       symbol, the code kept.
 * </ul>
 *
 * <p>Written as {@code app6b:}, {@code app6d:} or {@code app6e:} (owner, Q3), unless the object
 * keeps the text it came with and its symbol is still the one read from it: then that text goes
 * back as it came.
 */
final class Symbols {

  /** APP-6D's unknown symbol (brief, section 3). */
  static final String UNKNOWN_SIDC = "10000000000000000000";

  /** NVG's default symbol. */
  static final String NVG_UNKNOWN = "unknown:unknown";

  private static final Pattern APP6B = Pattern.compile("[A-Z0-9*-]{15}");
  private static final Pattern DIGITS = Pattern.compile("[0-9]+");

  private Symbols() {}

  /**
   * A read symbol.
   *
   * @param symbol the model's symbol
   * @param mapped whether the scheme and code were understood (else the unknown symbol)
   * @param kept the text to keep in {@code extensions.nvg.symbol}: the original when it was not mapped,
   *     or when it is not the text this plugin would write for the symbol; else {@code null}
   */
  record In(Symbol symbol, boolean mapped, @Nullable String kept) {}

  static Symbol unknown() {
    return new Symbol(SymbolStandard.APP_6D, UNKNOWN_SIDC, null);
  }

  static In read(@Nullable String text) {
    String original = text == null ? NVG_UNKNOWN : text.strip();
    Symbol symbol = parse(original);
    if (symbol == null) {
      return new In(unknown(), false, original.equals(NVG_UNKNOWN) ? null : original);
    }
    return new In(symbol, true, write(symbol, null).equals(original) ? null : original);
  }

  /** The symbol a text names, or {@code null} for a scheme or code this plugin does not map. */
  static @Nullable Symbol parse(String text) {
    int colon = text.indexOf(':');
    if (colon <= 0) {
      return null;
    }
    String scheme = text.substring(0, colon).toLowerCase(Locale.ROOT);
    String code = text.substring(colon + 1).strip();
    switch (scheme) {
      case "app6b" -> {
        String upper = code.toUpperCase(Locale.ROOT);
        return APP6B.matcher(upper).matches() ? new Symbol(SymbolStandard.APP_6B, upper, null) : null;
      }
      case "app6d", "app06", "app6e" -> {
        if (!DIGITS.matcher(code).matches() || (code.length() != 20 && code.length() != 30)) {
          return null;
        }
        int version = Integer.parseInt(code.substring(0, 2));
        if (version >= 10 && version <= 12) {
          if (code.length() == 20) {
            return new Symbol(SymbolStandard.APP_6D, code, null);
          }
          return code.endsWith("0000000000") ? new Symbol(SymbolStandard.APP_6D, code.substring(0, 20), null) : null;
        }
        if (version == 13 || version == 14) {
          return new Symbol(SymbolStandard.APP_6E, code, null);
        }
        return null;
      }
      default -> {
        return null;
      }
    }
  }

  /** The text to write for {@code symbol}; {@code kept} when it still names this symbol. */
  static String write(Symbol symbol, @Nullable String kept) {
    if (kept != null) {
      Symbol fromKept = parse(kept);
      Symbol plain = new Symbol(symbol.standard(), symbol.sidc(), null);
      if (fromKept != null ? fromKept.equals(plain) : plain.equals(unknown())) {
        return kept;
      }
    }
    return switch (symbol.standard()) {
      case APP_6B -> "app6b:" + symbol.sidc();
      case APP_6D -> "app6d:" + symbol.sidc();
      case APP_6E -> "app6e:" + (symbol.sidc().length() == 20 ? symbol.sidc() + "0000000000" : symbol.sidc());
      case VESSEL -> vessel(symbol);
    };
  }

  /**
   * A vessel (ADR-0047) as APP-6D's sea surface symbol of its identity (owner, Q4; N7): {@code 10},
   * context {@code 0}, the identity, {@code 30}, {@code 0}, {@code 0}, {@code 00}, {@code 140000},
   * {@code 0000} <b>[spec check]</b>.
   */
  static String vessel(Symbol symbol) {
    return "app6d:100" + symbol.vesselIdentity() + "3000001400000000";
  }

  /** Whether a symbol is an APP-6 tactical graphic or a METOC graphic (drawn from control points). */
  static boolean isGraphic(Symbol symbol) {
    return switch (symbol.standard()) {
      case APP_6B -> symbol.sidc().charAt(0) == 'G' || symbol.sidc().charAt(0) == 'W';
      case APP_6D, APP_6E -> {
        String set = symbol.sidc().substring(4, 6);
        yield set.equals("25") || set.equals("45") || set.equals("46") || set.equals("47");
      }
      case VESSEL -> false;
    };
  }

  /** A symbol with the speed (km/h → m/s) and the course of a {@code point}. */
  static Symbol withMotion(Symbol symbol, @Nullable Double speedKmh, @Nullable Double course) {
    if (speedKmh == null && course == null) {
      return symbol;
    }
    Modifiers.Builder m = Modifiers.builder();
    if (speedKmh != null) {
      m.speed(speedKmh / 3.6);
    }
    if (course != null) {
      m.direction(Values.bearing(course));
    }
    return new Symbol(symbol.standard(), symbol.sidc(), m.build());
  }
}
