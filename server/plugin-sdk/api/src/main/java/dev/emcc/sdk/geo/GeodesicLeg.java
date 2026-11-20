package dev.emcc.sdk.geo;

/**
 * SDK 1.2.0: the geodesic between two positions ({@link Geodesy#inverse}).
 *
 * @param distanceMetres its length on the WGS84 ellipsoid
 * @param initialAzimuth the azimuth at the start, degrees clockwise from true north, 0 to below 360
 * @param finalAzimuth the azimuth at the end, in the direction of travel, likewise
 */
public record GeodesicLeg(double distanceMetres, double initialAzimuth, double finalAzimuth) {}
