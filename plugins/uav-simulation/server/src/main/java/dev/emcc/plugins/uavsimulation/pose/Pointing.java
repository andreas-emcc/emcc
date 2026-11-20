package dev.emcc.plugins.uavsimulation.pose;

/**
 * The four pointing modes (brief function 6; ADR-0058 point 1). Azimuths are relative to the
 * platform's heading, clockwise; depressions below the horizontal, positive down. The value limits of
 * brief section 5 are the endpoints' to check; these records refuse only what the geometry cannot use.
 */
public sealed interface Pointing {

  /**
   * A fixed ground point stays in the centre.
   *
   * @param longitude the point's longitude
   * @param latitude the point's latitude
   * @param height the point's height, metres HAE (U5: a value, not looked up)
   */
  record TrackPoint(double longitude, double latitude, double height) implements Pointing {
    public TrackPoint {
      if (!(longitude >= -180 && longitude <= 180) || !(latitude >= -90 && latitude <= 90) || !Double.isFinite(height)) {
        throw new IllegalArgumentException("not a point (lon, lat order!): " + longitude + ", " + latitude + ", " + height);
      }
    }
  }

  /**
   * A moving object stays in the centre. The target itself is given to {@link Gimbal#point} each frame.
   *
   * @param height the target's height where it has no altitude, metres HAE (U5)
   */
  record TrackObject(double height) implements Pointing {
    public TrackObject {
      if (!Double.isFinite(height)) {
        throw new IllegalArgumentException("height must be finite: " + height);
      }
    }
  }

  /**
   * An azimuth and a depression relative to the platform: the camera turns with it.
   *
   * @param azimuth 0 to below 360 (360 is taken as 0)
   * @param depression −90 to 90
   */
  record FixedAngles(double azimuth, double depression) implements Pointing {
    public FixedAngles {
      azimuth = Angles.azimuth(requireAngle(azimuth, 0, 360, "azimuth"));
      requireAngle(depression, -90, 90, "depression");
    }
  }

  /**
   * Back and forth over a sector at a rate: a triangle wave from {@code start} towards {@code end},
   * clockwise, an end below the start wrapping across north (e.g. 315 to 45).
   *
   * @param start the sector's start, 0 to below 360 (360 is taken as 0)
   * @param end the sector's end, 0 to below 360, not equal to the start (U8)
   * @param rate degrees a second, above 0
   * @param depression −90 to 90, fixed
   */
  record Sweep(double start, double end, double rate, double depression) implements Pointing {
    public Sweep {
      start = Angles.azimuth(requireAngle(start, 0, 360, "start"));
      end = Angles.azimuth(requireAngle(end, 0, 360, "end"));
      if (start == end) {
        throw new IllegalArgumentException("a sweep's start and end must differ (U8): " + start);
      }
      if (!(rate > 0) || !Double.isFinite(rate)) {
        throw new IllegalArgumentException("rate must be above 0: " + rate);
      }
      requireAngle(depression, -90, 90, "depression");
    }

    /** The sector's width, clockwise from the start to the end: above 0, below 360. */
    public double width() {
      return Angles.azimuth(end - start);
    }
  }

  private static double requireAngle(double value, double min, double max, String name) {
    if (!(value >= min && value <= max)) {
      throw new IllegalArgumentException(name + " must be " + min + " to " + max + ": " + value);
    }
    return value;
  }
}
