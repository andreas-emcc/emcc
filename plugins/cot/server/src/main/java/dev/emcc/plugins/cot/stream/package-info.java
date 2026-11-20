/**
 * The transport side of the plugin that needs no SDK: cutting a CoT stream into documents. The
 * TCP link's connection task (in the plugin's own package) uses it; it knows nothing of
 * connections, workers or the store.
 */
@NullMarked
package dev.emcc.plugins.cot.stream;

import org.jspecify.annotations.NullMarked;
