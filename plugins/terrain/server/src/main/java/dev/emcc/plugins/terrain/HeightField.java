package dev.emcc.plugins.terrain;

/** Ground heights, by position. One field is used by one computation, on one thread. */
interface HeightField {

  /**
   * The height of the ground at a position in metres above the data's vertical reference, bilinear
   * between the samples; the vertical reference cancels out of a viewshed, which uses one data set
   * (ADR-0049 point 5). {@link Double#NaN} where there is no data: no cell, or a void at one of the
   * four samples round the position.
   *
   * @param lon longitude in degrees, any number: it is wrapped into -180 to 180
   * @param lat latitude in degrees
   */
  double height(double lon, double lat);
}
