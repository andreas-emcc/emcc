import { useEffect, useRef, useState } from 'react';
import mpegts from 'mpegts.js';
import { Chip, FloatingWindow, streamUrl, type PluginContext } from '@emc2/plugin-sdk';
import { formatSize, type StreamInfo } from './model.ts';

/** How long the window waits before it opens the stream again (brief section 6). */
export const RETRY_MILLISECONDS = 2000;

/** How long a window that lost its decoder waits when the new player fails at once too: the stream has a start point every fraction of a second. */
export const DECODER_RETRY_MILLISECONDS = 500;

/**
 * A window that has played and then shows no new time for this long is rebuilt. A jump back of the stream's
 * timestamps (the loop of a replay; a source that restarts its clock) leaves mpegts.js's timeline in the
 * far future and the video frozen, with no error to tell of it.
 */
export const STALL_MILLISECONDS = 6000;

/** mpegts.js's error type for a failed media element or source buffer (`ErrorTypes.MEDIA_ERROR`). */
const MEDIA_ERROR = 'MediaError';

const H265_TYPE = 'video/mp4; codecs="hvc1.1.6.L93.B0"';

/** Whether this browser can decode H.265 (ADR-0057 point 7): never converted, played only where it is. */
export function canPlayH265(): boolean {
  const source = (globalThis as { MediaSource?: { isTypeSupported(type: string): boolean } }).MediaSource;
  return source !== undefined && source.isTypeSupported(H265_TYPE);
}

/** What the window says for a failed or ended stream, and whether it tries again. */
export function failure(status: number | undefined): { readonly text: string; readonly retry: boolean } {
  switch (status) {
    case 503:
      return { text: 'Too many viewers. Trying again.', retry: true };
    case 403:
      return { text: 'You may not watch this stream.', retry: false };
    case 404:
      return { text: 'The stream has stopped.', retry: true };
    default:
      return { text: 'The video stopped. Trying again.', retry: true };
  }
}

/**
 * The window of one stream (brief section 6; CR-0044 E3): a floating window with its classification,
 * the live video and a footer. The player is mpegts.js, with the stash buffer off and latency chasing
 * on (S9: about 0.1 s ahead). A response that ends, or fails, is tried again every 2 s with the window's
 * own browser timer, except a 403. Closing the window stops the player and frees the viewer.
 *
 * <p>A browser's decoder gives up on a damaged frame (the media element's error, code 3; the ESA's sample
 * has such frames, and Edge stops on them even when it plays the stretch from a plain MP4). The window
 * then makes a new player on the same element at once and lands on the stream's next start point; only
 * if that fails again within 2 s does it wait 0.5 s. A video that
 * has played and then stands still for 6 s (a jump back of the stream's timestamps freezes mpegts.js without an
 * error) gets a new player the same way.
 */
export function VideoWindow(props: {
  readonly ctx: Pick<PluginContext, 'serverBase'>;
  readonly info: StreamInfo;
  /** The link has no row now (it was removed, or restarted with a new id): its last row, nothing played. */
  readonly gone?: boolean;
  readonly onClose: () => void;
}) {
  const { ctx, info, onClose } = props;
  const gone = props.gone === true;
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [delay, setDelay] = useState<number | null>(null);
  const stream = gone ? undefined : info.stream;
  const unplayable = info.h265 && !canPlayH265();

  // Closing the window ends its picture-in-picture too: the player stops with the window, and a PiP left open
  // would show its last picture, frozen (the owner, M8 RC1). Only on close: a new stream in the same window keeps it.
  useEffect(() => {
    const element = video.current;
    return () => {
      if (element !== null && document.pictureInPictureElement === element) {
        void document.exitPictureInPicture().catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (stream === undefined || unplayable || element === null || !mpegts.isSupported()) return undefined;
    let player: mpegts.Player | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let startedAt = Date.now();

    const deferred = new Set<ReturnType<typeof setTimeout>>();
    // mpegts.js emits its events from inside its own code, and `destroy()` empties that code's fields: a player
    // destroyed in its own handler goes on to throw ("reading 'emit'", "reading 'notifyBufferedPositionChanged'").
    // So an event's answer waits for the next turn of the event loop.
    const later = (answer: () => void): void => {
      deferred.add(
        setTimeout(() => {
          answer();
        }, 0),
      );
    };

    const stop = (): void => {
      if (player !== undefined) {
        player.destroy();
        player = undefined;
      }
    };
    const fail = (status: number | undefined): void => {
      if (closed || player === undefined) return;
      stop();
      const f = failure(status);
      setProblem(f.text);
      if (f.retry) timer = setTimeout(open, RETRY_MILLISECONDS);
    };
    // The decoder gave up, or the video froze: a new player on the same element (which loads its new source
    // afresh), at once if this one had played for a while.
    const recover = (): void => {
      if (closed || player === undefined) return;
      stop();
      const played = Date.now() - startedAt >= RETRY_MILLISECONDS;
      if (!played) setProblem(failure(undefined).text);
      timer = setTimeout(open, played ? 0 : DECODER_RETRY_MILLISECONDS);
    };
    function open(): void {
      if (closed || element === null || stream === undefined) return;
      startedAt = Date.now();
      const p = mpegts.createPlayer(
        { type: 'mpegts', isLive: true, url: streamUrl(ctx, stream) },
        { enableStashBuffer: false, liveBufferLatencyChasing: true, liveSync: true, liveBufferLatencyMaxLatency: 1.5, liveBufferLatencyMinRemain: 0.3 },
      );
      player = p;
      p.on(mpegts.Events.ERROR, (type: string, _detail: string, details: { code?: number } | undefined) => {
        later(type === MEDIA_ERROR ? recover : () => {
          fail(details?.code);
        });
      });
      p.on(mpegts.Events.LOADING_COMPLETE, () => {
        later(() => {
          fail(undefined); // the response ended: the link restarted, or the stream closed
        });
      });
      p.on(mpegts.Events.MEDIA_INFO, () => {
        setProblem(null);
      });
      p.attachMediaElement(element);
      p.load();
      void Promise.resolve(p.play()).catch(() => undefined); // autoplay refused: the user presses play
    }

    const onElementError = (): void => {
      later(recover);
    };
    element.addEventListener('error', onElementError);
    open();
    let lastTime = 0;
    let lastProgress = Date.now();
    const delayTimer = setInterval(() => {
      const time = element.currentTime;
      if (time !== lastTime) {
        lastTime = time;
        lastProgress = Date.now();
        setProblem(null); // it plays: mpegts.js does not always say so with its media info (a new stream on the same element)
      } else if (time > 0 && !element.paused && Date.now() - lastProgress >= STALL_MILLISECONDS) {
        lastProgress = Date.now();
        recover(); // played, and stands still: the timeline broke
      }
      // A position past the buffer's end (a player opened again after a stall, with nothing new yet) is no delay.
      const ranges = element.buffered;
      const behind = ranges.length > 0 ? ranges.end(ranges.length - 1) - element.currentTime : null;
      setDelay(behind !== null && behind >= 0 ? behind : null);
    }, 1000);
    return () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      clearInterval(delayTimer);
      element.removeEventListener('error', onElementError);
      deferred.forEach(clearTimeout);
      stop();
    };
  }, [ctx, stream, unplayable]);

  const size = formatSize(info);
  const note = gone
    ? failure(404).text
    : unplayable
      ? 'This browser cannot play H.265.'
      : stream === undefined
        ? (info.message ?? 'This stream cannot be played.')
        : problem;
  return (
    <FloatingWindow open title={info.title} onClose={onClose} defaultSize={{ width: 640, height: 420 }}>
      <div className="fmv-window">
        <div className="fmv-window-label">
          <Chip tone="neutral" label={info.label === '' ? 'Unlabelled' : info.label} title="The stream's classification" />
        </div>
        {note !== null && (
          <p className="fmv-window-note" role="status">
            {note}
          </p>
        )}
        <video ref={video} className="fmv-window-video" muted autoPlay playsInline />
        <div className="fmv-window-foot">
          <span>{info.format}</span>
          {size !== undefined && <span>{size}</span>}
          <span>{delay === null ? 'no delay measured' : `${delay.toFixed(1)} s behind live`}</span>
        </div>
      </div>
    </FloatingWindow>
  );
}
