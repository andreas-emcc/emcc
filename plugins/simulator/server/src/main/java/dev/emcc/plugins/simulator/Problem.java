package dev.emcc.plugins.simulator;

/**
 * Why a route cannot run (brief function 4): shown in the routes panel, the route editor and the
 * status.
 *
 * @param point the index of the point it concerns, or {@link #ROUTE} for the whole route
 * @param message what is wrong, in English and SI units
 */
record Problem(int point, String message) {

  static final int ROUTE = -1;

  static Problem route(String message) {
    return new Problem(ROUTE, message);
  }

  static Problem at(int point, String message) {
    return new Problem(point, message);
  }
}
