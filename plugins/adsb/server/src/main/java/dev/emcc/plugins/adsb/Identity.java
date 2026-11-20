package dev.emcc.plugins.adsb;

/**
 * The APP-6D standard identity of a link's aircraft, from its setting. The digit is the fourth
 * position of the SIDC.
 */
public enum Identity {
  PENDING("pending", '0'),
  UNKNOWN("unknown", '1'),
  ASSUMED_FRIEND("assumed-friend", '2'),
  FRIEND("friend", '3'),
  NEUTRAL("neutral", '4'),
  SUSPECT("suspect", '5'),
  HOSTILE("hostile", '6');

  /** The setting's value, as the settings schema names it. */
  private final String json;
  private final char digit;

  Identity(String json, char digit) {
    this.json = json;
    this.digit = digit;
  }

  /** The value as the settings give it, e.g. {@code assumed-friend}. */
  String json() {
    return json;
  }

  /**
   * The SIDC of a civilian fixed-wing aircraft with this identity: APP-6D version, reality context,
   * symbol set 01 (air), status present, no headquarters, entity 120100, no modifiers.
   */
  String sidc() {
    return "10" + "0" + digit + "01" + "0" + "0" + "00" + "120100" + "0000";
  }

  /**
   * The identity a setting names.
   *
   * @throws IllegalArgumentException for a value the settings schema does not allow
   */
  static Identity of(String json) {
    for (Identity identity : values()) {
      if (identity.json.equals(json)) {
        return identity;
      }
    }
    throw new IllegalArgumentException("unknown standardIdentity " + json);
  }
}
