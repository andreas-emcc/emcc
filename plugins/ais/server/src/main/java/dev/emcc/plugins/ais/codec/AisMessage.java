package dev.emcc.plugins.ais.codec;

import org.jspecify.annotations.Nullable;

/** A decoded AIS message of one of the types the plugin uses. Immutable. */
public sealed interface AisMessage {

  /** The ship's MMSI, 1 to 999 999 999. */
  int mmsi();

  /** What the ship reports about itself in this message. */
  AisStatic statics();

  /**
   * A message with a valid position (types 1, 2, 3, 18, 19). A value that is not available or out of
   * range is {@code null}; the position itself is always valid.
   *
   * @param lon degrees east, -180 to 180
   * @param lat degrees north, -90 to 90
   * @param course degrees, 0 to under 360
   * @param speedKnots 0 or more
   * @param heading degrees, 0 to 359
   * @param navStatus 0 to 14
   * @param statics at least the class; type 19 also brings name, type and size
   */
  record Position(
      int mmsi, double lon, double lat, @Nullable Double course, @Nullable Double speedKnots, @Nullable Integer heading,
      @Nullable Integer navStatus, AisStatic statics) implements AisMessage {

    private static final double METRES_PER_SECOND_PER_KNOT = 0.514444;

    /** The speed over ground in metres per second. */
    public @Nullable Double speedMetresPerSecond() {
      return speedKnots == null ? null : speedKnots * METRES_PER_SECOND_PER_KNOT;
    }
  }

  /** Static data without a position (types 5 and 24). */
  record StaticReport(int mmsi, AisStatic statics) implements AisMessage {}
}
