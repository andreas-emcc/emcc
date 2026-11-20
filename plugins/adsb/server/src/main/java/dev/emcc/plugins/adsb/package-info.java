/**
 * The server part of the {@code adsb} plugin: a link to an ADS-B decoder's SBS-1 output (input only).
 * {@link dev.emcc.plugins.adsb.LinkWorker} owns the links and the aircraft and writes the objects
 * through change requests; {@link dev.emcc.plugins.adsb.Sbs1} parses a line, {@link
 * dev.emcc.plugins.adsb.AircraftMapper} maps an aircraft to its object. The transport is in {@code
 * transport}.
 */
@NullMarked
package dev.emcc.plugins.adsb;

import org.jspecify.annotations.NullMarked;
