/**
 * Streams (SDK 1.8.0 part E; CR-0044, ADR-0057 point 5): an endless binary stream from a plugin's
 * server part to its web part, through ECore. Also ECore's conversion of an MPEG-2 transport stream
 * to H.264 (CR-0044 E2; ADR-0057 point 8; CR-0045).
 *
 * <p>A worker opens a stream ({@link dev.emcc.sdk.stream.Streams#open}) and hands its {@link
 * dev.emcc.sdk.stream.StreamRef} to the connection task that receives the data, which writes chunks
 * to it, never blocking. ECore owns every viewer's connection, keeps the start buffer, and drops data
 * for a slow viewer; no plugin thread, socket or lock serves a browser. A web part plays a stream
 * from {@code streamUrl(ctx, name)} (web SDK).
 *
 * <p>Plugins never start a program ({@code PluginRules}): a conversion is ECore's process, which
 * the plugin feeds through a {@link dev.emcc.sdk.stream.ConversionRef} and whose output goes
 * straight into a stream.
 */
@NullMarked
package dev.emcc.sdk.stream;

import org.jspecify.annotations.NullMarked;
