import { useEffect, useRef, useState, type RefObject } from 'react';
import { Video } from 'lucide-react';
import { Chip, IconButton, List, ListRow, Notice, PanelFrame, type ChipTone, type PluginContext } from '@emc2/plugin-sdk';
import { formatAge, formatBitRate, formatSize, STATE_LABELS, type StreamInfo, type StreamState } from './model.ts';
import { useStore, type OpenWindow, type Store, type StreamsState } from './store.ts';
import { VideoWindow } from './VideoWindow.tsx';

/** The permission to watch (brief section 5); the server checks it too. */
export const WATCH = 'plugin.fmv.view';

const TONES: Readonly<Record<StreamState, ChipTone>> = { live: 'ok', stale: 'warning', waiting: 'info', 'not-playable': 'error', stopped: 'neutral' };

/** The current time, now and once a second, for the age of each stream's last set. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, []);
  return now;
}

/**
 * Whether the element is on screen. The shell keeps a collapsed panel, one in a collapsed pane and one
 * behind another tab mounted, only hidden; a hidden element does not intersect the viewport. Where the
 * browser has no IntersectionObserver (tests' DOM), always.
 */
function useOnScreen(element: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = element.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last !== undefined) setOnScreen(last.isIntersecting);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return onScreen;
}

/**
 * The FMV panel (brief section 6): one row per link that has received a stream, with its camera's name
 * and its link, the format, the size, the bit rate, the age of the last set and a state chip. An icon at
 * the row's end opens the stream's window.
 */
export function FmvPanel(props: {
  readonly ctx: Pick<PluginContext, 'user'>;
  readonly streams: Store<StreamsState>;
  readonly windows: { open(info: StreamInfo): void };
}) {
  const root = useRef<HTMLDivElement>(null);
  const shown = useOnScreen(root);
  const state = useStore(props.streams, shown);
  const now = useNow();
  const mayWatch = props.ctx.user.has(WATCH);
  const rows = state.streams ?? [];
  return (
    <PanelFrame title="FMV">
      <div className="fmv-panel" ref={root}>
        {state.error !== null && <Notice severity="warning">The list of streams could not be read: {state.error}</Notice>}
        {state.streams !== null && rows.length === 0 && <p className="fmv-empty">No FMV streams. An admin adds links in Settings › FMV.</p>}
        {rows.length > 0 && (
          <List label="FMV streams">
            {rows.map((row) => (
              <ListRow key={row.link}>
                <Row info={row} now={now} watch={
                    mayWatch
                      ? () => {
                          props.windows.open(row);
                        }
                      : undefined
                  } />
              </ListRow>
            ))}
          </List>
        )}
      </div>
    </PanelFrame>
  );
}

function Row(props: { readonly info: StreamInfo; readonly now: number; readonly watch: (() => void) | undefined }) {
  const { info } = props;
  const size = formatSize(info);
  // Watch only where there is video to see: live or stale (no metadata for a while). Waiting (for a conversion
  // slot), not playable (no converter, a failed conversion, a format that is not played) and stopped say why instead.
  const canWatch = info.playable && info.stream !== undefined && (info.state === 'live' || info.state === 'stale');
  return (
    <div className="fmv-row">
      <div className="fmv-row-main">
        <span className="fmv-row-title">{info.title}</span>
        {info.name !== info.title && <span className="fmv-row-link">{info.name}</span>}
        <span className="fmv-row-facts">
          {[info.format, size, formatBitRate(info.bitRate), formatAge(info.lastSet, props.now)].filter((x): x is string => x !== undefined).join(' · ')}
        </span>
        {info.message !== undefined && <span className="fmv-row-message">{info.message}</span>}
      </div>
      <Chip tone={TONES[info.state]} label={STATE_LABELS[info.state]} />
      {props.watch !== undefined && (
        <IconButton
          icon={Video}
          label="Watch"
          title={canWatch ? 'Watch' : (info.message ?? (info.state === 'stopped' ? 'The link is stopped' : 'This stream cannot be played'))}
          disabled={!canWatch}
          onClick={props.watch}
        />
      )}
    </div>
  );
}

/**
 * The windows that are open: one per stream, several at once. They live beside the panel, so closing the
 * panel's pane leaves them open. A window whose link is gone keeps its last row and says the stream has
 * stopped; it moves to a new link of the same name when one comes (a restart that gave the link a new id),
 * and plays its stream in the same window.
 *
 * <p>The overlay is in every workspace with a map, so it reads the list of streams only while a window is
 * open: a page with no FMV panel and no window asks the server nothing.
 */
export function VideoWindows(props: {
  readonly ctx: Pick<PluginContext, 'serverBase'>;
  readonly streams: Store<StreamsState>;
  readonly windows: Store<readonly OpenWindow[]> & { close(key: number): void; follow(streams: readonly StreamInfo[]): void };
}) {
  const open = useStore(props.windows);
  return open.length === 0 ? null : <OpenWindows {...props} open={open} />;
}

function OpenWindows(props: {
  readonly ctx: Pick<PluginContext, 'serverBase'>;
  readonly streams: Store<StreamsState>;
  readonly windows: { close(key: number): void; follow(streams: readonly StreamInfo[]): void };
  readonly open: readonly OpenWindow[];
}) {
  const { windows, open } = props;
  const state = useStore(props.streams);
  useEffect(() => {
    if (state.streams !== null) windows.follow(state.streams);
  }, [windows, state.streams]);
  return (
    <>
      {open.map((w) => {
        const current = state.streams?.find((s) => s.link === w.link);
        return (
          <VideoWindow
            key={w.key}
            ctx={props.ctx}
            info={current ?? w.last}
            gone={current === undefined && state.streams !== null}
            onClose={() => {
              windows.close(w.key);
            }}
          />
        );
      })}
    </>
  );
}
