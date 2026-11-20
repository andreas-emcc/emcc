package dev.emcc.plugins.fmv.out.render;

/**
 * The ground's height where no height data covers a point (brief O5): flat at 0 m HAE, which the
 * owner accepted (2026-11-17) as a deviation from ADR-0058 point 4's and ADR-0059 point 8's "flat at
 * the frame's height", which a pose does not give. The renderer asks it once a frame, so another
 * rule (e.g. the last frame centre's height) fits here without changing the renderer.
 */
@FunctionalInterface
public interface GroundFallback {

  /** O5 as the brief reads it today: flat at 0 m HAE. */
  GroundFallback SEA_LEVEL = () -> 0;

  /** The height, metres HAE, of ground without height data, for this frame. */
  double height();
}
