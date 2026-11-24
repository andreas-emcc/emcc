// Quick run: @plugin-fmv @streams
// Quick run of this file alone (needs the ESA's FMV replay with two of its recordings, see below):
//   node external/fmv/start.mjs --only day-flight,day-h264,day-mpeg2
//   node tests/integration/run.mjs --skip-build -- specs/external/fmv-replay.spec.ts
import { createSocket } from 'node:dgram';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { inverse } from '../../lib/geodesy.mjs';
import { withM0 } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';

// fmv end to end with the ESA's FMV replay (T-209; the fmv brief's criteria 1, 5, 6, 11, 15, 16,
// 17, 19 and 20; external/fmv/README.md). Two of its recordings come as UDP on loopback, one `udp`
// link each:
// - day-flight to 127.0.0.1:14609, the public sample "Day Flight.mpg" (H.264 1280 x 720 with ST 0601
//   KLV, 6 sets in a 200 s round), for its metadata: the camera and its arc on the map. Its video is
//   damaged in parts (external/fmv/loop-check.md), so nothing here plays it.
// - day-h264 to 127.0.0.1:14611, the same flight's first 60 s as clean H.264 1280 x 720 (the ACA's
//   S9 conversion), for everything that plays: GET /streams, the FMV panel's row, and Watch in a
//   floating window through a whole round and the replay's (seamless) loop wrap, through a broken
//   stretch that the test sends into the link itself, through a link restart, and the close.
// The window runs in an installed Edge (or Chrome): Playwright's own Chromium is not the browser
// users have, and the brief's live check names the installed ones. The browser runs headless (H.264
// decodes there; the brief's "visible window" is the PCA's live check of frame drops). About 3 to 4
// minutes, most of it waiting for day-flight's first KLV set and a round of day-h264.
//
// The replay is the ESA's (external/fmv): the test only listens to it, and sends nothing but the
// broken stretch, to its own link. It is skipped, with the reason, when nothing arrives on 14609 or
// 14611 within 5 s, or without an installed Edge or Chrome. When another emcc listens on those ports,
// the replay can send to two targets each (--udp day-flight=127.0.0.1:14619 and so on) and
// EMC2_FMV_PORT and EMC2_FMV_CLEAN_PORT name the test's.
// MPEG-2 (T-211): day-mpeg2 (14610, or EMC2_FMV_MPEG2_PORT) through a third link, converted by
// ECore's ffmpeg named by EMC2_FMV_FFMPEG (the owner chose S9's ffmpeg 9.0; without it that test is
// skipped), and once with a converter that is not there. Both are skipped without day-mpeg2.

test.describe.configure({ timeout: 600_000 });

/** day-flight, for the metadata; EMC2_FMV_PORT for another target of the replay (e.g. when an other emcc holds the default). */
const PORT = Number(process.env.EMC2_FMV_PORT ?? 14609);
const LINK = 'ITA FMV';
const STREAM = 'ita-fmv'; // the objects' data source: the link's key, its name in lower case, other characters as hyphens
/** day-h264, for the video; EMC2_FMV_CLEAN_PORT likewise. */
const CLEAN_PORT = Number(process.env.EMC2_FMV_CLEAN_PORT ?? 14611);
const CLEAN_LINK = 'ITA H264';
/** A stream's name is its link's id (CR-0047): a UUID v7 in lower case, which ECore fills in. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** day-mpeg2, the same 60 s as MPEG-2, for ECore's conversion (T-211); EMC2_FMV_MPEG2_PORT likewise. */
const MPEG2_PORT = Number(process.env.EMC2_FMV_MPEG2_PORT ?? 14610);
const MPEG2_LINK = 'ITA MPEG2';
/** The converter for the MPEG-2 test that converts (owner, 2026-11-15: S9's ffmpeg 9.0); without it that test is skipped. */
const FFMPEG = process.env.EMC2_FMV_FFMPEG;
/** The video PID of day-h264 (external/fmv/README.md). */
const CLEAN_VIDEO_PID = 256;
const SIDC = '10030100001103002000'; // the default: a UAV with photographic reconnaissance, friend
/**
 * day-flight's KLV is sparse: 6 sets in a 200 s round, in two bunches (4 within 21 s, 2 within 11 s
 * about 80 s later). The next set may be up to 86 s away once the replay runs, but more just after
 * it starts: a whole round (200.25 s) and a little is safe.
 */
const FIRST_SET_MS = 205_000;
/** One round of day-h264, 60.03 s, and a little: its loop wrap always falls in it. */
const CLEAN_ROUND_MS = 65_000;
/** The broken stretch the test sends, and how soon after it the window must play again. */
const BROKEN_MS = 3_000;
const RECOVERY_MS = 5_000;

type Row = {
  link: string; name: string; title: string; stream?: string; format: string; playable: boolean; h265: boolean;
  width?: number; height?: number; bitRate: number; lastSet?: string; state: string; message?: string; label: string;
};
type State = Record<string, any>;
type Event = { entityType: string; entityId: string; operation: string; state: State | null };

/** Whether the replay sends to the port: one datagram of whole 188-byte packets within `ms`. */
function replaySends(port: number, ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const done = (reason: string | null) => {
      clearTimeout(timer);
      socket.close();
      resolve(reason);
    };
    const timer = setTimeout(() => done(`nothing arrived on 127.0.0.1:${port} within ${ms} ms: start the ESA's FMV replay (node external/fmv/start.mjs --only day-flight,day-h264)`), ms);
    socket.on('error', (error) => done(`127.0.0.1:${port} cannot be listened on: ${error.message}`));
    socket.on('message', (datagram) => done(datagram.length % 188 === 0 && datagram[0] === 0x47 ? null : `a datagram on ${port} that is not a transport stream (${datagram.length} bytes)`));
    socket.bind(port, '127.0.0.1');
  });
}

/**
 * A broken stretch into a link, `ms` long, between the replay's own datagrams: every 5 ms a datagram
 * of 7 packets on the video PID, each starting a PES whose payload is an IDR slice's start code and
 * then noise, with counters that jump: the stream is broken as a lossy radio link breaks it.
 * Resolves with the datagrams sent.
 */
async function sendBroken(port: number, pid: number, ms: number): Promise<number> {
  const socket = createSocket('udp4');
  let seed = 4609;
  const noise = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16 & 0xff;
  let sent = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const datagram = Buffer.alloc(7 * 188);
    for (let i = 0; i < 7; i++) {
      const p = datagram.subarray(i * 188, (i + 1) * 188);
      for (let j = 4; j < 188; j++) p[j] = noise();
      p[0] = 0x47;
      p[1] = 0x40 | (pid >> 8); // the start of a payload unit
      p[2] = pid & 0xff;
      p[3] = 0x10 | (noise() & 0x0f); // payload only; a counter that jumps
      Buffer.from([0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5, 0x21, 0, 1, 0, 1, 0, 0, 0, 1, 0x65]).copy(p, 4);
    }
    await new Promise<void>((resolve, reject) => socket.send(datagram, port, '127.0.0.1', (error) => (error ? reject(error) : resolve())));
    sent++;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  socket.close();
  return sent;
}

/** An installed Edge, else Chrome; null when neither is. */
async function installedBrowser(): Promise<Browser | null> {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel });
    } catch {
      // not installed
    }
  }
  return null;
}

async function streams(server: OwnServer): Promise<Row[]> {
  const response = await fetch(`${server.baseUrl}/api/plugins/fmv/streams`);
  expect(response.status).toBe(200);
  return response.json();
}

async function setLinks(server: OwnServer, links: unknown[]): Promise<void> {
  const url = `${server.baseUrl}/api/settings/plugins/fmv`;
  const { values } = await (await fetch(url)).json();
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, links }) });
  expect(put.status, await put.text()).toBe(200);
}

async function viewers(server: OwnServer, stream: string): Promise<number | undefined> {
  const monitor = await (await fetch(`${server.baseUrl}/api/monitor`)).json();
  const fmv = (monitor.plugins as Array<{ id: string; streams?: Array<{ name: string; viewers: number }> }>).find((p) => p.id === 'fmv');
  return fmv?.streams?.find((s) => s.name === stream)?.viewers;
}

/** The newest state of each object of a data type from day-flight's link, from the live picture's events. */
function latest(events: Event[], dataType: string): Map<string, State> {
  const byId = new Map<string, State>();
  for (const e of events) {
    if (e.entityType !== 'object') continue;
    if (e.state === null) byId.delete(e.entityId);
    else if (e.state.dataType === dataType && e.state.dataSource === STREAM) byId.set(e.entityId, e.state);
  }
  return byId;
}

/** The difference of two bearings, -180 to 180. */
function turn(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The video element's state in the window. */
async function playing(page: Page) {
  return page.locator('video.fmv-window-video').evaluate((v: HTMLVideoElement) => ({ time: v.currentTime, width: v.videoWidth, height: v.videoHeight, frames: v.getVideoPlaybackQuality().totalVideoFrames, dropped: v.getVideoPlaybackQuality().droppedVideoFrames }));
}

/** Times every frame the window's video shows from now on (the callbacks outlive a new player). */
async function timeFrames(page: Page): Promise<{ from: number; frames: () => Promise<number[]>; now: () => Promise<number> }> {
  const from = await page.locator('video.fmv-window-video').evaluate((v: HTMLVideoElement) => {
    const w = window as unknown as { itaFrames: number[]; itaStep?: boolean };
    w.itaFrames = [];
    if (!w.itaStep) {
      w.itaStep = true;
      const step = (now: number) => {
        w.itaFrames.push(now);
        v.requestVideoFrameCallback(step);
      };
      v.requestVideoFrameCallback(step);
    }
    return performance.now();
  });
  return {
    from,
    frames: () => page.evaluate(() => (window as unknown as { itaFrames: number[] }).itaFrames),
    now: () => page.evaluate(() => performance.now()),
  };
}

/** The longest pause between two shown frames from `from` on, and where. */
function longestPause(from: number, frames: number[]): { ms: number; at: number } {
  const shown = [from, ...frames];
  const pauses = shown.slice(1).map((t, i) => t - shown[i]);
  const ms = Math.max(...pauses);
  return { ms, at: shown[pauses.indexOf(ms)] - from };
}

let browser: Browser | null = null;
let skipReason: string | null = null;
/** Why the MPEG-2 tests are skipped: no day-mpeg2 on its port, or no browser. */
let mpeg2Skip: string | null = null;

test.beforeAll(async () => {
  // 5 s: a worker restarted after a failure may start while the last test's server still lets go of the port.
  const reasons = await Promise.all([replaySends(PORT, 5_000), replaySends(CLEAN_PORT, 5_000)]);
  skipReason = reasons.find((r) => r !== null) ?? null;
  mpeg2Skip = await replaySends(MPEG2_PORT, 5_000);
  if (skipReason !== null && mpeg2Skip !== null) return;
  browser = await installedBrowser();
  if (browser === null) skipReason = mpeg2Skip = 'neither an installed Edge nor Chrome (Playwright channels msedge, chrome)';
});

test.afterAll(async () => {
  await browser?.close();
});

test('the replay through two udp links: day-flight\'s camera at the sensor and its arc to the frame centre; day-h264 in GET /streams and the FMV panel, and Watch plays it in a window through a whole round and the loop wrap, again within 5 s after a broken stretch and after the link restarts, and frees its viewer when closed', async ({}, testInfo) => {
  test.skip(skipReason !== null, skipReason ?? '');
  // The window's player logs its errors; the ones in the broken stretch are expected there, the
  // others are counted below (and the test's own listener asserts them).
  await withM0(testInfo, browser!, async ({ server, live, open }) => {
    const links = [{ name: LINK, mode: 'udp', port: PORT }, { name: CLEAN_LINK, mode: 'udp', port: CLEAN_PORT }];
    await setLinks(server, links);

    // GET /streams: each link's row once its program is chosen, H.264 1280 x 720 at its rate.
    const rowOf = async (name: string) => (await streams(server)).find((r) => r.name === name);
    let row: Row | undefined;
    for (const [name, mbits] of [[LINK, 4.08], [CLEAN_LINK, 4.2]] as const) {
      await expect.poll(async () => (await rowOf(name))?.format, { timeout: 15_000, message: `${name}'s row in GET /streams` }).toBe('H.264');
      await expect.poll(async () => (row = await rowOf(name))?.bitRate ?? 0, { timeout: 15_000, message: `${name}: a bit rate over 5 s` }).toBeGreaterThan(3_000_000);
      expect(row).toMatchObject({ name, stream: expect.stringMatching(UUID_V7), format: 'H.264', playable: true, h265: false, width: 1280, height: 720 });
      expect(row!.bitRate, `the recording is ${mbits} Mbit/s`).toBeLessThan(5_500_000);
      testInfo.annotations.push({ type: `GET /streams, ${name}`, description: JSON.stringify(row) });
    }
    const clean = row!;

    // day-flight's camera and its arc, once its first ST 0601 set came.
    await expect.poll(() => latest(live.events as Event[], 'fmv.field-of-view').size, { timeout: FIRST_SET_MS, message: 'the camera\'s field of view after the first set' }).toBe(1);
    const cameras = latest(live.events as Event[], 'fmv.camera');
    expect(cameras.size, 'one camera').toBe(1);
    const [[cameraId, camera]] = [...cameras];
    const [arc] = [...latest(live.events as Event[], 'fmv.field-of-view').values()];
    const fmv = camera.extensions.fmv;
    testInfo.annotations.push({ type: 'camera', description: JSON.stringify({ geometry: camera.geometry, symbol: camera.symbol, name: camera.properties.name, fmv }) });
    testInfo.annotations.push({ type: 'field of view', description: JSON.stringify({ geometry: arc.geometry, style: arc.style, relations: arc.relations }) });
    expect(camera).toMatchObject({ type: 'core.symbol', dataSource: STREAM, symbol: { standard: 'APP-6D', sidc: SIDC } });
    const at = camera.geometry.coordinates as [number, number];
    expect(camera.geometry.type).toBe('Point');
    expect(Math.abs(at[0]) <= 180 && Math.abs(at[1]) <= 90 && at[0] !== at[1], `[lon, lat] ${at}`).toBe(true);
    expect(camera.symbol.modifiers.uniqueDesignation, 'the name as the unique designation').toBe(camera.properties.name);
    expect(camera.symbol.modifiers.direction, 'the heading').toEqual(expect.any(Number));
    expect(fmv).toMatchObject({ link: LINK, videoFormat: 'H.264' });

    expect(arc).toMatchObject({ type: 'core.shape', dataSource: STREAM, style: { strokeColor: '#FFD400', strokeWidth: 2, fillOpacity: 0 }, relations: [{ kind: 'fmv.view', objectId: cameraId }] });
    expect(arc.geometry).toMatchObject({ type: 'ArcBand', center: at, innerRadius: 0 });
    const centre: [number, number] = [fmv.frameCenterLongitude, fmv.frameCenterLatitude];
    const [leg] = inverse([[at, centre]]);
    const { startBearing, endBearing, outerRadius } = arc.geometry;
    const width = (endBearing - startBearing + 360) % 360;
    const middle = (startBearing + width / 2) % 360;
    expect(Math.abs(turn(leg.initialAzimuth, middle)), `centred on the bearing to the frame centre ${leg.initialAzimuth}`).toBeLessThan(0.01);
    expect(Math.abs(outerRadius - leg.metres), `reaching the frame centre, ${leg.metres} m`).toBeLessThan(1);
    // Its width is tag 16, which the objects do not carry; tag 17 is in the extension, and the
    // sample's frames are 16:9 (1280 x 720). Its EON sets are about 0.37° wide (S9), its one IR set
    // 26.7° (15.0° high).
    expect(width / fmv.verticalFov, `width ${width}° to height ${fmv.verticalFov}°: 16:9`).toBeCloseTo(16 / 9, 1);
    if (fmv.imageSourceSensor === 'EON') expect(Math.abs(width - 0.37), `EON's horizontal field of view, about 0.37° (${width})`).toBeLessThan(0.01);
    // The sample's tag 18 is the true bearing to the frame centre, within 0.1° (S9, brief section 7).
    expect(Math.abs(turn(fmv.relativeAzimuth, middle)), `tag 18 ${fmv.relativeAzimuth}° as the bearing`).toBeLessThan(0.1);

    // The FMV panel in View: a row per link; day-h264's, and Watch.
    const page = await open();
    const panel = page.getByRole('region', { name: 'FMV', exact: true }).last();
    const options = panel.getByRole('listbox', { name: 'FMV streams' }).getByRole('option');
    await expect(options, 'a row per link').toHaveCount(2);
    await expect(options.filter({ hasText: LINK }), 'day-flight\'s row: its camera\'s name, format, size, bit rate, age of the last set, state, Watch').toHaveAccessibleName(/^ITA FMV H\.264 · 1280 × 720 · [34]\.\d Mbit\/s · \d+ s ago (Live|Stale) Watch$/);
    const listed = options.filter({ hasText: CLEAN_LINK });
    const title = escape(clean.title) + (clean.title === clean.name ? '' : ` ${escape(clean.name)}`);
    // day-h264's sets are sparse too (about 6 in its 60 s round), so its first may not have come yet:
    // then the row says "no metadata". After the round below it must have come (checked there).
    await expect(listed, 'day-h264\'s row').toHaveAccessibleName(new RegExp(`^${title} H\\.264 · 1280 × 720 · [345]\\.\\d Mbit/s · (\\d+ s ago|no metadata) (Live|Stale|Waiting) Watch$`));
    // Every try of the window's player (a request of the stream) and every player error, from Watch on.
    let opened = Date.now();
    const since = (t: number) => `${Math.round((t - opened) / 1000)} s`;
    const tries: number[] = [];
    const playerErrors: Array<{ at: number; text: string }> = [];
    // Any stream's: a restart without the links' ids gives the link a new id, so a new stream name (CR-0047 F2).
    page.on('request', (request) => {
      if (/\/stream\/[0-9a-f-]{36}$/.test(request.url())) tries.push(Date.now());
    });
    page.on('console', (message) => {
      if (message.type() === 'error') playerErrors.push({ at: Date.now(), text: message.text() });
    });
    page.on('pageerror', (error) => playerErrors.push({ at: Date.now(), text: `uncaught ${error.message}` }));
    const errorsIn = (from: number, to = Infinity) => playerErrors.filter((e) => e.at >= from && e.at < to).map((e) => `${since(e.at)}: ${e.text}`);
    const triesIn = (from: number, to = Infinity) => tries.filter((t) => t >= from && t < to);
    opened = Date.now();
    await listed.getByRole('button', { name: 'Watch' }).click();
    const window = page.getByRole('dialog', { name: clean.title });
    await expect(window).toBeVisible();
    await expect.poll(async () => (await playing(page)).width, { timeout: 10_000, message: 'the video has its size' }).toBe(1280);
    testInfo.annotations.push({ type: 'first frame', description: `${Date.now() - opened} ms after Watch` });
    const first = await playing(page);
    await expect.poll(async () => (await playing(page)).time - first.time, { timeout: 10_000, message: 'the video plays' }).toBeGreaterThan(3);
    await expect.poll(() => viewers(server, clean.stream!), { message: 'one viewer' }).toBe(1);
    await expect(window).toContainText(clean.label === '' ? 'Unlabelled' : clean.label);
    await expect(window).toContainText('H.264');
    await page.screenshot({ path: testInfo.outputPath('fmv-window.png') });

    // A whole round of day-h264 (60 s, its seamless loop wrap included) on the one try, without a
    // player error (criterion 20's "no errors"), with no pause in the frames over 1 s.
    const round = await timeFrames(page);
    await page.waitForTimeout(Math.max(0, opened + CLEAN_ROUND_MS - Date.now()));
    const roundEnd = Date.now();
    const roundPause = longestPause(round.from, await round.frames());
    const roundQuality = await playing(page);
    testInfo.annotations.push({ type: 'a whole round', description: `tries at ${tries.map(since).join(', ')}; ${errorsIn(opened).length} errors; the longest pause ${Math.round(roundPause.ms)} ms at ${Math.round(roundPause.at / 1000)} s; ${roundQuality.frames} frames, ${roundQuality.dropped} dropped` });
    expect.soft(tries.length, `a whole round and the wrap on one try (tries at ${tries.map(since).join(', ')} after Watch)`).toBe(1);
    expect.soft(errorsIn(opened), 'player errors in a whole round and the wrap').toEqual([]);
    expect.soft(roundPause.ms, 'the longest pause between two frames in the round').toBeLessThan(1_000);
    // A whole round carries all of day-h264's sets, so emcc has read at least one by now: GET /streams
    // has its time, and the panel's row its age instead of "no metadata".
    const afterRound = await rowOf(CLEAN_LINK);
    testInfo.annotations.push({ type: 'day-h264 after a round', description: JSON.stringify({ lastSet: afterRound?.lastSet, state: afterRound?.state }) });
    expect.soft(afterRound?.lastSet, 'day-h264\'s last set in GET /streams after a whole round').toEqual(expect.any(String));
    await expect.soft(listed, 'day-h264\'s row after a whole round: the age of its last set').toHaveAccessibleName(/ · \d+ s ago (Live|Stale) Watch$/);

    // A broken stretch (criterion 17: the window plays again on its own): 3 s of broken video
    // packets sent into the link between the replay's own. From its end on the window shows frames
    // again within 5 s, and they keep coming.
    const broken = await timeFrames(page);
    const brokenFrom = Date.now();
    const sent = await sendBroken(CLEAN_PORT, CLEAN_VIDEO_PID, BROKEN_MS);
    const brokenTo = Date.now();
    const afterBroken = await broken.now();
    await page.waitForTimeout(RECOVERY_MS + 5_000);
    const brokenFrames = await broken.frames();
    const firstAfter = brokenFrames.find((t) => t >= afterBroken);
    const lastShown = brokenFrames.at(-1) ?? broken.from;
    testInfo.annotations.push({ type: 'the broken stretch', description: `${sent} datagrams in ${brokenTo - brokenFrom} ms; tries from it on at ${triesIn(brokenFrom).map(since).join(', ') || 'none'}; ${errorsIn(brokenFrom).length} errors from it on${errorsIn(brokenFrom).length > 0 ? `, the first: ${errorsIn(brokenFrom)[0]}` : ''}; ${brokenFrames.filter((t) => t < afterBroken).length} frames in it; the first frame after it ${firstAfter === undefined ? 'none' : `${Math.round(firstAfter - afterBroken)} ms`}` });
    expect(firstAfter, 'a frame after the broken stretch').toBeDefined();
    const recovered = longestPause(afterBroken, brokenFrames.filter((t) => t >= afterBroken));
    expect(recovered.ms, `plays again within ${RECOVERY_MS} ms after the broken stretch (the longest pause from its end on, at ${Math.round(recovered.at)} ms)`).toBeLessThan(RECOVERY_MS);
    expect(await broken.now() - lastShown, 'frames still coming').toBeLessThan(1_000);
    await expect.poll(() => viewers(server, clean.stream!), { message: 'one viewer' }).toBe(1);

    // The link restarts (a new listen address, the same port: a reconnect, brief section 4). The
    // window plays on, or plays again within 5 s (criterion 17): the longest pause between two shown
    // frames, from the restart to 15 s after it, is below 5 s, with frames still coming.
    const restart = await timeFrames(page);
    const restartedAt = Date.now();
    await setLinks(server, [links[0], { ...links[1], address: '127.0.0.1' }]);
    await page.waitForTimeout(15_000);
    testInfo.annotations.push({ type: 'stream requests after the restart', description: triesIn(restartedAt).map((t) => `${t - restartedAt} ms`).join(', ') || 'none' });
    expect(triesIn(restartedAt).length, 'the window opens the stream again at most once (each try shows frames briefly, so the pauses alone do not tell)').toBeLessThanOrEqual(1);
    const restartFrames = await restart.frames();
    const restartPause = longestPause(restart.from, restartFrames);
    testInfo.annotations.push({ type: 'after the restart', description: `${restartFrames.length} frames in 15 s, the longest pause ${Math.round(restartPause.ms)} ms at ${Math.round(restartPause.at)} ms` });
    expect(restartPause.ms, 'the longest pause after the restart').toBeLessThan(5_000);
    expect(await restart.now() - (restartFrames.at(-1) ?? restart.from), 'frames still coming').toBeLessThan(1_000);
    // The PUT sent no ids, so the link has a new id and its stream a new name (CR-0047 F2); the
    // window followed it by the link's name (owner XN A). Its one viewer is on the new stream.
    const restarted = (await streams(server)).find((r) => r.name === CLEAN_LINK);
    testInfo.annotations.push({ type: 'the stream after the restart', description: `${clean.stream} -> ${restarted?.stream}` });
    expect(restarted?.stream, 'a new stream name, a UUID v7').toEqual(expect.stringMatching(UUID_V7));
    expect(restarted!.stream, 'not the old one').not.toBe(clean.stream);
    await expect.poll(() => viewers(server, restarted!.stream!), { message: 'one viewer on the new stream' }).toBe(1);

    // Closing the window frees the viewer.
    await window.getByRole('button', { name: 'Close' }).click();
    await expect(window).toBeHidden();
    await expect.poll(() => viewers(server, restarted!.stream!), { message: 'no viewer' }).toBe(0);
    // Player errors outside the broken stretch and its recovery fail the test here too.
    expect.soft(errorsIn(roundEnd, brokenFrom).concat(errorsIn(brokenTo + RECOVERY_MS + 5_000)), 'player errors outside the broken stretch').toEqual([]);
  }, { allowConsoleErrors: /MSEController|SourceBuffer|MediaSource|mpegts|demux/i });
});

/** The newest state of one object from the live picture's events: null once deleted, undefined if never seen. */
function stateOf(events: Event[], id: string): State | null | undefined {
  let state: State | null | undefined;
  for (const e of events) if (e.entityType === 'object' && e.entityId === id) state = e.state;
  return state;
}

test('a renamed link keeps its id, its stream and, for fmv, its camera and arc (CR-0047 F5; owner WA B): renamed in Settings › FMV\'s side form, the objects stay, take the new name and keep their data source (WW A)', async ({}, testInfo) => {
  test.skip(skipReason !== null, skipReason ?? '');
  const RENAMED = 'ITA FMV renamed';
  await withM0(testInfo, browser!, async ({ server, live, open }) => {
    await setLinks(server, [{ name: LINK, mode: 'udp', port: PORT }]);
    const settings = async () => (await (await fetch(`${server.baseUrl}/api/settings/plugins/fmv`)).json()).values.links as Array<Record<string, unknown>>;
    const [link] = await settings();
    expect(link.id, 'ECore filled in the id: a UUID v7').toEqual(expect.stringMatching(UUID_V7));
    await expect.poll(() => latest(live.events as Event[], 'fmv.field-of-view').size, { timeout: FIRST_SET_MS, message: 'the camera\'s field of view after the first set' }).toBe(1);
    const [[cameraId, camera]] = [...latest(live.events as Event[], 'fmv.camera')];
    const [[arcId]] = [...latest(live.events as Event[], 'fmv.field-of-view')];
    expect(camera.properties.name).toBe(LINK);
    const before = (await streams(server)).find((r) => r.name === LINK);
    expect(before?.stream, 'the stream is named by the id').toBe(link.id);

    // Renamed in the side form (T-203 part D).
    const page = await open();
    await page.goto('/#settings/plugin/fmv');
    const links = page.getByRole('tabpanel').last().getByRole('region', { name: 'Links', exact: true });
    await links.getByRole('button', { name: LINK, exact: true }).click();
    const side = links.getByRole('complementary');
    await expect(side.getByRole('textbox', { name: /^Id\b/ }), 'the id is not shown (CR-0047 F3)').toHaveCount(0);
    await side.getByRole('textbox', { name: 'Name', exact: true }).fill(RENAMED);
    const renamedAt = (live.events as Event[]).length;
    await side.getByRole('button', { name: 'Save link', exact: true }).click();
    await expect.poll(async () => (await settings())[0]?.name, { message: 'saved' }).toBe(RENAMED);
    expect((await settings())[0].id, 'the id kept').toBe(link.id);
    await expect(links.getByRole('button', { name: RENAMED, exact: true }), 'the row renamed').toBeVisible();

    // The objects stay (no delete, no new camera) and take the new name, by the next set at the latest.
    await expect.poll(() => stateOf(live.events as Event[], cameraId)?.properties?.name, { timeout: FIRST_SET_MS, message: 'the camera takes the new name' }).toBe(RENAMED);
    const since = (live.events as Event[]).slice(renamedAt);
    testInfo.annotations.push({ type: 'after the rename', description: since.filter((e) => e.entityType === 'object').map((e) => `${e.operation} ${e.entityId === cameraId ? 'camera' : e.entityId === arcId ? 'arc' : e.entityId}`).join(', ') });
    expect(since.filter((e) => e.entityType === 'object' && e.operation === 'delete').map((e) => e.entityId), 'nothing deleted').toEqual([]);
    expect(since.filter((e) => e.entityType === 'object' && e.operation === 'create').map((e) => e.state?.dataType), 'no new camera or arc').toEqual([]);
    const renamed = stateOf(live.events as Event[], cameraId)!;
    expect(renamed.symbol.modifiers.uniqueDesignation, 'the unique designation follows').toBe(RENAMED);
    expect(renamed.dataSource, 'the data source as first made (rule 14, WW A)').toBe(STREAM);
    const arc = stateOf(live.events as Event[], arcId)!;
    expect(arc, 'the arc stays').not.toBeNull();
    expect(arc).toMatchObject({ dataSource: STREAM, relations: [{ kind: 'fmv.view', objectId: cameraId }] });
    const after = (await streams(server)).find((r) => r.name === RENAMED);
    expect(after?.stream, 'the same stream').toBe(link.id);
    expect((await streams(server)).find((r) => r.name === LINK), 'no row by the old name').toBeUndefined();
  });
});

/** fmv's entry in the Monitor: its status line and ECore's conversions. */
type Conversion = { stream: string; state: string; bytesIn: number; bytesOut: number; dropped: number; detail: string };
async function fmvMonitor(server: OwnServer): Promise<{ state: string; detail: string; conversions: Conversion[] }> {
  const monitor = await (await fetch(`${server.baseUrl}/api/monitor`)).json();
  return (monitor.plugins as Array<{ id: string }>).find((p) => p.id === 'fmv') as never;
}

test('MPEG-2 through ECore\'s conversion (T-211; CR-0044 E2, CR-0045): day-mpeg2 through a udp link is "Receiving MPEG-2 → H.264", its conversion RUNNING in the Monitor, its row says MPEG-2 → H.264 at 1280 × 720, and Watch plays the converted H.264', async ({}, testInfo) => {
  test.skip(mpeg2Skip !== null, mpeg2Skip ?? '');
  test.skip(FFMPEG === undefined, 'EMC2_FMV_FFMPEG names no converter (the owner chose S9\'s ffmpeg 9.0)');
  await withM0(testInfo, browser!, async ({ server, open }) => {
    await setLinks(server, [{ name: MPEG2_LINK, mode: 'udp', port: MPEG2_PORT }]);
    let row: Row | undefined;
    const rowNow = async () => (row = (await streams(server)).find((r) => r.name === MPEG2_LINK));
    await expect.poll(async () => (await rowNow())?.format, { timeout: 15_000, message: 'the row names the conversion' }).toBe('MPEG-2 → H.264');
    await expect.poll(async () => (await rowNow())?.state, { timeout: 30_000, message: 'live (or stale between sets), not waiting or failed' }).toMatch(/^(live|stale)$/);
    expect(row).toMatchObject({ stream: expect.stringMatching(UUID_V7), playable: true, h265: false });
    // The size, as for H.264 (the brief's row: format, size, ...): it may come a few seconds after the
    // row is live (seen missing at first, there later). Soft, so that the conversion and the window are checked too.
    await expect.soft.poll(async () => { const r = await rowNow(); return r === undefined ? null : { width: r.width, height: r.height }; }, { timeout: 15_000, message: 'the converted stream\'s size' }).toEqual({ width: 1280, height: 720 });
    expect(row!.message, 'no message').toBeUndefined();
    testInfo.annotations.push({ type: 'GET /streams', description: JSON.stringify(row) });
    await expect.poll(async () => (await fmvMonitor(server)).detail, { timeout: 15_000, message: 'the status line' }).toContain(`${MPEG2_LINK} [udp 127.0.0.1:${MPEG2_PORT}]: Receiving MPEG-2 → H.264`);
    const conversion = async () => (await fmvMonitor(server)).conversions.find((c) => c.stream === row!.stream);
    await expect.poll(async () => (await conversion())?.state, { timeout: 15_000, message: 'ECore\'s conversion in the Monitor' }).toBe('RUNNING');
    await expect.poll(async () => (await conversion())?.bytesOut ?? 0, { timeout: 15_000, message: 'it puts out H.264' }).toBeGreaterThan(100_000);
    testInfo.annotations.push({ type: 'conversion', description: JSON.stringify(await conversion()) });

    const page = await open();
    const playerErrors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') playerErrors.push(message.text()); });
    page.on('pageerror', (error) => playerErrors.push(`uncaught ${error.message}`));
    const panel = page.getByRole('region', { name: 'FMV', exact: true }).last();
    const listed = panel.getByRole('listbox', { name: 'FMV streams' }).getByRole('option').filter({ hasText: MPEG2_LINK });
    await expect(listed, 'its row').toHaveAccessibleName(/ MPEG-2 → H\.264( · 1280 × 720)? · \d+(\.\d)? Mbit\/s( · (\d+ s ago|no metadata))? (Live|Stale) Watch$/); // the size: the soft check above; no metadata before the first set
    const opened = Date.now();
    await listed.getByRole('button', { name: 'Watch' }).click();
    const window = page.getByRole('dialog', { name: row!.title });
    await expect(window).toBeVisible();
    await expect.poll(async () => (await playing(page)).width, { timeout: 15_000, message: 'the converted video has its size' }).toBe(1280);
    testInfo.annotations.push({ type: 'first frame', description: `${Date.now() - opened} ms after Watch` });
    const first = await playing(page);
    await expect.poll(async () => (await playing(page)).time - first.time, { timeout: 15_000, message: 'the converted video plays' }).toBeGreaterThan(5);
    await expect(window).toContainText('MPEG-2 → H.264');
    await page.screenshot({ path: testInfo.outputPath('fmv-mpeg2-window.png') });
    expect(playerErrors, 'no player errors').toEqual([]);
    await window.getByRole('button', { name: 'Close' }).click();
    await expect(window).toBeHidden();
  }, { serverArgs: [`--emc2.conversions.ffmpeg=${FFMPEG}`] });
});

test('MPEG-2 without a converter (T-211: Failed(UNAVAILABLE)): the row is Not playable with "No converter installed" and Watch off, the status line says so, and the Monitor lists the conversion as FAILED with its reason', async ({}, testInfo) => {
  test.skip(mpeg2Skip !== null, mpeg2Skip ?? '');
  const missing = testInfo.outputPath('no-such-ffmpeg.exe');
  await withM0(testInfo, browser!, async ({ server, open }) => {
    await setLinks(server, [{ name: MPEG2_LINK, mode: 'udp', port: MPEG2_PORT }]);
    let row: Row | undefined;
    await expect.poll(async () => (row = (await streams(server)).find((r) => r.name === MPEG2_LINK))?.message, { timeout: 30_000, message: 'the row says why' }).toBe('No converter installed');
    expect(row).toMatchObject({ format: 'MPEG-2 → H.264', state: 'not-playable', playable: false });
    testInfo.annotations.push({ type: 'GET /streams', description: JSON.stringify(row) });
    await expect.poll(async () => (await fmvMonitor(server)).detail, { timeout: 15_000, message: 'the status line' }).toContain(`${MPEG2_LINK} [udp 127.0.0.1:${MPEG2_PORT}]: No converter installed`);
    const monitor = await fmvMonitor(server);
    testInfo.annotations.push({ type: 'Monitor', description: JSON.stringify({ state: monitor.state, detail: monitor.detail, conversions: monitor.conversions }) });
    const failed = monitor.conversions.find((c) => c.state === 'FAILED');
    expect(failed, 'the failed conversion in the Monitor').toBeDefined();
    expect(failed!.detail, 'with its reason').toBe(`UNAVAILABLE: no converter: ${missing} is not there`);

    const page = await open();
    const listed = page.getByRole('region', { name: 'FMV', exact: true }).last().getByRole('listbox', { name: 'FMV streams' }).getByRole('option').filter({ hasText: MPEG2_LINK });
    await expect(listed).toContainText('Not playable');
    await expect(listed).toContainText('No converter installed');
    await expect(listed.getByRole('button', { name: 'Watch' }), 'Watch off').toBeDisabled();
  }, { serverArgs: [`--emc2.conversions.ffmpeg=${missing}`] });
});
