package dev.emcc.plugins.simulator;

import org.jspecify.annotations.Nullable;

/**
 * The speed units a user may choose (brief function 8, open question 18). Display only: routes store
 * m/s. A speed computed from a typed time is rounded to a whole unit of the unit the user had chosen
 * when typing it (Q13), which travels with the time.
 */
enum SpeedUnit {
  MPS("mps", 1),
  KMH("kmh", 1000.0 / 3600),
  KNOT("kn", 1852.0 / 3600),
  MPH("mph", 1609.344 / 3600);

  private final String json;
  private final double metresPerSecond;

  SpeedUnit(String json, double metresPerSecond) {
    this.json = json;
    this.metresPerSecond = metresPerSecond;
  }

  String json() {
    return json;
  }

  /** {@code speed} in m/s, rounded to a whole number of this unit. */
  double round(double speed) {
    return Math.round(speed / metresPerSecond) * metresPerSecond;
  }

  static @Nullable SpeedUnit fromJson(String value) {
    for (SpeedUnit u : values()) {
      if (u.json.equals(value)) {
        return u;
      }
    }
    return null;
  }
}
