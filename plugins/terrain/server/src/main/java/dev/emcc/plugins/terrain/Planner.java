package dev.emcc.plugins.terrain;

import java.util.ArrayList;
import java.util.List;

/**
 * Which data a viewshed uses (the brief's function 7, A3): the finest level with a cell at the
 * observer's point, for the whole viewshed. When that level needs more height cells (raster nodes
 * within the range's bounding box) than the cap, the next coarser level that has a cell there and
 * fits is used, and the answer says so. When none fits, the request is refused with the cells it
 * needs and the cap.
 */
final class Planner {

  private Planner() {}

  /** What a viewshed asks for, checked. */
  record Request(double lon, double lat, double observerHeight, double targetHeight, double maxRange) {}

  /**
   * The plan.
   *
   * @param level the level used
   * @param params the sweep's parameters for it
   * @param needed the cells of the level that cover the range, as far as the index has them
   * @param nodes the raster nodes the range needs at that level
   * @param notes sentences for the answer: a fallback to a coarser level
   */
  record Plan(int level, Viewshed.Params params, List<CellId> needed, long nodes, List<String> notes) {}

  /** The result of planning: a plan, or a refusal with its HTTP status and reason. */
  sealed interface Outcome permits Planned, Refused {}

  record Planned(Plan plan) implements Outcome {}

  record Refused(int status, String message) implements Outcome {}

  /** What the plan is for, for the words of a refusal. */
  enum Subject {
    VIEWSHED("viewshed", "the observer's point", "range", "use a shorter range"),
    HEIGHT_MAP("height map", "the circle's centre", "circle", "use a smaller circle");

    final String name;
    final String point;
    final String within;
    final String advice;

    Subject(String name, String point, String within, String advice) {
      this.name = name;
      this.point = point;
      this.within = within;
      this.advice = advice;
    }
  }

  static Outcome plan(Index index, Request request, Limits limits) {
    return plan(index, request, limits, Subject.VIEWSHED);
  }

  /** As {@link #plan(Index, Request, Limits)}; a height map (function 10) is planned as a viewshed of its radius. */
  static Outcome plan(Index index, Request request, Limits limits, Subject subject) {
    int lonDeg = (int) Math.floor(request.lon());
    int latDeg = (int) Math.floor(request.lat());
    List<String> notes = new ArrayList<>();
    long finestNodes = -1;
    int finestLevel = -1;
    long lastNodes = 0;
    int lastLevel = -1;
    for (int level = 2; level >= 0; level--) {
      DtedCell at = index.find(level, lonDeg, latDeg);
      if (at == null && request.lon() == lonDeg) {
        at = index.find(level, lonDeg == -180 ? 179 : lonDeg - 1, latDeg);
      }
      if (at == null && request.lat() == latDeg) {
        at = index.find(level, lonDeg, latDeg - 1);
      }
      if (at == null) {
        continue;
      }
      Viewshed.Params params = new Viewshed.Params(
          request.lon(), request.lat(), request.observerHeight(), request.targetHeight(), request.maxRange(), limits.refraction(),
          at.lonIntervalTenths() / 36_000.0, at.latIntervalTenths() / 36_000.0);
      long nodes = Viewshed.nodesNeeded(params);
      if (finestLevel < 0) {
        finestLevel = level;
        finestNodes = nodes;
      }
      lastLevel = level;
      lastNodes = nodes;
      if (nodes <= limits.maxCells()) {
        if (level != finestLevel) {
          notes.add("Level " + level + " is used: level " + finestLevel + " needs " + finestNodes + " height cells within the " + subject.within + ", the cap is " + limits.maxCells() + ".");
        }
        return new Planned(new Plan(level, params, neededCells(index, level, params), nodes, List.copyOf(notes)));
      }
    }
    if (finestLevel < 0) {
      return new Refused(404, "there is no height data at " + subject.point);
    }
    return new Refused(413, "the " + subject.name + " needs " + lastNodes + " height cells within the " + subject.within + " at level " + lastLevel
        + (lastLevel == finestLevel ? "" : ", the coarsest level with data here") + "; the cap is " + limits.maxCells() + ": " + subject.advice);
  }

  /** The cells of {@code level} whose 1 x 1 degree square meets the raster's box. */
  private static List<CellId> neededCells(Index index, int level, Viewshed.Params params) {
    double[] box = Viewshed.degreeBox(params);
    int west = (int) Math.floor(box[0]);
    int east = (int) Math.floor(box[1] - 1e-12);
    int south = Math.max(-90, (int) Math.floor(box[2]));
    int north = Math.min(89, (int) Math.floor(box[3] - 1e-12));
    List<CellId> needed = new ArrayList<>();
    for (int lon = west; lon <= east; lon++) {
      int wrapped = Math.floorMod(lon + 180, 360) - 180;
      for (int lat = south; lat <= north; lat++) {
        if (index.find(level, wrapped, lat) != null) {
          needed.add(new CellId(level, wrapped, lat));
        }
      }
    }
    return needed;
  }
}
