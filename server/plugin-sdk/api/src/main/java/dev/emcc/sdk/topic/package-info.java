/**
 * Typed publish and subscribe between workers (overview 4.3).
 *
 * <pre>{@code
 * static final Topic<TileFetched> FETCHED = Topic.of("basemap-osm.tile-fetched", TileFetched.class);
 * context.topics().subscribe(FETCHED, statsWorker, StatsMsg.Fetched::new);
 * context.topics().publish(FETCHED, new TileFetched(key, millis));
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.topic;

import org.jspecify.annotations.NullMarked;
