/**
 * The links (ADR-0037) and their transport (ADR-0036; brief section 4): a worker that follows the
 * {@code links} setting, one connection task per link that receives UDP, unicast or multicast, reads
 * the transport stream and feeds the stream channel, and the messages between them. Input only.
 */
@NullMarked
package dev.emcc.plugins.fmv.transport;

import org.jspecify.annotations.NullMarked;
