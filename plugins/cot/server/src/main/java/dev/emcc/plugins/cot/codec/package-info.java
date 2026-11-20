/**
 * The CoT codec: a CoT event as XML, and a CoT event as the content of a map object. It is pure:
 * it uses the JDK and the SDK's model and JSON types only, and no connection task, store,
 * settings, worker or timer (brief "Later: outgoing", point 1; checked by {@code
 * CodecIndependenceTest}). The transport (links, connection tasks) and the store side call it,
 * never the other way round.
 */
@NullMarked
package dev.emcc.plugins.cot.codec;

import org.jspecify.annotations.NullMarked;
