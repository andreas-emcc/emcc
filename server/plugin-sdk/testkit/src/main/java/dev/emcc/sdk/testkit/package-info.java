/**
 * Test kit for plugins and for ECore (test scope only).
 *
 * <ul>
 *   <li>{@link dev.emcc.sdk.testkit.FakePluginContext}: a deterministic, single-threaded plugin
 *       context with the same mailbox, reply, timer and endpoint rules as ECore, a virtual clock
 *       and a scripted fake upstream for outbound HTTP. From SDK v1 also an in-memory object store
 *       ({@link dev.emcc.sdk.testkit.FakeStore}), plugin documents ({@link
 *       dev.emcc.sdk.testkit.FakeDocuments}) and listeners on scripted connections ({@link
 *       dev.emcc.sdk.testkit.FakeListeners}, {@link dev.emcc.sdk.testkit.FakeConnection}).
 *   <li>{@link dev.emcc.sdk.testkit.PluginRules}: the ArchUnit rule set every plugin build runs.
 *   <li>{@link dev.emcc.sdk.testkit.ModelCodecContractTest}: the contract test ECore's JSON codec
 *       must pass, over {@code model/examples/}.
 * </ul>
 *
 * <pre>{@code
 * var ctx = FakePluginContext.builder("basemap-osm").build();
 * plugin.init(ctx);
 * plugin.start();
 * ctx.upstream().respond("https://tile.openstreetmap.org/5/17/9.png", 200, Headers.of("Content-Type", "image/png"), png);
 * var call = ctx.call("/tiles/5/17/9.png");
 * ctx.runUntilIdle();
 * assertThat(call.reply().status()).isEqualTo(200);
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.testkit;

import org.jspecify.annotations.NullMarked;
