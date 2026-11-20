/**
 * SDK 1.8.0 part E (CR-0044 E1; ADR-0057 point 5): a stream from the plugin's own server part, an
 * endless binary response that ECore serves under the plugin's base. The server part opens it
 * (`Streams.open` in the Java SDK) and its connection task writes to it; the web part plays it with
 * its own player, e.g. mpegts.js for MPEG-TS video.
 *
 * - ECore answers `401` without a login, `403` without the stream's permission, `404` for a stream
 *   that is not open, and `503` past its viewer limits (with `Retry-After`).
 * - A new viewer starts at the last start point (for video, the last keyframe), and a slow viewer
 *   loses data and resumes at the next one, so neither slows the server part.
 * - The response ends when the stream closes, e.g. when its link restarts: open it again.
 *
 * @example
 * const player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: streamUrl(ctx, 'link-1') });
 */
import type { PluginContext } from './context.ts';

/** A stream's name, as the Java SDK's `StreamSpec` has it. */
export const STREAM_NAME_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';

const NAME = new RegExp(STREAM_NAME_PATTERN);

/**
 * The URL of the plugin's stream `name`: `${ctx.serverBase}stream/<name>`. Throws for a name the
 * server part could not have opened, so that a wrong one fails at once rather than as a `404`.
 */
export function streamUrl(ctx: Pick<PluginContext, 'serverBase'>, name: string): string {
  if (!NAME.test(name)) throw new Error(`a stream's name matches ${STREAM_NAME_PATTERN}: ${JSON.stringify(name)}`);
  return `${ctx.serverBase}stream/${name}`;
}
