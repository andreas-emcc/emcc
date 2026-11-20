package dev.emcc.ecore.live;

import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;

/**
 * The four identities a cluster counts (SDK v1 {@code Cluster.byIdentity}): friend with assumed
 * friend; hostile with suspect, joker and faker; neutral; unknown with pending, and objects without
 * a symbol. Read from the SIDC's standard identity: digit 4 of an APP-6D or APP-6E SIDC, the
 * affiliation letter (2nd character) of an APP-6B SIDC.
 */
enum Identity {
  FRIEND("friend"),
  HOSTILE("hostile"),
  NEUTRAL("neutral"),
  UNKNOWN("unknown");

  final String json;

  Identity(String json) {
    this.json = json;
  }

  static Identity of(MapObject object) {
    Symbol symbol = object.content().symbol();
    if (symbol == null) {
      return UNKNOWN;
    }
    String sidc = symbol.sidc();
    if (symbol.standard() == SymbolStandard.APP_6B) {
      return sidc.length() < 2 ? UNKNOWN : switch (sidc.charAt(1)) {
        case 'F', 'A', 'D', 'M' -> FRIEND; // with the exercise forms
        case 'H', 'S', 'J', 'K' -> HOSTILE;
        case 'N', 'L' -> NEUTRAL;
        default -> UNKNOWN;
      };
    }
    return sidc.length() < 4 ? UNKNOWN : switch (sidc.charAt(3)) {
      case '2', '3' -> FRIEND; // assumed friend, friend
      case '5', '6' -> HOSTILE; // suspect or joker, hostile or faker
      case '4' -> NEUTRAL;
      default -> UNKNOWN; // pending, unknown
    };
  }
}
