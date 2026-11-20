/**
 * AIS as NMEA 0183 {@code !AIVDM} sentences (ITU-R M.1371-5, Annex 8; the gpsd project's "AIVDM/AIVDO
 * protocol decoding" explains the layout). Pure classes, no I/O: one sentence to a {@link
 * dev.emcc.plugins.ais.codec.Sentence}, fragments joined to a payload, a payload to an {@link
 * dev.emcc.plugins.ais.codec.AisMessage}, a message to the object's content. Received data is
 * untrusted: every refusal has a reason and none throws.
 */
@NullMarked
package dev.emcc.plugins.ais.codec;

import org.jspecify.annotations.NullMarked;
