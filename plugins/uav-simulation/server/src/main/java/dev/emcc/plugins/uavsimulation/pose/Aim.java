package dev.emcc.plugins.uavsimulation.pose;

/**
 * Where the camera looks relative to its platform (brief function 4, "the pointing"): an azimuth
 * relative to the platform's heading, clockwise, and a depression below the horizontal, positive down.
 *
 * @param azimuth 0 to below 360, relative to the heading
 * @param depression −90 to 90, positive down
 */
public record Aim(double azimuth, double depression) {

  /** Where a camera looks with no angles to go by: the Fixed angles defaults, ahead and 30° down (brief section 5). */
  public static final Aim DEFAULT = new Aim(0, 30);

  public Aim {
    if (!(azimuth >= 0 && azimuth < 360)) {
      throw new IllegalArgumentException("azimuth must be 0 to below 360: " + azimuth);
    }
    if (!(depression >= -90 && depression <= 90)) {
      throw new IllegalArgumentException("depression must be -90 to 90: " + depression);
    }
  }
}
