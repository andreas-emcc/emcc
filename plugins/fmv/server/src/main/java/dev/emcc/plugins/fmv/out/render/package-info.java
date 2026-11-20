/**
 * The renderer (brief section 10.5 point 15; ADR-0058 point 5; spike S10's {@code RenderBench.java}):
 * a pose seen over the terrain and the imagery, into one I420 picture for ECore's encoder
 * (CR-0050 point 1.4). Plain code on the compute task's one thread: no threads of its own, no I/O.
 */
@NullMarked
package dev.emcc.plugins.fmv.out.render;

import org.jspecify.annotations.NullMarked;
