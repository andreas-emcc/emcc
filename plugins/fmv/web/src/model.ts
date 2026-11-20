/** What `GET /streams` gives per link that has received a stream (brief section 6), and how the panel words it. */

export type StreamState = 'live' | 'stale' | 'waiting' | 'not-playable' | 'stopped';

export interface StreamInfo {
  /** The link's identity. */
  readonly link: string;
  /** The link's name. */
  readonly name: string;
  /** The camera's name from its last set, else the link's. */
  readonly title: string;
  /** The stream's name, for `streamUrl`; absent when the stream is not open (a format that is not played, or no stream service). */
  readonly stream?: string;
  readonly format: string;
  readonly playable: boolean;
  /** H.265: played only where the browser can decode it. */
  readonly h265: boolean;
  readonly width?: number;
  readonly height?: number;
  /** Bits a second over the last 5 s. */
  readonly bitRate: number;
  /** ISO time of the last metadata set. */
  readonly lastSet?: string;
  readonly state: StreamState;
  readonly message?: string;
  /** The stream's classification, as its label says. */
  readonly label: string;
}

const STATES: readonly string[] = ['live', 'stale', 'waiting', 'not-playable', 'stopped'];

/** Reads the list; a row that is not one is left out, never an error (the server part is the plugin's own). */
export function parseStreams(value: unknown): StreamInfo[] {
  if (!Array.isArray(value)) return [];
  const out: StreamInfo[] = [];
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const o = raw as Record<string, unknown>;
    if (typeof o['link'] !== 'string' || typeof o['name'] !== 'string' || typeof o['format'] !== 'string' || typeof o['state'] !== 'string') continue;
    if (!STATES.includes(o['state'])) continue;
    out.push({
      link: o['link'],
      name: o['name'],
      title: typeof o['title'] === 'string' ? o['title'] : o['name'],
      ...(typeof o['stream'] === 'string' ? { stream: o['stream'] } : {}),
      format: o['format'],
      playable: o['playable'] === true,
      h265: o['h265'] === true,
      ...(typeof o['width'] === 'number' ? { width: o['width'] } : {}),
      ...(typeof o['height'] === 'number' ? { height: o['height'] } : {}),
      bitRate: typeof o['bitRate'] === 'number' ? o['bitRate'] : 0,
      ...(typeof o['lastSet'] === 'string' ? { lastSet: o['lastSet'] } : {}),
      state: o['state'] as StreamState,
      ...(typeof o['message'] === 'string' ? { message: o['message'] } : {}),
      label: typeof o['label'] === 'string' ? o['label'] : '',
    });
  }
  return out;
}

/** "4.1 Mbit/s", "850 kbit/s", "0 kbit/s". */
export function formatBitRate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbit/s`;
  return `${Math.round(bitsPerSecond / 1000).toString()} kbit/s`;
}

/** "3 s ago", "2 min ago", "no metadata". */
export function formatAge(lastSet: string | undefined, now: number): string {
  if (lastSet === undefined) return 'no metadata';
  const seconds = Math.max(0, Math.round((now - Date.parse(lastSet)) / 1000));
  if (seconds < 120) return `${seconds.toString()} s ago`;
  if (seconds < 7200) return `${Math.round(seconds / 60).toString()} min ago`;
  return `${Math.round(seconds / 3600).toString()} h ago`;
}

/** "1280 × 720", or `undefined` when the size is not known. */
export function formatSize(info: Pick<StreamInfo, 'width' | 'height'>): string | undefined {
  return info.width === undefined || info.height === undefined ? undefined : `${info.width.toString()} × ${info.height.toString()}`;
}

/** The chip's word for a state. */
export const STATE_LABELS: Readonly<Record<StreamState, string>> = {
  live: 'Live',
  stale: 'Stale',
  waiting: 'Waiting',
  'not-playable': 'Not playable',
  stopped: 'Stopped',
};
