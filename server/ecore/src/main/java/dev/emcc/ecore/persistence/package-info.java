/**
 * The persistence manager (overview 4.8, ADR-0024): the only path to persistent storage. From M0
 * to M2 it stores the live picture, fed by change events (write-behind), in a file store;
 * PostgreSQL with PostGIS follows in M3 behind the same {@link
 * dev.emcc.ecore.persistence.PictureStore} interface.
 * Everything is non-null unless marked {@code @Nullable}.
 */
@NullMarked
package dev.emcc.ecore.persistence;

import org.jspecify.annotations.NullMarked;
