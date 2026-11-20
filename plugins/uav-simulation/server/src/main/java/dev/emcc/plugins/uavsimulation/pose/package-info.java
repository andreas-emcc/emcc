/**
 * The camera's pose geometry, plain Java without state or threads (brief functions 3 to 6, and the
 * frame period of function 7): the platform's extrapolation between updates ({@link Fix}), the line of
 * sight in the local level frame ({@link LookAngles}), the four pointing modes ({@link Pointing},
 * {@link Gimbal}), the field of view ({@link FieldOfView}) and the frame ({@link Frame}). Positions are
 * WGS84 longitude, latitude (ADR-0007), heights metres above the ellipsoid, angles degrees.
 */
@NullMarked
package dev.emcc.plugins.uavsimulation.pose;

import org.jspecify.annotations.NullMarked;
