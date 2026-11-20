package dev.emcc.ecore.plugin;

/**
 * The stream channel's limits (SDK 1.8.0, CR-0044 E1; ADR-0057 point 5), as configured at start
 * ({@code emc2.streams.*}).
 *
 * @param startBufferBytes the most a stream keeps since its last start point for new viewers
 *     ({@code emc2.streams.start-buffer-bytes}); past it, it is emptied until the next start point
 * @param viewerQueueBytes the most a viewer has waiting ({@code emc2.streams.viewer-queue-bytes});
 *     past it, its queue is emptied and it resumes at the next start point
 * @param viewersPerStream the most viewers of one stream ({@code emc2.streams.viewers-per-stream})
 * @param viewers the most viewers of all streams together ({@code emc2.streams.viewers})
 */
public record StreamLimits(long startBufferBytes, long viewerQueueBytes, int viewersPerStream, int viewers) {

  /** CR-0044's defaults: 16 MiB, 4 MiB, 8 and 32. */
  public static final StreamLimits DEFAULT = new StreamLimits(16L << 20, 4L << 20, 8, 32);

  public StreamLimits {
    if (startBufferBytes < 1 || viewerQueueBytes < 1 || viewersPerStream < 1 || viewers < 1) {
      throw new IllegalArgumentException("every stream limit is at least 1: " + startBufferBytes + ", " + viewerQueueBytes + ", "
          + viewersPerStream + ", " + viewers);
    }
  }
}
