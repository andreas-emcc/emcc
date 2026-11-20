package dev.emcc.plugins.ais;

import org.jspecify.annotations.Nullable;

/** How a link draws its ships, as its {@code symbolType} setting names it (brief section 10; T-140, ADR-0047 point 7). */
public enum SymbolType {
  /** emc2's vessel symbols: a hull filled by ship-type group ({@code symbology}, SDK 1.4.0). */
  VESSEL("vessel"),
  /** APP-6D's sea surface symbols: what links stored before M5 keep. */
  APP6("app6");

  private final String json;

  SymbolType(String json) {
    this.json = json;
  }

  /** As in the settings: {@code vessel} or {@code app6}. */
  public String json() {
    return json;
  }

  /** The type with this setting value, or {@code null}. */
  public static @Nullable SymbolType fromJson(String value) {
    for (SymbolType t : values()) {
      if (t.json.equals(value)) {
        return t;
      }
    }
    return null;
  }
}
