package dev.emcc.plugins.terrain;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.ReplyTo;

/** The messages of the compute workers. */
sealed interface ComputeMsg extends Message {

  /**
   * One viewshed to compute.
   *
   * @param requestId the request, echoed in the answer
   * @param job what to compute
   * @param replyTo where the {@link Computed} goes
   */
  record Run(long requestId, ViewshedJob job, ReplyTo<Computed> replyTo) implements ComputeMsg {}

  /**
   * One height map to compute. The job is a viewshed's: the circle's centre and radius and the raster's steps; its heights are not used.
   *
   * @param requestId the request, echoed in the answer
   * @param job what to compute
   * @param replyTo where the {@link MapComputed} goes
   */
  record RunMap(long requestId, ViewshedJob job, ReplyTo<MapComputed> replyTo) implements ComputeMsg {}
}
