import { useCallback, useSyncExternalStore } from 'react';
import { parseStreams, type StreamInfo } from './model.ts';

/** How often the list is read while something shows it (brief section 6). */
export const POLL_MILLISECONDS = 2000;

/** A value that changes, for `useSyncExternalStore`. */
export interface Store<T> {
  subscribe(listener: () => void): () => void;
  get(): T;
}

export interface StreamsState {
  /** `null` until the first answer. */
  readonly streams: readonly StreamInfo[] | null;
  /** Why the last read failed, or `null`. */
  readonly error: string | null;
}

/** Whether the plugin's settings name at least one link: without one there is no stream to list. */
export function hasLinks(settings: { readonly [name: string]: unknown }): boolean {
  const links = settings['links'];
  return Array.isArray(links) && links.length > 0;
}

/** A yes or no that can change: here, whether any link is configured. */
export interface Switch {
  get(): boolean;
  onChange(listener: (on: boolean) => void): () => void;
}

/**
 * The list `GET /streams` gives, read every 2 s while anything uses it (a panel on screen, an open
 * window), by one timer for the panel and the windows alike, and only while a link is configured:
 * without one the list is empty and nothing is asked. A failed read keeps the last list and says why.
 */
export function createStreamsStore(
  serverBase: string,
  configured: Switch,
  fetchFn: typeof fetch = (...a) => globalThis.fetch(...a),
): Store<StreamsState> {
  let state: StreamsState = { streams: null, error: null };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let reading = false;

  const set = (next: StreamsState): void => {
    state = next;
    listeners.forEach((l) => {
      l();
    });
  };

  const read = async (): Promise<void> => {
    if (reading) return;
    reading = true;
    try {
      // Only the emc2 server is reachable from the browser (ADR-0030); serverBase is /api/plugins/<id>/.
      const response = await fetchFn(`${serverBase}streams`);
      if (!configured.get()) return; // the last link went while the answer was on its way: the list stays empty
      if (!response.ok) {
        set({ streams: state.streams, error: `The server answered ${String(response.status)}` });
        return;
      }
      set({ streams: parseStreams(await response.json()), error: null });
    } catch (e) {
      set({ streams: state.streams, error: e instanceof Error ? e.message : String(e) });
    } finally {
      reading = false;
    }
  };

  const empty: StreamsState = { streams: [], error: null };
  // Polls exactly while someone listens and a link is configured.
  const update = (): void => {
    const poll = listeners.size > 0 && configured.get();
    if (poll && timer === undefined) {
      void read();
      timer = setInterval(() => void read(), POLL_MILLISECONDS);
    } else if (!poll && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    if (!configured.get() && state !== empty) set(empty);
  };
  configured.onChange(update);

  return {
    subscribe(listener) {
      listeners.add(listener);
      update();
      return () => {
        listeners.delete(listener);
        update();
      };
    },
    get: () => state,
  };
}

/** An open window: the link it shows (its id), and that link's row as last seen. */
export interface OpenWindow {
  /** Stays the same while the window is open, also when it follows another link. */
  readonly key: number;
  readonly link: string;
  readonly last: StreamInfo;
}

/**
 * Which link each window shows after a new list: a window whose link is gone moves to a new link of the
 * same name that no other window shows. A settings change that leaves out the links' ids makes new links
 * (CR-0047 F2: ECore gives them new ids), with new streams; the window follows the link the user sees as
 * the same one. A renamed link (its id kept) keeps its window, under its new name. A window whose link
 * has no row keeps its last one. The same list back if nothing changed.
 */
export function follow(windows: readonly OpenWindow[], streams: readonly StreamInfo[]): readonly OpenWindow[] {
  const shown = new Set(windows.map((w) => w.link));
  const next = windows.map((w): OpenWindow => {
    const own = streams.find((s) => s.link === w.link);
    if (own !== undefined) return own === w.last ? w : { ...w, last: own };
    const heir = streams.find((s) => s.name === w.last.name && !shown.has(s.link));
    if (heir === undefined) return w;
    shown.add(heir.link);
    return { ...w, link: heir.link, last: heir };
  });
  return next.some((w, i) => w !== windows[i]) ? next : windows;
}

/** The windows that are open, in the order they were opened. */
export function createWindowsStore(): Store<readonly OpenWindow[]> & {
  open(info: StreamInfo): void;
  close(key: number): void;
  follow(streams: readonly StreamInfo[]): void;
} {
  let open: readonly OpenWindow[] = [];
  let nextKey = 1;
  const listeners = new Set<() => void>();
  const set = (next: readonly OpenWindow[]): void => {
    open = next;
    listeners.forEach((l) => {
      l();
    });
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => open,
    open(info) {
      if (!open.some((w) => w.link === info.link)) set([...open, { key: nextKey++, link: info.link, last: info }]);
    },
    close(key) {
      if (open.some((w) => w.key === key)) set(open.filter((w) => w.key !== key));
    },
    follow(streams) {
      const next = follow(open, streams);
      if (next !== open) set(next);
    },
  };
}

/** The store's value; with `active` false it is not subscribed to (a panel off screen does not keep the polling going). */
export function useStore<T>(store: Store<T>, active = true): T {
  // Stable functions, or every render would unsubscribe and subscribe again, which restarts the polling.
  const subscribe = useCallback((listener: () => void) => (active ? store.subscribe(listener) : () => undefined), [store, active]);
  const get = useCallback(() => store.get(), [store]);
  return useSyncExternalStore(subscribe, get);
}
