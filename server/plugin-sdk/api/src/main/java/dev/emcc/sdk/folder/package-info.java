/**
 * SDK 1.4.0 (CR-0030 part 6, ADR-0049 point 4): local folders that a plugin's manifest declares,
 * read by ECore for the plugin, read only and confined to the folder. Plugins never do their own
 * file I/O (rule 19 of the data model; {@code PluginRules}).
 *
 * <pre>{@code
 * LocalFolder heights = context.folders().folder("heights");
 * heights.list("dted/e015", Duration.ofSeconds(5), self, r -> new TerrainMsg.Listed(r));
 * heights.read("dted/e015/n59.dt2", 0, LocalFolder.MAX_READ_BYTES, Duration.ofSeconds(10), self, r -> new TerrainMsg.Read(r));
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.folder;

import org.jspecify.annotations.NullMarked;
