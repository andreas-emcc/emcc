package dev.emcc.plugins.terrain;

import java.util.List;

/**
 * What a compute worker needs for one viewshed: the parameters, the cells it reads (immutable: each
 * holds its bytes as a {@link dev.emcc.sdk.Bytes}, shared with the cache without a copy) and how long
 * it may run.
 *
 * @param params the sweep's parameters, with the raster's steps from the observer's cell
 * @param cells the cells of one level that cover the range, as many as were read
 * @param budgetNanos the most time the sweep may take
 */
record ViewshedJob(Viewshed.Params params, List<DtedCell> cells, long budgetNanos) {}
