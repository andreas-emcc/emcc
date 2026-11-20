// Quick run: @streams @live
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/live/streams.spec.ts
import { expect, test } from '@playwright/test';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installTestPlugin } from '../../lib/test-plugins.mjs';

// The streams to a plugin's web part (SDK 1.8.0 part E1, CR-0044, ADR-0057 point 5; T-208):
// GET /api/plugins/{id}/stream/{name}, over HTTP against a server of the test's own without login
// (where the user has every permission; 401 and 403 are specs/keycloak/streams.spec.ts). The
// ITA's test plugin ita-stream (fixtures/plugins/ita-stream) opens the streams `feed` (video/mp2t)
// and `other` and writes chunks on request: each chunk one character repeated, so that what a
// viewer got shows which chunks it got, in which order. The rules are the server's README
// ("Streams to the web part"): 405 with Allow: GET, 404, 503 with Retry-After: 5 past the viewer
// limits, else 200 at once and chunked: the header, the start buffer (the chunks since the last
// start point), then the live chunks; a viewer whose queue passes 4 MiB loses it and resumes at the
// next start point, header first; chunks past 50 Mbit/s in a second are dropped; the monitor counts
// each stream.

test.describe.configure({ timeout: 120_000 });

const KiB = 1024;
const PLUGIN = 'ita-stream';

const streamUrl = (server: OwnServer, name: string) => `${server.baseUrl}/api/plugins/${PLUGIN}/stream/${name}`;

/** Asks the test plugin to write `count` chunks of `size` bytes of `fill` (the first a start point when `start`); its counts back. */
async function write(server: OwnServer, fill: string, { start = false, size = 100, count = 1, stream = 'feed' } = {}) {
  const response = await fetch(`${server.baseUrl}/api/plugins/${PLUGIN}/write?stream=${stream}&fill=${fill}&start=${start}&size=${size}&count=${count}`);
  expect(response.status, 'the write endpoint').toBe(200);
  const [accepted, dropped, closed] = (await response.text()).split(' ').map(Number);
  return { accepted, dropped, closed };
}

async function plugin(server: OwnServer, path: string): Promise<string> {
  const response = await fetch(`${server.baseUrl}/api/plugins/${PLUGIN}${path}`);
  expect(response.status, path).toBe(200);
  return response.text();
}

type MonitorStream = { name: string; mediaType: string; viewers: number; bytesIn: number; bytesOut: number; dropped: number; losses: number; startBufferBytes: number };

async function monitorStreams(server: OwnServer): Promise<Record<string, MonitorStream>> {
  const monitor = await (await fetch(`${server.baseUrl}/api/monitor`)).json();
  const own = (monitor.plugins as Array<{ id: string; streams: MonitorStream[] }>).find((p) => p.id === PLUGIN)!;
  return Object.fromEntries(own.streams.map((s) => [s.name, s]));
}

/**
 * A viewer: the response once its headers came, and what its body brought, as text (one character
 * per byte). It reads only while `reading`; `ended` resolves when the server ends the body.
 */
async function viewer(server: OwnServer, name = 'feed') {
  const abort = new AbortController();
  const started = Date.now();
  const response = await fetch(streamUrl(server, name), { signal: abort.signal });
  const headersMs = Date.now() - started;
  const state = { text: '', bytes: 0, reading: true, keep: true, ended: false };
  const counts = new Map<string, number>();
  let wake: () => void = () => {};
  const ended = (async () => {
    if (response.status !== 200 || !response.body) return;
    const reader = response.body.getReader();
    try {
      for (;;) {
        while (!state.reading) await new Promise<void>((resolve) => (wake = resolve));
        const { done, value } = await reader.read();
        if (done) break;
        state.bytes += value.length;
        const chunk = Buffer.from(value).toString('latin1');
        for (const c of new Set(chunk)) counts.set(c, (counts.get(c) ?? 0) + chunk.split(c).length - 1);
        if (state.keep) state.text += chunk;
      }
    } catch {
      // aborted by the test
    }
    state.ended = true;
  })();
  return {
    response,
    headersMs,
    state,
    counts,
    ended,
    pause: () => { state.reading = false; },
    resume: () => { state.reading = true; wake(); },
    close: () => { abort.abort(); },
    /** Waits until the body brought `bytes` in all. */
    async has(bytes: number, timeout = 10_000) {
      await expect.poll(() => state.bytes, { timeout, message: `${bytes} bytes` }).toBeGreaterThanOrEqual(bytes);
    },
  };
}

/** Runs of one character: "HDR!" then A×100 then a×200 gives ['H1','D1','R1','!1','A100','a200']. */
function runs(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; ) {
    let j = i;
    while (j < text.length && text[j] === text[i]) j++;
    out.push(`${text[i]}${j - i}`);
    i = j;
  }
  return out;
}

const HEADER = ['H1', 'D1', 'R1', '!1'];

test('a viewer gets 200 at once, chunked, with the stream\'s type, no-store and nosniff; the header and the chunks since the last start point come first for a late joiner, then the live chunks', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, PLUGIN);
    const server = await start();

    // 200 at once on a stream nothing was written to yet.
    const first = await viewer(server);
    testInfo.annotations.push({ type: 'headers after', description: `${first.headersMs} ms` });
    expect(first.response.status).toBe(200);
    expect(first.headersMs, 'at once, before any data').toBeLessThan(2_000);
    expect(first.response.headers.get('content-type'), "the stream's type").toBe('video/mp2t');
    expect(first.response.headers.get('cache-control')).toBe('no-store');
    expect(first.response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(first.response.headers.get('transfer-encoding'), 'chunked').toBe('chunked');
    const other = await viewer(server, 'other');
    expect(other.response.headers.get('content-type'), "the other stream's type").toBe('application/octet-stream');
    other.close();

    // The header, then start points A and B with their chunks.
    await plugin(server, '/header?stream=feed&text=HDR!');
    const early = await viewer(server);
    await write(server, 'A', { start: true });
    await write(server, 'a', { count: 2 });
    await write(server, 'B', { start: true });
    await write(server, 'b');
    // The late joiner: the header and the chunks since B, then the live chunk C.
    const late = await viewer(server);
    await late.has(4 + 200);
    await write(server, 'c');
    await late.has(4 + 300);
    await early.has(4 + 600);
    testInfo.annotations.push({ type: 'late joiner', description: runs(late.state.text).join(' ') });
    testInfo.annotations.push({ type: 'early viewer', description: runs(early.state.text).join(' ') });
    expect(runs(late.state.text), 'the late joiner: the header, from the last start point, then live').toEqual([...HEADER, 'B100', 'b100', 'c100']);
    expect(runs(early.state.text), 'a viewer from before: the header, then every chunk').toEqual([...HEADER, 'A100', 'a200', 'B100', 'b100', 'c100']);
    // A viewer from before any start point starts at the first one, header first.
    expect(runs(first.state.text), 'the first viewer, from before any start point: the header at the first start point, then every chunk').toEqual([...HEADER, 'A100', 'a200', 'B100', 'b100', 'c100']);
    expect(Number(await plugin(server, '/viewers?stream=feed')), "the plugin's count").toBe(3);

    for (const v of [first, early, late]) v.close();
    await stopOwnServer(server);
  });
});

test('another method gets 405 with Allow: GET, a name that is not open or another path under /stream 404, and a closed stream 404 while its viewers\' responses end', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, PLUGIN);
    const server = await start();
    const url = streamUrl(server, 'feed');

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const response = await fetch(url, { method, headers: { Origin: server.baseUrl } });
      expect(response.status, `${method}: 405`).toBe(405);
      expect(response.headers.get('allow'), `${method}: Allow`).toBe('GET');
    }
    for (const path of ['nope', 'feed/more', 'Feed']) {
      const response = await fetch(`${server.baseUrl}/api/plugins/${PLUGIN}/stream/${path}`);
      expect(response.status, `${path}: 404`).toBe(404);
      await response.body?.cancel();
    }
    const unknown = await fetch(`${server.baseUrl}/api/plugins/no-such-plugin/stream/feed`);
    expect(unknown.status, 'a plugin that is not installed: 404').toBe(404);

    // Closed: its viewer's response ends, a new viewer gets 404; opened again, 200.
    const watching = await viewer(server, 'other');
    expect(watching.response.status).toBe(200);
    await plugin(server, '/close?stream=other');
    await expect.poll(() => watching.state.ended, { timeout: 10_000, message: "the viewer's response ends with the stream" }).toBe(true);
    const closed = await fetch(streamUrl(server, 'other'));
    expect(closed.status, 'a closed stream: 404').toBe(404);
    await plugin(server, '/open?stream=other');
    const again = await viewer(server, 'other');
    expect(again.response.status, 'opened again: 200').toBe(200);
    again.close();
    await stopOwnServer(server);
  });
});

test('past the viewer limits a viewer gets 503 with Retry-After: 5, per stream and in all; a viewer that went away frees its place', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, PLUGIN);
    // Lowered from 8 per stream and 32 in all (emc2.streams.*).
    const server = await start(['--emc2.streams.viewers-per-stream=2', '--emc2.streams.viewers=3']);
    const feed = [await viewer(server), await viewer(server)];
    for (const v of feed) expect(v.response.status, 'two on feed').toBe(200);
    const third = await fetch(streamUrl(server, 'feed'));
    expect(third.status, 'a third on feed: 503').toBe(503);
    expect(third.headers.get('retry-after'), 'Retry-After').toBe('5');
    const other = await viewer(server, 'other');
    expect(other.response.status, 'one on other: the third in all').toBe(200);
    const fourth = await fetch(streamUrl(server, 'other'));
    expect(fourth.status, 'a fourth in all: 503').toBe(503);
    expect(fourth.headers.get('retry-after')).toBe('5');

    // One goes away; the next write finds it gone, and a new viewer gets its place. These viewers came
    // before any start point, so they wait for one: the writes are start points.
    feed[0].close();
    await expect
      .poll(async () => {
        await write(server, 'x', { start: true });
        const response = await fetch(streamUrl(server, 'feed'));
        await response.body?.cancel();
        return response.status;
      }, { timeout: 15_000, intervals: [500], message: 'a new viewer in the freed place' })
      .toBe(200);
    for (const v of [feed[1], other]) v.close();
    await stopOwnServer(server);
  });
});

test('a slow viewer loses its queue past 4 MiB and resumes at the next start point, header first, while a fast one gets every chunk; the monitor counts the loss', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, PLUGIN);
    const server = await start();
    await plugin(server, '/header?stream=feed&text=HDR!');
    await write(server, 'A', { start: true, size: 64 * KiB });
    const slow = await viewer(server);
    const fast = await viewer(server);
    fast.state.keep = false; // counted only
    await slow.has(4 + 64 * KiB);
    slow.pause();

    // 24 MiB of a, 0.75 MiB five times a second (about 31 Mbit/s, well under the 50 Mbit/s cap even when two
    // writes come close), while the slow one reads nothing.
    let dropped = 0;
    const began = Date.now();
    for (let i = 0; i < 32; i++) {
      dropped += (await write(server, 'a', { size: 64 * KiB, count: 12 })).dropped;
      const wait = began + (i + 1) * 200 - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    expect(dropped, 'nothing dropped under the rate').toBe(0);
    await expect.poll(async () => (await monitorStreams(server)).feed.losses, { timeout: 15_000, message: 'the slow viewer lost its queue' }).toBeGreaterThanOrEqual(1);
    await write(server, 'B', { start: true, size: 64 * KiB });
    await write(server, 'b', { size: 64 * KiB });

    slow.resume();
    await expect.poll(() => slow.state.text.endsWith('b'.repeat(64 * KiB)), { timeout: 20_000, message: 'the slow viewer reached the end' }).toBe(true);
    const got = runs(slow.state.text);
    testInfo.annotations.push({ type: 'slow viewer', description: got.join(' ') });
    const resumed = slow.state.text.lastIndexOf('HDR!');
    expect(resumed, 'the header again after the loss').toBeGreaterThan(0);
    expect(runs(slow.state.text.slice(resumed)), 'resumed at the next start point, header first').toEqual([...HEADER, `B${64 * KiB}`, `b${64 * KiB}`]);
    expect(/^[a]*$/.test(slow.state.text.slice(4 + 64 * KiB, resumed)), 'before it, only a').toBe(true);
    expect(slow.state.text.slice(4 + 64 * KiB, resumed).length, 'it lost some of the a').toBeLessThan(24 * 1024 * KiB);

    await fast.has(4 + 3 * 64 * KiB + 24 * 1024 * KiB, 20_000);
    expect(Object.fromEntries(fast.counts), 'the fast viewer: every chunk').toEqual({ H: 1, D: 1, R: 1, '!': 1, A: 64 * KiB, a: 24 * 1024 * KiB, B: 64 * KiB, b: 64 * KiB });
    const feed = (await monitorStreams(server)).feed;
    testInfo.annotations.push({ type: 'monitor', description: JSON.stringify(feed) });
    expect(feed.losses, 'one loss, the slow viewer\'s').toBe(1);
    for (const v of [slow, fast]) v.close();
    await stopOwnServer(server);
  });
});

test('the monitor lists each open stream: viewers, bytes in and out, the start buffer, and the chunks dropped past 50 Mbit/s in a second', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, PLUGIN);
    const server = await start();
    const before = await monitorStreams(server);
    expect(Object.keys(before).sort(), 'both open streams').toEqual(['feed', 'other']);
    expect(before.feed, 'nothing yet').toMatchObject({ mediaType: 'video/mp2t', viewers: 0, bytesIn: 0, bytesOut: 0, dropped: 0, losses: 0, startBufferBytes: 0 });
    expect(before.other.mediaType).toBe('application/octet-stream');

    const watching = await viewer(server);
    await write(server, 'A', { start: true, size: 1_000 });
    await write(server, 'a', { size: 500, count: 2 });
    await watching.has(2_000);
    await expect.poll(async () => (await monitorStreams(server)).feed, { timeout: 5_000, message: 'counted' }).toMatchObject({ viewers: 1, bytesIn: 2_000, bytesOut: 2_000, startBufferBytes: 2_000, dropped: 0 });
    await write(server, 'B', { start: true, size: 300 });
    await expect.poll(async () => (await monitorStreams(server)).feed.startBufferBytes, { message: 'the start buffer from B' }).toBe(300);

    // 8 MiB in one go: past 50 Mbit/s (6.25 MB) in the second, the rest is dropped and counted.
    const burst = await write(server, 'x', { size: 64 * KiB, count: 128 });
    testInfo.annotations.push({ type: 'burst of 128 chunks of 64 KiB', description: JSON.stringify(burst) });
    expect(burst.dropped, 'dropped past the rate').toBeGreaterThan(0);
    expect(burst.accepted * 64 * KiB * 8, 'what was accepted fits 50 Mbit in the second').toBeLessThanOrEqual(50_000_000 + 64 * KiB * 8);
    const after = (await monitorStreams(server)).feed;
    testInfo.annotations.push({ type: 'monitor', description: JSON.stringify(after) });
    expect(after.dropped, "the monitor's count").toBe(burst.dropped);
    expect(after.bytesIn, 'bytes in: the accepted chunks').toBe(2_300 + burst.accepted * 64 * KiB);
    watching.close();
    await expect.poll(async () => { await write(server, 'y', { start: true }); return (await monitorStreams(server)).feed.viewers; }, { timeout: 15_000, intervals: [1_000], message: 'the viewer gone' }).toBe(0);
    await stopOwnServer(server);
  });
});
