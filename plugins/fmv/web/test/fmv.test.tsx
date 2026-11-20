import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeUser } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';

// A player that records what was done to it and lets a test say what happened.
interface FakePlayer {
  readonly source: { readonly url: string; readonly type: string; readonly isLive: boolean };
  readonly config: Record<string, unknown>;
  readonly handlers: Map<string, (...args: unknown[]) => void>;
  destroyed: boolean;
  loaded: boolean;
}
const players: FakePlayer[] = [];

vi.mock('mpegts.js', () => {
  const Events = { ERROR: 'error', LOADING_COMPLETE: 'loading_complete', MEDIA_INFO: 'media_info' };
  return {
    default: {
      Events,
      isSupported: () => true,
      createPlayer(source: FakePlayer['source'], config: Record<string, unknown>) {
        const p: FakePlayer = { source, config, handlers: new Map(), destroyed: false, loaded: false };
        players.push(p);
        return {
          on: (event: string, handler: (...args: unknown[]) => void) => {
            p.handlers.set(event, handler);
          },
          attachMediaElement: () => undefined,
          load: () => {
            p.loaded = true;
          },
          play: () => Promise.resolve(),
          destroy: () => {
            p.destroyed = true;
          },
        };
      },
    },
  };
});

const row = (over: Record<string, unknown> = {}) => ({
  link: 'fmv-link-1',
  name: 'FMV link 1',
  title: 'MQ-9 Reaper',
  stream: 'fmv-link-1',
  format: 'H.264',
  playable: true,
  h265: false,
  width: 1280,
  height: 720,
  bitRate: 4_100_000,
  lastSet: new Date(Date.now() - 3000).toISOString(),
  state: 'live',
  label: 'UNCLASSIFIED',
  ...over,
});

/** Answers `GET .../streams` with what `list.current` holds. */
const list: { current: unknown; status: number } = { current: [], status: 200 };
const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(list.current), { status: list.status })));

/** One configured link: the list is read only while there is one. */
const ONE_LINK = { links: [{ id: 'fmv-link-1', name: 'FMV link 1', port: 14600 }] };

async function activated(permissions?: readonly string[], settings: Settings = ONE_LINK) {
  const ctx = createFakeContext({ pluginId: manifest.id, settings, ...(permissions === undefined ? {} : { user: createFakeUser({ permissions }) }) });
  await plugin.activate(ctx);
  const Panel = ctx.panels[0]?.component;
  const Overlay = ctx.overlays[0]?.component;
  if (!Panel || !Overlay) throw new Error('no panel or overlay');
  return { ctx, Panel, Overlay };
}

async function shown(permissions?: readonly string[]) {
  const a = await activated(permissions);
  render(
    <>
      <a.Panel />
      <a.Overlay />
    </>,
  );
  await act(() => vi.advanceTimersByTimeAsync(0));
  return a;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  list.current = [];
  list.status = 200;
  players.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the panel (criterion 15)', () => {
  it('says so when there are no streams', async () => {
    await shown();
    expect(screen.getByText('No FMV streams. An admin adds links in Settings › FMV.')).toBeDefined();
  });

  it('lists each stream with its format, size, bit rate, metadata age and state', async () => {
    list.current = [row(), row({ link: 'l2', name: 'FMV link 2', title: 'Another', format: 'MPEG-2 → H.264', width: undefined, height: undefined, bitRate: 850_000, state: 'waiting', lastSet: undefined })];
    await shown();
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('MQ-9 Reaper');
    expect(rows[0]?.textContent).toContain('FMV link 1');
    expect(rows[0]?.textContent).toContain('H.264 · 1280 × 720 · 4.1 Mbit/s · 3 s ago');
    expect(rows[0]?.textContent).toContain('Live');
    expect(rows[1]?.textContent).toContain('MPEG-2 → H.264 · 850 kbit/s · no metadata');
    expect(rows[1]?.textContent).toContain('Waiting');
  });

  it('names the link only when the camera has a name of its own', async () => {
    list.current = [row({ title: 'FMV link 1' })];
    await shown();
    expect(screen.getAllByText('FMV link 1')).toHaveLength(1);
  });

  it('reads the list from its own server part, again every 2 s while it is shown', async () => {
    const { ctx } = await shown();
    expect(fetchMock).toHaveBeenCalledWith(`${ctx.serverBase}streams`);
    const first = fetchMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetchMock.mock.calls.length).toBe(first + 1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetchMock.mock.calls.length).toBe(first + 2);
  });

  it('asks nothing on a page with no panel and no window: the overlay alone does not read the list', async () => {
    const a = await activated(['plugin.fmv.view']);
    render(<a.Overlay />);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the list while a window is open without the panel, and stops when the last window closes', async () => {
    list.current = [row()];
    const a = await activated(['plugin.fmv.view']);
    const panel = render(<a.Panel />);
    render(<a.Overlay />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    panel.unmount();
    const before = fetchMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(fetchMock.mock.calls.length).toBe(before + 2);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    const closed = fetchMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock.mock.calls.length).toBe(closed);
  });

  it('asks nothing while no link is configured, starts when one is added and stops when the last is removed', async () => {
    const a = await activated(['plugin.fmv.view'], { links: [] });
    render(
      <>
        <a.Panel />
        <a.Overlay />
      </>,
    );
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('No FMV streams. An admin adds links in Settings › FMV.')).toBeDefined();
    list.current = [row()];
    act(() => {
      a.ctx.changeSettings(ONE_LINK);
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    act(() => {
      a.ctx.changeSettings({ links: [] });
    });
    const removed = fetchMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock.mock.calls.length).toBe(removed);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('asks nothing while the panel is off screen (collapsed, or behind another tab), and reads as soon as it shows', async () => {
    let report: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          report = callback;
        }
        observe() {
          report?.([{ isIntersecting: false }]);
        }
        disconnect() {
          report = undefined;
        }
      },
    );
    await shown();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      report?.([{ isIntersecting: true }]);
    });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => {
      report?.([{ isIntersecting: false }]);
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says when the list could not be read and keeps the last one', async () => {
    list.current = [row()];
    await shown();
    list.status = 500;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByText(/could not be read/)).toBeDefined();
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('hides Watch without the permission', async () => {
    list.current = [row()];
    await shown([]);
    expect(screen.queryByRole('button', { name: 'Watch' })).toBeNull();
  });

  it('shows Watch with the permission, disabled for a format that cannot be played', async () => {
    list.current = [row(), row({ link: 'l2', name: 'FMV link 2', stream: undefined, playable: false, format: 'JPEG 2000', state: 'not-playable', message: 'Not playable: JPEG 2000' })];
    await shown(['plugin.fmv.view']);
    const buttons = screen.getAllByRole('button', { name: 'Watch' });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Not playable: JPEG 2000')).toBeDefined();
  });

  it('enables Watch only where there is video: live and stale; waiting, no converter, a failed conversion and stopped say why', async () => {
    list.current = [
      row({ link: 'a', name: 'A live', state: 'live' }),
      row({ link: 'b', name: 'B stale', state: 'stale' }),
      row({ link: 'c', name: 'C waiting', state: 'waiting', format: 'MPEG-2 → H.264', message: 'Waiting for a conversion slot' }),
      row({ link: 'd', name: 'D no converter', state: 'not-playable', format: 'MPEG-2 → H.264', message: 'No converter installed' }),
      row({ link: 'e', name: 'E failed', state: 'not-playable', format: 'MPEG-2 → H.264', message: 'Conversion failed: crashed' }),
      row({ link: 'f', name: 'F stopped', state: 'stopped', stream: undefined, message: 'The link is switched off' }),
      row({ link: 'g', name: 'G down', state: 'stopped', stream: undefined }),
    ];
    await shown(['plugin.fmv.view']);
    const buttons = screen.getAllByRole<HTMLButtonElement>('button', { name: 'Watch' });
    expect(buttons.map((b) => b.disabled)).toEqual([false, false, true, true, true, true, true]);
    expect(buttons.map((b) => b.title)).toEqual([
      'Watch',
      'Watch',
      'Waiting for a conversion slot',
      'No converter installed',
      'Conversion failed: crashed',
      'The link is switched off',
      'The link is stopped',
    ]);
    expect(screen.getByText('No converter installed')).toBeDefined();
    expect(screen.getByText('Conversion failed: crashed')).toBeDefined();
  });
});

describe('the window (criteria 16 and 17)', () => {
  it('opens per stream, several at once, with its classification, and plays the stream from the server part', async () => {
    list.current = [row(), row({ link: 'l2', name: 'FMV link 2', title: 'Another', stream: 'fmv-link-2', label: 'SECRET' })];
    const { ctx } = await shown();
    const buttons = screen.getAllByRole('button', { name: 'Watch' });
    fireEvent.click(buttons[0] as HTMLElement);
    fireEvent.click(buttons[1] as HTMLElement);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(screen.getByRole('dialog', { name: 'MQ-9 Reaper' })).toBeDefined();
    expect(screen.getByText('UNCLASSIFIED')).toBeDefined();
    expect(screen.getByText('SECRET')).toBeDefined();
    expect(players.map((p) => p.source.url)).toEqual([`${ctx.serverBase}stream/fmv-link-1`, `${ctx.serverBase}stream/fmv-link-2`]);
    expect(players[0]?.source).toMatchObject({ type: 'mpegts', isLive: true });
    expect(players[0]?.config).toMatchObject({ enableStashBuffer: false, liveBufferLatencyChasing: true });
    expect(players.every((p) => p.loaded)).toBe(true);
    expect(screen.getAllByText('1280 × 720')).toHaveLength(2); // in the footers of both windows
  });

  it('stays open when the panel is gone', async () => {
    list.current = [row()];
    const a = await activated(['plugin.fmv.view']);
    const panel = render(<a.Panel />);
    const overlay = render(<a.Overlay />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(screen.getByRole('dialog')).toBeDefined();
    panel.unmount();
    expect(screen.getByRole('dialog')).toBeDefined();
    overlay.unmount();
  });

  it('leaves picture-in-picture when it is closed, and not while it stays open', async () => {
    list.current = [row(), row({ link: 'l2', name: 'FMV link 2', title: 'Another', stream: 'fmv-link-2' })];
    await shown();
    for (const b of screen.getAllByRole('button', { name: 'Watch' })) fireEvent.click(b);
    const [inPip, other] = screen.getAllByRole('dialog').map((d) => d.querySelector('video'));
    let pip: Element | null = inPip ?? null;
    const exit = vi.fn(() => {
      pip = null;
      return Promise.resolve();
    });
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => pip });
    Object.defineProperty(document, 'exitPictureInPicture', { configurable: true, value: exit });
    try {
      list.current = [row({ bitRate: 3_000_000 }), row({ link: 'l2', name: 'FMV link 2', title: 'Another', stream: 'fmv-link-2' })];
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(exit).not.toHaveBeenCalled(); // a new list leaves it alone
      const closeOther = other?.closest('[role="dialog"]')?.querySelector<HTMLElement>('button[aria-label*="lose" i]');
      fireEvent.click(closeOther as HTMLElement);
      expect(exit).not.toHaveBeenCalled(); // another window's close leaves it alone
      const close = inPip?.closest('[role="dialog"]')?.querySelector<HTMLElement>('button[aria-label*="lose" i]');
      fireEvent.click(close as HTMLElement);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      Reflect.deleteProperty(document, 'pictureInPictureElement');
      Reflect.deleteProperty(document, 'exitPictureInPicture');
    }
  });

  it('stops the player when it is closed', async () => {
    list.current = [row()];
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(players[0]?.destroyed).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(players[0]?.destroyed).toBe(true);
  });

  it('says that the browser cannot play H.265, and plays nothing', async () => {
    list.current = [row({ format: 'H.265', h265: true })];
    vi.stubGlobal('MediaSource', { isTypeSupported: () => false });
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(screen.getByText('This browser cannot play H.265.')).toBeDefined();
    expect(players).toHaveLength(0);
  });

  it('plays H.265 where the browser can decode it', async () => {
    list.current = [row({ format: 'H.265', h265: true })];
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true });
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(players).toHaveLength(1);
  });

  const failWith = async (code: number) => {
    list.current = [row()];
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    await act(() => {
      players[0]?.handlers.get('error')?.('NetworkError', 'HttpStatusCodeInvalid', { code, msg: 'x' });
      return vi.advanceTimersByTimeAsync(0);
    });
  };

  it('says "Too many viewers" for a 503 and tries again after 2 s', async () => {
    await failWith(503);
    expect(screen.getByText('Too many viewers. Trying again.')).toBeDefined();
    expect(players).toHaveLength(1);
    expect(players[0]?.destroyed).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(players).toHaveLength(2);
  });

  it('says "You may not watch this stream" for a 403 and does not try again', async () => {
    await failWith(403);
    expect(screen.getByText('You may not watch this stream.')).toBeDefined();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(players).toHaveLength(1);
  });

  it('says "The stream has stopped" for a 404 and keeps trying', async () => {
    await failWith(404);
    expect(screen.getByText('The stream has stopped.')).toBeDefined();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await act(() => {
      players[1]?.handlers.get('error')?.('NetworkError', 'HttpStatusCodeInvalid', { code: 404, msg: 'x' });
      return vi.advanceTimersByTimeAsync(2000);
    });
    expect(players).toHaveLength(3);
  });

  it('plays again within 5 s after the response ended, as when the link restarted', async () => {
    list.current = [row()];
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    await act(() => {
      players[0]?.handlers.get('loading_complete')?.();
      return vi.advanceTimersByTimeAsync(0);
    });
    expect(players[0]?.destroyed).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(players).toHaveLength(2);
    await act(() => {
      players[1]?.handlers.get('media_info')?.({});
      return vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText('The video stopped. Trying again.')).toBeNull();
  });

  it('follows a restarted link that got a new id (settings sent without the ids): the same window plays the new stream', async () => {
    list.current = [row({ link: 'old-id', stream: 'old-id' }), row({ link: 'other', name: 'FMV link 2', stream: 'other' })];
    await shown();
    fireEvent.click(screen.getAllByRole('button', { name: 'Watch' })[0] as HTMLElement);
    const window = screen.getByRole('dialog', { name: 'MQ-9 Reaper' });
    expect(players.map((p) => p.source.url.split('/').pop())).toEqual(['old-id']);

    // The restart: ECore ends the old stream's response, the old link is gone at once, and its new one
    // lists no row until its video is chosen.
    await act(() => {
      players[0]?.handlers.get('loading_complete')?.();
      return vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('The video stopped. Trying again.')).toBeDefined();
    list.current = [row({ link: 'other', name: 'FMV link 2', stream: 'other' })];
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('dialog', { name: 'MQ-9 Reaper' }), 'the window stays').toBe(window);
    expect(screen.getByText('The stream has stopped.')).toBeDefined();
    expect(players[0]?.destroyed).toBe(true);

    list.current = [row({ link: 'other', name: 'FMV link 2', stream: 'other' }), row({ link: 'new-id', stream: 'new-id' })];
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('dialog', { name: 'MQ-9 Reaper' }), 'the same window').toBe(window);
    expect(screen.getAllByRole('dialog'), 'not another window').toHaveLength(1);
    expect(players.map((p) => p.source.url.split('/').pop())).toEqual(['old-id', 'new-id']);
    expect(players[1]?.destroyed).toBe(false);
    expect(screen.queryByText('The stream has stopped.')).toBeNull();

    // The new stream plays (no media info from mpegts.js, as seen live): the old note goes.
    const clock = { time: 0 };
    Object.defineProperty(window.querySelector('video'), 'currentTime', { configurable: true, get: () => clock.time });
    clock.time = 0.8;
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.queryByRole('status'), 'no note while it plays').toBeNull();

    // Watch on the new row shows the window it already has.
    fireEvent.click(screen.getAllByRole('button', { name: 'Watch' })[1] as HTMLElement);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('shows the delay behind live, and none when the play position is past the buffer (seen live, a stopped output link)', async () => {
    list.current = [row()];
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    const element = document.querySelector('video') as HTMLVideoElement;
    const at = { time: 10, end: 10.5 };
    Object.defineProperty(element, 'currentTime', { configurable: true, get: () => at.time });
    Object.defineProperty(element, 'buffered', { configurable: true, get: () => ({ length: 1, start: () => 0, end: () => at.end }) });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText('0.5 s behind live')).toBeDefined();
    at.time = 34.6; // the player was opened again after a stall, and its position ran past the old buffer
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText('no delay measured')).toBeDefined();
    expect(screen.queryByText(/-[\d.]+ s behind live/)).toBeNull();
  });

  it('keeps a renamed link\'s window (its id kept), and a removed link\'s window says the stream has stopped', async () => {
    list.current = [row()];
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    list.current = [row({ name: 'Renamed' })];
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(players).toHaveLength(1);
    expect(players[0]?.destroyed).toBe(false);
    list.current = [];
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getByRole('dialog', { name: 'MQ-9 Reaper' })).toBeDefined();
    expect(screen.getByText('The stream has stopped.')).toBeDefined();
    list.current = [row({ link: 'x', name: 'FMV link 1' })];
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(players, 'a new link with the old name is not the renamed one').toHaveLength(1);
  });

  describe('when the decoder gives up on a damaged frame', () => {
    const watching = async () => {
      list.current = [row()];
      await shown();
      fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      return document.querySelector('video.fmv-window-video');
    };

    it('makes a new player on the same element at once when it had played for a while', async () => {
      const first = await watching();
      await act(() => vi.advanceTimersByTimeAsync(5000));
      let destroyedInItsOwnHandler = true;
      await act(() => {
        players[0]?.handlers.get('error')?.('MediaError', 'MediaMSEError', { msg: 'appendBuffer' });
        destroyedInItsOwnHandler = players[0]?.destroyed ?? true; // mpegts.js still runs after its handler returns
        return vi.advanceTimersByTimeAsync(10);
      });
      expect(destroyedInItsOwnHandler).toBe(false);
      expect(players[0]?.destroyed).toBe(true);
      expect(players).toHaveLength(2);
      expect(document.querySelector('video.fmv-window-video')).toBe(first);
      expect(screen.queryByText('The video stopped. Trying again.')).toBeNull();
      expect(players[1]?.source.url).toBe(players[0]?.source.url);
    });

    it('also recovers from the error event of the video element itself, once', async () => {
      const first = await watching();
      await act(() => vi.advanceTimersByTimeAsync(5000));
      await act(() => {
        first?.dispatchEvent(new Event('error'));
        // mpegts.js's own error follows the element's: the player is already gone
        players[0]?.handlers.get('error')?.('MediaError', 'MediaMSEError', { msg: 'appendBuffer' });
        return vi.advanceTimersByTimeAsync(10);
      });
      expect(players).toHaveLength(2);
    });

    it('waits 0.5 s when the new player fails at once too, and says so', async () => {
      await watching();
      await act(() => {
        players[0]?.handlers.get('error')?.('MediaError', 'MediaMSEError', { msg: 'appendBuffer' });
        return vi.advanceTimersByTimeAsync(0);
      });
      expect(players).toHaveLength(1);
      expect(screen.getByText('The video stopped. Trying again.')).toBeDefined();
      await act(() => vi.advanceTimersByTimeAsync(499));
      expect(players).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(players).toHaveLength(2);
    });

    /** A video element that says it plays, with a time the test sets. */
    const playingAt = (element: Element | null, clock: { time: number }) => {
      Object.defineProperty(element, 'currentTime', { configurable: true, get: () => clock.time });
      Object.defineProperty(element, 'paused', { configurable: true, get: () => false });
    };

    it('gives a video that has played and then stands still for 6 s a new player, as after a jump back of the timestamps', async () => {
      const first = await watching();
      const clock = { time: 1 };
      playingAt(first, clock);
      await act(() => vi.advanceTimersByTimeAsync(3000));
      clock.time = 2; // it plays on for a while
      await act(() => vi.advanceTimersByTimeAsync(3000));
      expect(players).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(7000)); // and then no new time
      expect(players[0]?.destroyed).toBe(true);
      expect(players).toHaveLength(2);
      expect(document.querySelector('video.fmv-window-video')).toBe(first);
    });

    it('leaves a video that has not played yet, or plays, alone', async () => {
      const first = await watching();
      const clock = { time: 0 };
      playingAt(first, clock);
      await act(() => vi.advanceTimersByTimeAsync(20_000)); // never started: waiting for the stream
      expect(players).toHaveLength(1);
      for (let i = 1; i <= 20; i++) {
        clock.time = i; // plays
        await act(() => vi.advanceTimersByTimeAsync(1000));
      }
      expect(players).toHaveLength(1);
    });

    it('does not take a network error for a decoder error: it keeps the element and waits 2 s', async () => {
      const first = await watching();
      await act(() => vi.advanceTimersByTimeAsync(5000));
      await act(() => {
        players[0]?.handlers.get('error')?.('NetworkError', 'HttpStatusCodeInvalid', { code: 503, msg: 'x' });
        return vi.advanceTimersByTimeAsync(0);
      });
      expect(players).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(players).toHaveLength(2);
      expect(document.querySelector('video.fmv-window-video')).toBe(first);
    });
  });

  it('does not try again once it is closed', async () => {
    list.current = [row()];
    await shown();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    await act(() => {
      players[0]?.handlers.get('loading_complete')?.();
      return vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(players).toHaveLength(1);
  });
});

describe('offline (criterion 19)', () => {
  it('loads nothing from the internet: the player is a bundled import and the only request is to the server part', async () => {
    list.current = [row()];
    const { ctx } = await shown();
    for (const call of fetchMock.mock.calls as unknown as string[][]) expect(call[0]?.startsWith(ctx.serverBase)).toBe(true);
  });
});
