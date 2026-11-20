/**
 * The live picture gateway (overview 4.5, ADR-0006, T-013): keeps every browser session up to date
 * with a snapshot, then batches of change events, and takes the sessions' change requests to the
 * object store. The wire protocol is described in {@code server/live-picture-protocol.md}.
 */
@NullMarked
package dev.emcc.ecore.live;

import org.jspecify.annotations.NullMarked;
