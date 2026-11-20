package dev.emcc.sdk.model;

/**
 * The APP-6 edition of a symbol code, or (SDK 1.4.0, ADR-0047) emc2's own vessel symbols.
 *
 * <pre>{@code
 * SymbolStandard.fromJson("APP-6D") == SymbolStandard.APP_6D
 * }</pre>
 */
public enum SymbolStandard {
  APP_6B("APP-6B"),
  APP_6D("APP-6D"),
  APP_6E("APP-6E"),
  /** SDK 1.4.0: a vessel symbol, a 4-digit code (see {@link Symbol#vessel}). */
  VESSEL("vessel");

  private final String json;

  SymbolStandard(String json) {
    this.json = json;
  }

  /** The JSON value, e.g. {@code "APP-6D"}. */
  public String json() {
    return json;
  }

  public static SymbolStandard fromJson(String value) {
    for (SymbolStandard s : values()) {
      if (s.json.equals(value)) {
        return s;
      }
    }
    throw new IllegalArgumentException("unknown symbol standard: " + value);
  }
}
