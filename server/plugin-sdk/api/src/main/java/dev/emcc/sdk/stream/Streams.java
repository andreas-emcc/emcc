package dev.emcc.sdk.stream;

import java.time.Duration;

/**
 * SDK 1.8.0 (CR-0044 E1): the plugin's streams to its web part. Open them from a worker; the
 * connection task that receives the data writes to the {@link StreamRef}.
 *
 * <pre>{@code
 * StreamRef video = context.streams().open(
 *     StreamSpec.of("link-1", "video/mp2t", Permissions.ofPlugin("fmv", "view"), label));
 * task.post(new LinkMsg.Video(video));   // the connection task writes the datagrams
 * }</pre>
 *
 * <p><b>What ECore serves</b> (the CDA): {@code GET /api/plugins/{pluginId}/stream/{name}}, over
 * the session's login and the origin check as every endpoint, before the plugin's own endpoints.
 *
 * <ul>
 *   <li>{@code 401} without a login; {@code 403} without the stream's permission (and, when access
 *       by label comes, ADR-0020, without the clearance for its label); {@code 404} for a name that
 *       is not open; {@code 503} with {@code Retry-After: 5} past the viewer limits;
 *   <li>else {@code 200} at once, without a worker round trip: the spec's {@code Content-Type},
 *       {@code Cache-Control: no-store}, {@code X-Content-Type-Options: nosniff}, chunked and
 *       endless. First the {@link StreamRef#header header}, then the chunks since the last start
 *       point, then the live chunks. {@code GET} only, no ranges.
 * </ul>
 *
 * <p><b>The start buffer:</b> the chunks since the last start point, up to the ECore setting {@code
 * emc2.streams.startBufferBytes} (default 16 MiB). Past it, it is emptied and the next start point
 * begins it again; a viewer arriving meanwhile waits for that start point.
 *
 * <p><b>A slow viewer</b> never slows the plugin or the other viewers: past {@code
 * emc2.streams.viewerQueueBytes} (default 4 MiB) its queue is emptied and it resumes at the next
 * start point, header first, so it never gets a cut picture; each such loss is counted. A viewer
 * that takes nothing for {@link #VIEWER_STALL} is closed.
 *
 * <p><b>Limits:</b> {@code emc2.streams.viewersPerStream} (default 8) and {@code
 * emc2.streams.viewers} (default 32 in all). A viewer's response ends at the stream's close, the
 * plugin's stop, the user's logout or session end, the stall, or a lost permission when the user's
 * permissions are next read. ECore counts per stream: viewers, bytes in and out, chunks dropped
 * past {@link #MAX_RATE}, viewer losses and the start buffer's size, and logs each viewer's start
 * and end with plugin, stream, user and reason.
 */
public interface Streams {

  /** The path under the plugin's base where ECore serves its streams; no plugin endpoint may start with it ({@code Endpoint}). */
  String PATH = "/stream/";

  /** The most streams a plugin has open at once. */
  int MAX_OPEN = 32;

  /** The largest chunk, 64 KiB. */
  int MAX_CHUNK = 64 * 1024;

  /** The largest header, 4 KiB. */
  int MAX_HEADER = 4 * 1024;

  /** The most a stream takes, in bits a second, averaged over one second; chunks beyond it are {@code DROPPED} and counted. */
  long MAX_RATE = 50_000_000L;

  /** How long a viewer may take nothing before ECore closes it. */
  Duration VIEWER_STALL = Duration.ofSeconds(30);

  /**
   * Opens a stream and returns at once. The name may be opened again after its {@link
   * StreamRef#close}. All of a plugin's streams close when it stops.
   *
   * @throws IllegalStateException if a stream of that name is open, or {@link #MAX_OPEN} are
   */
  StreamRef open(StreamSpec spec);
}
