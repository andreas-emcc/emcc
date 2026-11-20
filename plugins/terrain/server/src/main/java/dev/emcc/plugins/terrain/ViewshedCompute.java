package dev.emcc.plugins.terrain;

import dev.emcc.sdk.json.JsonArray;
import java.util.List;

/** The pure core of a compute worker: sweep, trace, simplify and fit. Usable in tests without workers. */
final class ViewshedCompute {

  private ViewshedCompute() {}

  /**
   * Computes a viewshed over {@code field}.
   *
   * @param budgetNanos the most time the sweep may take; after it the outcome is {@code TIMED_OUT}
   */
  static Computed run(long requestId, HeightField field, Viewshed.Params params, long budgetNanos) {
    return run(requestId, field, params, budgetNanos, Areas.MAX_ITEMS, Areas.MAX_POSITIONS);
  }

  /** As {@link #run(long, HeightField, Viewshed.Params, long)}, with other caps for the areas (a test makes them small). */
  static Computed run(long requestId, HeightField field, Viewshed.Params params, long budgetNanos, int maxItems, int maxPositions) {
    long deadline = System.nanoTime() + Math.min(budgetNanos, Viewshed.MAX_COMPUTE_NANOS);
    Viewshed.Raster raster;
    try {
      raster = Viewshed.sweep(field, params, deadline);
    } catch (IllegalArgumentException noObserverData) {
      return new Computed(requestId, Computed.Outcome.NO_OBSERVER_DATA, new JsonArray(List.of()), 0, 0, false, 0);
    }
    if (raster == null) {
      return new Computed(requestId, Computed.Outcome.TIMED_OUT, new JsonArray(List.of()), 0, 0, false, 0);
    }
    AreaTracer.Result traced = AreaTracer.trace(raster);
    Areas.Fitted fitted = Areas.fit(traced, raster.i0, raster.j0, params.lonStepDeg(), params.latStepDeg(), maxItems, maxPositions);
    return new Computed(requestId, Computed.Outcome.DONE, fitted.areas(), fitted.simplified(), fitted.leftOut(), raster.noData, fitted.positions());
  }
}
