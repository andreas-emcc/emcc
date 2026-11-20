/**
 * The output link (brief section 10, M9 F1): a simulated camera's poses rendered into a picture,
 * encoded by ECore's conversion service, muxed with ST 0601 and ST 0102 into a transport stream,
 * and sent paced over UDP. This package holds the pose and the sender's pacing; the geometry, the
 * terrain, the imagery and the renderer are in its subpackages, the KLV writer in {@code klv} and
 * the muxer in {@code ts}.
 */
@NullMarked
package dev.emcc.plugins.fmv.out;

import org.jspecify.annotations.NullMarked;
