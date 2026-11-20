/**
 * The emc2 Java Plugin SDK: the only code a plugin's server part may depend on (ADR-0003).
 *
 * <p>A plugin implements {@link dev.emcc.sdk.Plugin}. ECore calls {@code init}, {@code start} and
 * {@code stop}, and gives the plugin a {@link dev.emcc.sdk.PluginContext} with everything it may
 * use: workers, compute workers, compute tasks and messages, connection tasks, output channels,
 * topics, timers, outbound HTTP, HTTP endpoints, the object store, plugin documents, local
 * folders, streams and conversions, logging, status, settings and data types. Plugins never
 * create threads (overview 4.2, rule C1). The SDK as it is today is described in {@code
 * docs/plugins/reference/README.md}; {@code docs/plugins/sdk-v1.md} is its history.
 *
 * <pre>{@code
 * public final class HelloPlugin implements Plugin {
 *   private PluginContext context;
 *
 *   public void init(PluginContext context) {
 *     this.context = context;
 *     context.log().info("hello from {}", context.pluginId());
 *   }
 *   public void start() { context.status().set(PluginState.OK, "running"); }
 *   public void stop() { }
 * }
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk;

import org.jspecify.annotations.NullMarked;
