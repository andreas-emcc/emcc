package dev.emcc.sdk.model;

import java.util.List;

/**
 * Data model 1.6.0 (CR-0041 part D; T-182, owner Q58 A): the display classes, a fixed list, for a
 * map object's {@link MapObjectContent#displayClass()}. The map view hides an object of a class
 * while the user's display switch for it ("Dwell areas", "Sensor coverage") is off.
 *
 * <pre>{@code
 * content.withDisplayClass(DisplayClass.DWELL_AREA)   // gmti's dwell area
 * }</pre>
 */
public final class DisplayClass {

  /** A sensor's dwell area, e.g. `gmti`'s, shown by the switch "Dwell areas". */
  public static final String DWELL_AREA = "dwell-area";

  /** A sensor's coverage or job area, shown by the switch "Sensor coverage". */
  public static final String SENSOR_COVERAGE = "sensor-coverage";

  /** Every class, in the display window's order. */
  public static final List<String> ALL = List.of(DWELL_AREA, SENSOR_COVERAGE);

  private DisplayClass() {}
}
