/**
 * NVG 2.0.x as XML: reading untrusted documents into {@link dev.emcc.plugins.nvg.codec.NvgDocument}
 * and writing NVG 2.0.2. Pure: no I/O, no threads; the JDK's StAX only, hardened (no DTDs, no external
 * entities, the brief's limits). The mapping to map objects is in {@code mapping}.
 */
@NullMarked
package dev.emcc.plugins.nvg.codec;

import org.jspecify.annotations.NullMarked;
