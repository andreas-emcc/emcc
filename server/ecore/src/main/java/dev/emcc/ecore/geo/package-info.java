/**
 * Geometry on the sphere for areas of interest (spike S3): the bound of an object's geometry
 * ({@link dev.emcc.ecore.geo.Cap}) and the area test ({@link dev.emcc.ecore.geo.GeoArea}). Works
 * at the poles and across the antimeridian; coordinates are longitude, latitude (ADR-0007).
 * Everything is non-null unless marked {@code @Nullable}.
 */
@NullMarked
package dev.emcc.ecore.geo;

import org.jspecify.annotations.NullMarked;
