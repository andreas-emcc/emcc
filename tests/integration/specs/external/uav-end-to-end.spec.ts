// Quick run: @plugin-fmv @plugin-uav-simulation @streams
// Quick run of this file alone (needs an ffmpeg with h264_mf, the ESA's Sundsvall DTED and an installed Edge or Chrome):
//   $env:EMC2_FMV_FFMPEG = '<an ffmpeg.exe, e.g. tools\ffmpeg\out\ffmpeg.exe of a checkout that built it>'
//   $env:EMC2_EXTERNAL_ROOT = '<the ESA's external services folder>'   (or EMC2_TERRAIN_DTED = '<a DTED folder>')
//   node tests/integration/run.mjs --skip-build -- specs/external/uav-end-to-end.spec.ts
import { createSocket, type Socket } from 'node:dgram';
import { externalMissing, externalPath } from '../../lib/external.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { inverse } from '../../lib/geodesy.mjs';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { withM0 } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';
import { freeUdpPort } from '../../lib/udp-peer.mjs';

// M9 T2, the UAV end to end (the fmv brief's criterion 34 and uav-simulation's criterion 18; ADR-0059): a
// uav-simulation camera rides a simulator track flying east over Sundsvall at 750 m, fixed at azimuth 90° and
// depression 30°, and sends its poses to an fmv output link. The link renders over the ESA's Sundsvall DTED (and a
// synthetic imagery set the test makes), encodes through ECore's ffmpeg and sends STANAG 4609 over UDP to an outside
// receiver: the test's own tap on loopback. The tap reads every datagram (7 x 188-byte packets; every ST 0601 set's
// checksum; the values against the scene: tags 5, 13 to 16, 18, 19, 23 to 25) and passes it on unchanged to an fmv
// input link of the same server. Back in emcc: the input link's camera symbol at the sensor, moving with the track, and
// its field-of-view arc; its row in GET /streams and the FMV panel; Watch plays 60 s in a window without a player
// error. Then stopping the camera stops the video, and an output link that is switched off shows "Output missing".
// Not tested here, as M10's (owner ABU A): playing within 2 s of the first pose (criterion 34's timing) and the busy
// share (criterion 35); the Monitor's compute and conversion rows are only recorded.
// Skipped, with the reason, without EMC2_FMV_FFMPEG, without the DTED (EMC2_TERRAIN_DTED, else
// %EMC2_EXTERNAL_ROOT%\terrain\dted) or without an installed Edge or Chrome. About 3 minutes.

test.describe.configure({ timeout: 600_000 });

const FFMPEG = process.env.EMC2_FMV_FFMPEG;
const DTED = process.env.EMC2_TERRAIN_DTED
  ?? externalPath('terrain', 'dted');
const OUT_LINK = 'ITA UAV out';
const IN_LINK = 'ITA UAV in';
const IN_SOURCE = 'ita-uav-in'; // the input link's objects' data source: its name in lower case, other characters as hyphens
const SIMULATION = 'simulator.simulation';
const ALTITUDE = 750;
const AZIMUTH = 90;
const DEPRESSION = 30;
const FOV = 20;
/** East over Sundsvall's coast (the ESA's sheet: hills in the west cell, sea in the east), latitude ≠ longitude. */
const ROUTE: [number, number][] = [[17.20, 62.40], [17.45, 62.40]];
const SPEED = 60;
const WATCH_MS = 60_000;
const EARTH = 6_371_000;

type State = Record<string, any>;
type Event = { entityType: string; entityId: string; operation: string; state: State | null };

// ---------------------------------------------------------------- the outside receiver

/** The ST 0601 UAS Datalink Local Set key. */
const UL = Buffer.from('060e2b34020b01010e01030101000000', 'hex');

type Set601 = { at: number; checksumOk: boolean; tags: Map<number, Buffer> };

function ber(buf: Buffer, i: number): { length: number; next: number } {
  const b = buf[i];
  if (b < 0x80) return { length: b, next: i + 1 };
  const n = b & 0x7f;
  let length = 0;
  for (let k = 0; k < n; k++) length = length * 256 + buf[i + 1 + k];
  return { length, next: i + 1 + n };
}

/** The ST 0601 sets in a KLV unit: each key, its BER length, its local set, the checksum (tag 1, last) checked. */
function sets601(unit: Buffer): Set601[] {
  const found: Set601[] = [];
  let from = 0;
  for (;;) {
    const start = unit.indexOf(UL, from);
    if (start < 0) return found;
    const { length, next } = ber(unit, start + 16);
    const end = next + length;
    if (end > unit.length) return found;
    const tags = new Map<number, Buffer>();
    let i = next;
    while (i < end) {
      const tag = unit[i];
      const l = ber(unit, i + 1);
      tags.set(tag, unit.subarray(l.next, l.next + l.length));
      i = l.next + l.length;
    }
    // ST 0601's checksum: the 16-bit sum, high byte first, from the key's first byte through tag 1's length byte.
    let bcc = 0;
    for (let k = start; k < end - 2; k++) bcc = (bcc + (unit[k] << (8 * ((k - start + 1) % 2)))) & 0xffff;
    const checksum = tags.get(1);
    found.push({ at: Date.now(), checksumOk: checksum !== undefined && checksum.readUInt16BE(0) === bcc, tags });
    from = end;
  }
}

/** A tag's value in ST 0601's units (only the tags this test reads). */
function value(set: Set601, tag: number): number | string | null {
  const v = set.tags.get(tag);
  if (v === undefined) return null;
  switch (tag) {
    case 2: return Number(v.readBigUInt64BE(0) / 1000n); // ms
    case 3: case 10: return v.toString('latin1');
    case 5: return (v.readUInt16BE(0) * 360) / 0xffff;
    case 13: case 23: return v.readInt32BE(0) === -0x80000000 ? null : (v.readInt32BE(0) * 90) / 0x7fffffff;
    case 14: case 24: return v.readInt32BE(0) === -0x80000000 ? null : (v.readInt32BE(0) * 180) / 0x7fffffff;
    case 15: case 25: return (v.readUInt16BE(0) * 19900) / 0xffff - 900;
    case 16: return (v.readUInt16BE(0) * 180) / 0xffff;
    case 18: return (v.readUInt32BE(0) * 360) / 0xffffffff;
    case 19: return (v.readInt32BE(0) * 180) / 0x7fffffff;
    default: return null;
  }
}

type Tap = {
  datagrams: number;
  badDatagrams: string[];
  continuityGaps: number;
  sets: Set601[];
  lastAt: number;
  pids: Set<number>;
  close: () => Promise<void>;
};

/**
 * The outside receiver: listens on `port`, reads every datagram and passes it on unchanged to `forward` (the input
 * link), as a ground station that records and relays. KLV is on PID 0x0102 (fmv's TsMuxer).
 */
async function startTap(port: number, forward: number): Promise<Tap> {
  const socket: Socket = createSocket('udp4');
  const counters = new Map<number, number>();
  let unit: Buffer[] | null = null;
  const tap: Tap = {
    datagrams: 0, badDatagrams: [], continuityGaps: 0, sets: [], lastAt: 0, pids: new Set(),
    close: () => new Promise((resolve) => socket.close(() => resolve())),
  };
  const finish = () => {
    if (unit !== null) tap.sets.push(...sets601(Buffer.concat(unit)));
    unit = null;
  };
  socket.on('message', (datagram) => {
    socket.send(datagram, forward, '127.0.0.1');
    tap.datagrams++;
    tap.lastAt = Date.now();
    if (datagram.length !== 7 * 188) tap.badDatagrams.push(`${datagram.length} bytes`);
    for (let p = 0; p + 188 <= datagram.length; p += 188) {
      const packet = datagram.subarray(p, p + 188);
      if (packet[0] !== 0x47) {
        tap.badDatagrams.push(`no sync byte at ${p}`);
        continue;
      }
      const pid = ((packet[1] & 0x1f) << 8) | packet[2];
      tap.pids.add(pid);
      if (pid === 0x1fff) continue;
      const hasPayload = (packet[3] & 0x10) !== 0;
      const counter = packet[3] & 0x0f;
      const before = counters.get(pid);
      if (hasPayload && before !== undefined && counter !== ((before + 1) & 0x0f)) tap.continuityGaps++;
      if (hasPayload) counters.set(pid, counter);
      if (pid !== 0x0102 || !hasPayload) continue;
      let at = 4;
      if ((packet[3] & 0x20) !== 0) at += 1 + packet[4];
      if ((packet[1] & 0x40) !== 0) {
        finish();
        // The PES header: start code, stream id, length, flags, its header length.
        at += 9 + packet[at + 8];
        unit = [];
      }
      if (unit !== null && at < 188) unit.push(Buffer.from(packet.subarray(at)));
    }
  });
  await new Promise<void>((resolve) => socket.bind(port, '127.0.0.1', () => resolve()));
  return tap;
}

// ---------------------------------------------------------------- the synthetic imagery

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A grey PNG, a checkerboard of 64-pixel squares. */
function checkerPng(size: number): Buffer {
  const rows = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size + 1)] = 0;
    for (let x = 0; x < size; x++) rows[y * (size + 1) + 1 + x] = ((x >> 6) + (y >> 6)) % 2 === 0 ? 70 : 190;
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grey
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** An imagery set of the test's own (fmv's A1 imagery.json), made by the test, covering the route and its view. */
function makeImagery(folder: string): void {
  const set = join(folder, 'ita-checker');
  mkdirSync(set, { recursive: true });
  writeFileSync(join(set, 'checker.png'), checkerPng(1024));
  writeFileSync(join(set, 'imagery.json'), JSON.stringify({
    name: 'ITA checkerboard', source: 'Made by the ITA\'s test', licence: 'CC0-1.0', crs: 'EPSG:4326',
    tiles: [{ file: 'checker.png', min: [17.0, 62.2], max: [17.7, 62.6], width: 1024, height: 1024 }],
  }));
}

// ---------------------------------------------------------------- the server

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

async function json(server: OwnServer, method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, `${method} ${path}: ${text}`).toBe(200);
  return text === '' ? null : JSON.parse(text);
}

async function fmvSettings(server: OwnServer, change: (values: State) => State): Promise<State> {
  const { values } = await json(server, 'GET', '/api/settings/plugins/fmv');
  await json(server, 'PUT', '/api/settings/plugins/fmv', change(values));
  return (await json(server, 'GET', '/api/settings/plugins/fmv')).values;
}

async function applied(client: LiveClient, request: { entityType: string; operation: string }): Promise<void> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}`).toMatchObject({ outcome: 'applied' });
}

/** Every state of an object, in order, with its observed time. */
function states(client: LiveClient, id: string): Array<{ t: number; at: [number, number]; direction?: number }> {
  return (client.events as Event[])
    .filter((e) => e.entityId === id && e.state !== null)
    .map((e) => ({ t: Date.parse(e.state!.time?.observed ?? '1970-01-01T00:00:00Z'), at: e.state!.geometry.coordinates, direction: e.state!.symbol?.modifiers?.direction }));
}

/** The newest state of each object of a data type and data source. */
function latest(client: LiveClient, dataType: string, dataSource: string): Map<string, State> {
  const byId = new Map<string, State>();
  for (const e of client.events as Event[]) {
    if (e.entityType !== 'object') continue;
    if (e.state === null) byId.delete(e.entityId);
    else if (e.state.dataType === dataType && e.state.dataSource === dataSource) byId.set(e.entityId, e.state);
  }
  return byId;
}

/** The track's position at `t` (ms), between its two nearest states (the simulator's ticks). */
function trackAt(moves: ReturnType<typeof states>, t: number): [number, number] | null {
  const after = moves.findIndex((m) => m.t >= t);
  if (after <= 0) return null;
  const a = moves[after - 1];
  const b = moves[after];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return [a.at[0] + (b.at[0] - a.at[0]) * f, a.at[1] + (b.at[1] - a.at[1]) * f];
}

function turn(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

async function playing(page: Page) {
  return page.locator('video.fmv-window-video').evaluate((v: HTMLVideoElement) => ({ time: v.currentTime, width: v.videoWidth, height: v.videoHeight, frames: v.getVideoPlaybackQuality().totalVideoFrames, dropped: v.getVideoPlaybackQuality().droppedVideoFrames }));
}

let browser: Browser | null = null;
let skipReason: string | null = null;

test.beforeAll(async () => {
  if (FFMPEG === undefined || !existsSync(FFMPEG)) skipReason = `set EMC2_FMV_FFMPEG to an ffmpeg with h264_mf (the MCA's build in tools/ffmpeg); now ${FFMPEG ?? 'unset'}`;
  else if (DTED === '' || !existsSync(join(DTED, 'e017', 'n62.dt2'))) skipReason = `${externalMissing('the Sundsvall DTED', DTED)} (the ESA's external/terrain; or set EMC2_TERRAIN_DTED)`;
  else {
    browser = await installedBrowser();
    if (browser === null) skipReason = 'neither an installed Edge nor Chrome (Playwright channels msedge, chrome)';
  }
});

test.afterAll(async () => {
  await browser?.close();
});

test('the UAV end to end: a uav-simulation camera on a simulator track, fmv\'s output link over the Sundsvall DTED to an outside receiver with ST 0601 matching the scene, and back through an input link: the camera moving with the track, its arc, and the FMV window playing 60 s; stopping the camera stops the video, a switched-off output link is "Output missing" (M9 T2; fmv criterion 34 but its 2 s, uav-simulation criterion 18)', async ({}, testInfo) => {
  test.skip(skipReason !== null, skipReason ?? '');
  await withM0(testInfo, browser!, async ({ server, live: view, open }) => {
    // A client that sees every workspace: the track is in Simulation, the input link's camera in View.
    const live = await LiveClient.open(server.baseUrl);
    await live.subscribe({ workspaces: ['*'] });
    void view;
    const imagery = testInfo.outputPath('imagery');
    makeImagery(imagery);
    const [outPort, inPort] = [await freeUdpPort(), await freeUdpPort()];
    const tap = await startTap(outPort, inPort);
    try {
      // fmv: the output link to the outside receiver, the input link where it passes the stream on, and the folders.
      const values = await fmvSettings(server, (v) => ({
        ...v,
        imageryFolder: imagery,
        terrainFolder: DTED,
        links: [
          { name: OUT_LINK, direction: 'out', mode: 'udp', address: '127.0.0.1', port: outPort },
          { name: IN_LINK, direction: 'in', mode: 'udp', port: inPort },
        ],
      }));
      const outLink = (values.links as State[]).find((l) => l.name === OUT_LINK)!;
      expect(outLink.id, 'the output link\'s id, filled in by ECore').toEqual(expect.any(String));

      // The simulator: a track in Simulation flying east at 750 m.
      const layer = createLayer('ITA UAV', { workspace: SIMULATION });
      await applied(live, layer);
      const track = createSymbol(layer.entityId, 0, { name: 'Hawk 1' }) as any;
      track.data.geometry.coordinates = ROUTE[0];
      track.data.symbol = { standard: 'APP-6D', sidc: '10030100001101000000' };
      await applied(live, track);
      const route = createSymbol(layer.entityId, 0, { name: 'ITA UAV route' }) as any;
      route.data = {
        type: 'core.shape', dataType: 'simulator.route', dataSource: 'manual', layerId: layer.entityId,
        geometry: { type: 'LineString', coordinates: ROUTE },
        style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
        properties: { name: 'ITA UAV route' }, label: route.data.label,
        extensions: { simulator: { points: [{ speedKind: 'instant', speed: SPEED, altitudeKind: 'instant', altitude: ALTITUDE }, {}], groups: [], end: 'stop' } },
      };
      await applied(live, route);
      await json(server, 'POST', '/api/plugins/simulator/put-on-route', { route: route.entityId, kind: 'single', objects: [track.entityId] });

      // uav-simulation: the camera on the track, fixed, to the output link.
      const offered = await expect.poll(async () => (await json(server, 'GET', '/api/plugins/uav-simulation/cameras')).outputs as State[], { message: 'the output link on offer' })
        .toContainEqual(expect.objectContaining({ id: `fmv/out-${outLink.id}` }));
      void offered;
      const created = await json(server, 'POST', '/api/plugins/uav-simulation/cameras', {
        platform: track.entityId, mode: 'fixed', azimuth: AZIMUTH, depression: DEPRESSION, horizontalFov: FOV,
        frameSize: '1280x720', frameRate: 25, mission: 'ITA T2', output: `fmv/out-${outLink.id}`,
      });
      const cameraId: string = created.id ?? created.camera?.id;
      expect(cameraId, `the new camera: ${JSON.stringify(created)}`).toEqual(expect.any(String));
      await json(server, 'POST', '/api/plugins/simulator/routes/start', {});
      await json(server, 'POST', `/api/plugins/uav-simulation/cameras/${cameraId}/start`, {});
      const camera = async () => ((await json(server, 'GET', '/api/plugins/uav-simulation/cameras')).cameras as State[]).find((c) => c.id === cameraId)!;
      await expect.poll(async () => (await camera()).state, { timeout: 15_000, message: 'the camera runs' }).toBe('running');

      // The outside receiver gets STANAG 4609 with ST 0601.
      await expect.poll(() => tap.sets.length, { timeout: 60_000, message: `ST 0601 sets at the receiver (${tap.datagrams} datagrams so far)` }).toBeGreaterThan(25);
      const running = await camera();
      testInfo.annotations.push({ type: 'the camera', description: JSON.stringify({ state: running.state, outputState: running.outputState, outputDetail: running.outputDetail, poses: running.poses, sent: running.sent }) });
      expect(running.outputState, `its output link says: ${running.outputDetail}`).toBe('ready');

      // The input link's row, and the FMV window plays 60 s.
      const page = await open();
      const panel = page.getByRole('region', { name: 'FMV', exact: true }).last();
      const row = panel.getByRole('listbox', { name: 'FMV streams' }).getByRole('option').filter({ hasText: IN_LINK });
      await expect(row, 'the input link\'s row: H.264 1280 x 720').toHaveAccessibleName(/H\.264 · 1280 × 720 · .*Live.*Watch$/, { timeout: 30_000 });
      const streams = (await json(server, 'GET', '/api/plugins/fmv/streams')) as State[];
      const stream = streams.find((s) => s.name === IN_LINK)!;
      testInfo.annotations.push({ type: 'GET /streams, the input link', description: JSON.stringify(stream) });
      expect(stream).toMatchObject({ format: 'H.264', playable: true, width: 1280, height: 720 });
      const playerErrors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') playerErrors.push(m.text()); });
      page.on('pageerror', (e) => playerErrors.push(`uncaught ${e.message}`));
      await row.getByRole('button', { name: 'Watch' }).click();
      const window = page.getByRole('dialog', { name: stream.title });
      await expect(window).toBeVisible();
      await expect.poll(async () => (await playing(page)).width, { timeout: 15_000, message: 'the video has its size' }).toBe(1280);
      const first = await playing(page);
      const watchFrom = Date.now();
      const setsBefore = tap.sets.length;
      await page.waitForTimeout(WATCH_MS);
      const last = await playing(page);
      await page.screenshot({ path: testInfo.outputPath('fmv-window.png') });
      testInfo.annotations.push({ type: 'the window, 60 s', description: `video time ${first.time.toFixed(1)} -> ${last.time.toFixed(1)} s, ${last.frames - first.frames} frames, ${last.dropped - first.dropped} dropped; ${tap.sets.length - setsBefore} sets meanwhile` });
      expect(last.time - first.time, 'the video plays on through 60 s').toBeGreaterThan(55);
      expect(playerErrors, 'no player error in 60 s').toEqual([]);
      expect(Date.now() - tap.lastAt, 'the receiver still gets datagrams').toBeLessThan(2_000);

      // The receiver's view: whole datagrams, no gap, every checksum right, the values against the scene.
      testInfo.annotations.push({ type: 'the receiver', description: `${tap.datagrams} datagrams, PIDs ${[...tap.pids].map((p) => `0x${p.toString(16)}`).join(' ')}, ${tap.continuityGaps} continuity gaps, ${tap.sets.length} ST 0601 sets` });
      expect(tap.badDatagrams.slice(0, 5), 'every datagram 7 x 188 bytes of packets').toEqual([]);
      expect(tap.continuityGaps, 'no continuity gap on loopback').toBe(0);
      expect(tap.sets.filter((s) => !s.checksumOk).length, 'every ST 0601 checksum right').toBe(0);
      const moves = states(live, track.entityId);
      const checked = tap.sets.filter((s) => value(s, 23) !== null);
      expect(checked.length, 'sets with a frame centre').toBeGreaterThan(25);
      const worst = { position: 0, heading: 0, lateral: 0, height: 0 };
      // Every geodesic of the check in one call of the SDK's geodesy (a process each).
      type Pair = [[number, number], [number, number]];
      const pairs: Pair[] = [];
      const rows = checked.map((set) => {
        const v = (tag: number) => value(set, tag) as number;
        expect(Math.abs(v(18) - AZIMUTH), 'tag 18, the azimuth').toBeLessThan(0.01);
        expect(Math.abs(v(19) + DEPRESSION), 'tag 19, minus the depression').toBeLessThan(0.01);
        expect(Math.abs(v(16) - FOV), 'tag 16, the horizontal field of view').toBeLessThan(0.01);
        expect(Math.abs(v(15) - ALTITUDE), 'tag 15, the sensor\'s altitude').toBeLessThan(1);
        const sensor: [number, number] = [v(14), v(13)];
        const at = trackAt(moves, v(2));
        const toTrack = at === null ? -1 : pairs.push([at, sensor]) - 1;
        const toCentre = pairs.push([sensor, [v(24), v(23)]]) - 1;
        return { v, toTrack, toCentre };
      });
      const legs = inverse(pairs);
      let compared = 0;
      for (const { v, toTrack, toCentre } of rows) {
        if (toTrack >= 0) {
          worst.position = Math.max(worst.position, legs[toTrack].metres);
          compared++;
          const direction = moves.filter((m) => m.t <= v(2)).at(-1)?.direction;
          if (direction !== undefined) worst.heading = Math.max(worst.heading, Math.abs(turn(direction, v(5))));
        }
        // The frame centre on the line of sight: its bearing the heading plus the azimuth, its height on the ray.
        const leg = legs[toCentre];
        worst.lateral = Math.max(worst.lateral, Math.abs(leg.metres * Math.sin((turn(v(5) + AZIMUTH, leg.initialAzimuth) * Math.PI) / 180)));
        const onRay = v(15) - leg.metres * Math.tan((DEPRESSION * Math.PI) / 180) - (leg.metres * leg.metres) / (2 * EARTH);
        worst.height = Math.max(worst.height, Math.abs(onRay - v(25)));
      }
      expect(compared, 'sets compared with the track').toBeGreaterThan(25);
      const sample = checked.at(-1)!;
      testInfo.annotations.push({ type: 'ST 0601, the last set', description: JSON.stringify(Object.fromEntries([2, 3, 5, 10, 13, 14, 15, 16, 18, 19, 23, 24, 25].map((t) => [t, value(sample, t)]))) });
      testInfo.annotations.push({ type: 'ST 0601 against the scene (worst of the sets)', description: `sensor ${worst.position.toFixed(1)} m from the track, heading ${worst.heading.toFixed(2)}°, frame centre ${worst.lateral.toFixed(1)} m beside and ${worst.height.toFixed(1)} m above or below the line of sight` });
      expect(value(sample, 3), 'tag 3, the mission').toBe('ITA T2');
      expect(value(sample, 10), 'tag 10, the platform').toBe('Hawk 1');
      expect(worst.position, 'tags 13 and 14 at the track (it flies 60 m/s)').toBeLessThan(120);
      expect(worst.heading, 'tag 5, the track\'s direction').toBeLessThan(1);
      expect(worst.lateral, 'the frame centre on the line of sight: sideways').toBeLessThan(10);
      expect(worst.height, 'the frame centre on the line of sight: in height (tag 25)').toBeLessThan(12);

      // Back in emcc: the input link's camera at the sensor, moving with the track, and its arc.
      const cameras = latest(live, 'fmv.camera', IN_SOURCE);
      expect(cameras.size, 'one camera from the input link').toBe(1);
      const [[symbolId, symbol]] = [...cameras];
      const path = states(live, symbolId).filter((m) => m.t >= watchFrom);
      const [{ metres: moved }] = inverse([[path[0].at, path.at(-1)!.at]]);
      testInfo.annotations.push({ type: 'the camera symbol', description: `${path.length} states in 60 s, moved ${Math.round(moved)} m; ${JSON.stringify({ geometry: symbol.geometry, fmv: symbol.extensions.fmv })}` });
      expect(moved, 'the camera symbol moves with the track (60 m/s for 60 s)').toBeGreaterThan(2_000);
      const trackNow = states(live, track.entityId).at(-1);
      expect(trackNow, 'the track in the live picture').toBeDefined();
      const [{ metres: offTrack }] = inverse([[symbol.geometry.coordinates, trackNow!.at]]);
      expect(offTrack, 'the camera symbol at the track').toBeLessThan(250);
      const arcs = latest(live, 'fmv.field-of-view', IN_SOURCE);
      expect(arcs.size, 'its field-of-view arc').toBe(1);
      const [arc] = [...arcs.values()];
      expect(arc).toMatchObject({ geometry: { type: 'ArcBand' }, relations: [{ kind: 'fmv.view', objectId: symbolId }] });
      const width = (arc.geometry.endBearing - arc.geometry.startBearing + 360) % 360;
      const middle = (arc.geometry.startBearing + width / 2) % 360;
      expect(Math.abs(turn((symbol.symbol.modifiers.direction ?? 90) + AZIMUTH, middle)), `the arc in the pose's direction (${middle.toFixed(1)}°)`).toBeLessThan(1);

      const monitor = await json(server, 'GET', '/api/monitor');
      const fmv = (monitor.plugins as State[]).find((p) => p.id === 'fmv')!;
      testInfo.annotations.push({ type: 'fmv in the Monitor (recorded; criterion 35 is M10)', description: JSON.stringify({ state: fmv.state, detail: fmv.detail, compute: fmv.compute, conversions: fmv.conversions }) });

      // Stopping the camera stops the video.
      await json(server, 'POST', `/api/plugins/uav-simulation/cameras/${cameraId}/stop`, {});
      await expect.poll(async () => (await camera()).state, { message: 'the camera stopped' }).toBe('stopped');
      await expect.poll(() => Date.now() - tap.lastAt, { timeout: 10_000, message: 'no more datagrams after the stop' }).toBeGreaterThan(3_000);

      // A switched-off output link: the camera, started, shows its output missing.
      await fmvSettings(server, (v) => ({ ...v, links: (v.links as State[]).map((l) => (l.name === OUT_LINK ? { ...l, enabled: false } : l)) }));
      await json(server, 'POST', `/api/plugins/uav-simulation/cameras/${cameraId}/start`, {});
      await expect.poll(async () => (await camera()).state, { timeout: 15_000, message: 'Output missing' }).toBe('outputMissing');
      await json(server, 'POST', `/api/plugins/uav-simulation/cameras/${cameraId}/stop`, {});
    } finally {
      await tap.close();
      await live.close();
    }
  }, { serverArgs: [`--emc2.conversions.ffmpeg=${FFMPEG}`] });
});
