/**
 * Output channels (SDK 1.2.0; ADR-0037, CR-0025 part 3): data out of emc2 without a layer.
 *
 * <p>Every output link of an output plugin (e.g. {@code cot}'s link to a TAK Server) is also an
 * <b>output channel</b>. The plugin offers it ({@link dev.emcc.sdk.channel.Channels#offer}); other
 * plugins' server parts find the channels ({@link dev.emcc.sdk.channel.Channels#watch}) and send
 * objects to them ({@link dev.emcc.sdk.channel.Channels#send}), never blocking. ECore keeps one
 * inbox per channel that keeps only the latest item per object, and hands the items to the
 * offering plugin's worker, so a slow protocol never builds a growing queue (ADR-0037 point 6).
 *
 * <p>Rates, skips and the classification limit are the offering plugin's (ADR-0037 points 6 to 8;
 * {@link dev.emcc.sdk.ClassificationLimit}).
 *
 * <p><b>Input channels</b> (ADR-0037 point 5) are specified in {@code docs/plugins/sdk-v1.md} and
 * reserved: they come when a first plugin needs them, as a compatible addition.
 */
@NullMarked
package dev.emcc.sdk.channel;

import org.jspecify.annotations.NullMarked;
