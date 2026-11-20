/**
 * Writing a read document into the object store for one external system (an imported file, or a
 * consumer link): {@link dev.emcc.plugins.nvg.sync.SyncPlan} decides the change requests (pure, run
 * on a compute worker), {@link dev.emcc.plugins.nvg.sync.SyncRun} sends them from the worker that owns
 * it, a bounded number at a time.
 */
@NullMarked
package dev.emcc.plugins.nvg.sync;

import org.jspecify.annotations.NullMarked;
