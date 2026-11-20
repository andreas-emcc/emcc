// Quick run: @plugin-gmti @plugin-simulator
// Quick run of this file alone (optional, Windows; see below):
//   $env:EMC2_GMTI_DISSECTOR = '<the owner's GMTI dissector (a PowerShell script)>'
//   node tests/integration/run.mjs --skip-build -- specs/external/gmti-automated-external-verification.spec.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type TestInfo } from '@playwright/test';
import { direct } from '../../lib/geodesy.mjs';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { withM0, type LonLat } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';
import { freeUdpPort } from '../../lib/udp-peer.mjs';

// GMTI-automated-external-verification (owner, 2026-11-09): emc2's GMTI out, as STANAG 4607
// packets over UDP, checked by an external decoder, the owner's GMTI dissector (a PowerShell script). The
// script is not in the repository; it is named by EMC2_GMTI_DISSECTOR, and the test is skipped
// without it (and on other platforms than Windows: it is Windows PowerShell). It is optional: it
// runs in the full run only where that variable is set.
//
// The chain: the simulator's GMTI sensor -> a gmti `out` link (UDP, loopback) -> the test's tap
// -> the dissector (UDP mode, its log in the test's output). The dissector decodes only the first
// segment of a packet. gmti's out link setting `oneSegmentPerPacket` (T-159, owner MV A; on by
// default, MY; gmti brief "Out", criterion 22) sends each segment in a packet of its own, and the
// link here keeps that default. The tap passes every datagram on unchanged and checks it on the
// way: P2 its size, exactly one segment filling it, and a report's packets in order (the mission,
// the job definition when due, then the dwells). The dissector runs with all four -show switches,
// so that its own timing rules are on (job definition at least every 30 s, mission every 120 s;
// with none of them it resets its clocks at every packet). It is started with -ExecutionPolicy Bypass for that one
// process (the machine's policy is not changed) and stopped by killing it; its log is written line
// by line, so nothing is lost.
//
// The checks: the dissector's own rules (no [ERROR] or [WARNING] line, no dwell with job id 0, no
// unknown segment, no script error but its two known ones), and that what it decoded is
// what the simulation sent: every segment decoded, the header, the mission, the job definition,
// and in each revisit the sensor at the platform and the reports at the tracks' positions. The
// dissector decodes SA angles as sign and magnitude, so negative latitudes come out wrong: every
// position here is in Sweden (north and east), latitude ≠ longitude.
//
// M9.1 (owner, 2026-11-20): two runs, one per edition of the out link's setting `edition`
// (FORMAT-RULES G18). Edition 3, the default, with the link set up without the setting: P1 "30",
// every packet with the job's P10. Edition 4, set on the link: P1 "41", P10 0 in the mission's and
// the job's own packets (oneSegmentPerPacket), the job's in the dwells'. gmti out sends the job
// definition with the first dwell 20 s after the last one (G7, owner ADQ B), so two are at most
// 20 s plus one revisit apart.

test.describe.configure({ timeout: 240_000 });

const DISSECTOR = process.env.EMC2_GMTI_DISSECTOR ?? '';
const SIMULATION = 'simulator.simulation';
const PLATFORM: LonLat = [15.5, 58.5];
const KM = 1000;
const MISSION = 'ITA-GMTI-EXT';
const REVISIT_S = 5;
/** Long enough for two job definitions (at least every 20 s, with the next dwell) and seven revisits. */
const LISTEN_MS = 40_000;
/** gmti out's job definition: with the first dwell 20 s after the last one (G7), so at most a revisit later. */
const JOB_EVERY_MS = 20_000 + REVISIT_S * 1000;
/** The out link's setting `edition` (M9.1), and what the dissector prints for P1 (spaces made one). */
const EDITIONS = [
  { name: 'Edition 3, the default (the link set up without the setting)', setting: undefined, version: 'Edition: 3 Amendment: 0', jobIdOnlyWithADwell: false },
  { name: 'Edition 4 (edition-4)', setting: 'edition-4', version: 'Edition: 4 Amendment: 1', jobIdOnlyWithADwell: true },
] as const;
type EditionCase = (typeof EDITIONS)[number];
/** SA32 and BA32 steps are below 1e-7°; the sensor detects all at the true positions. */
const SAME_PLACE = 1e-6;
/** Sweden, roughly: north and east, where the dissector decodes positions right. */
const SWEDEN = { west: 10, east: 25, south: 55, north: 70 };
/**
 * The script's own two errors, each at most once: without a console it cannot catch Ctrl-C (at its
 * start), and at the first mission segment it compares with a job definition time not yet set.
 */
const KNOWN_ERRORS = [
  { what: 'Ctrl-C without a console', id: 'ExceptionWhenSetting', text: 'TreatControlCAsInput' },
  { what: 'no job definition yet at the first packet', id: 'ParameterBindingFailed,Microsoft.PowerShell.Commands.NewTimeSpanCommand', text: 'lastJobDefinitionTime' },
];

type Fields = Record<string, string>;
type Packet = { severities: string[]; lines: string[]; header: Fields; segment: string; fields: Fields; targets: Fields[] };

async function applied(client: LiveClient, request: { entityType: string; operation: string }): Promise<void> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}: ${JSON.stringify(outcome.rejection ?? '')}`).toMatchObject({ outcome: 'applied' });
}

async function simulator(server: OwnServer, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${server.baseUrl}/api/plugins/simulator${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, `${path}: ${text}`).toBe(200);
  return text === '' ? null : JSON.parse(text);
}

/** An APP-6B friendly infantry track at a position. */
function track(layerId: string, name: string, at: LonLat, modifiers?: Record<string, unknown>) {
  const request = createSymbol(layerId, 0, { name }) as any;
  request.data.geometry.coordinates = at;
  request.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------', ...(modifiers === undefined ? {} : { modifiers }) };
  return request;
}

/** A route as "New route" makes it: 30 km/h at every point, "stop". */
function route(layerId: string, name: string, coordinates: LonLat[]) {
  const request = createSymbol(layerId, 0, { name }) as any;
  request.data = {
    type: 'core.shape', dataType: 'simulator.route', dataSource: 'manual', layerId,
    geometry: { type: 'LineString', coordinates },
    style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
    properties: { name }, label: request.data.label,
    extensions: { simulator: { points: coordinates.map(() => ({ speedKind: 'instant', speed: 30 / 3.6, events: [] })), groups: [], end: 'stop' } },
  };
  return request;
}

/**
 * The tap: every datagram sent on to the dissector unchanged. Records what it got (the segment
 * types of each packet and when) and every fault of the packet structure, a packet with more or
 * fewer segments than one among them.
 */
async function startTap(to: number) {
  const socket = createSocket('udp4');
  const faults: string[] = [];
  const packets: Array<{ at: number; types: number[] }> = [];
  let sent = 0;
  socket.on('message', (packet) => {
    const n = packets.length;
    if (packet.length < 37) { faults.push(`packet ${n}: ${packet.length} bytes`); return; }
    const size = packet.readUInt32BE(2);
    if (size !== packet.length) faults.push(`packet ${n}: P2 says ${size} bytes, the datagram has ${packet.length}`);
    const types: number[] = [];
    for (let at = 32; at < packet.length;) {
      if (at + 5 > packet.length) { faults.push(`packet ${n}: ${packet.length - at} bytes left after the segments`); break; }
      const segmentSize = packet.readUInt32BE(at + 1);
      if (segmentSize < 5 || at + segmentSize > packet.length) { faults.push(`packet ${n}: segment at byte ${at} says ${segmentSize} bytes`); break; }
      types.push(packet[at]);
      at += segmentSize;
    }
    if (types.length !== 1) faults.push(`packet ${n}: ${types.length} segments (${types.join(', ')}), not one`);
    packets.push({ at: Date.now(), types });
    socket.send(packet, to, '127.0.0.1');
    sent++;
  });
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', () => resolve()));
  return { port: socket.address().port, faults, packets, sent: () => sent, close: () => socket.close() };
}

/** The dissector's log, one entry per decoded packet (the lines before the first are left out). */
function readLog(file: string): { packets: Packet[]; severities: string[] } {
  const severities: string[] = [];
  const packets: Packet[] = [];
  let current: Packet | undefined;
  let target: Fields | undefined;
  for (const raw of existsSync(file) ? readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/) : []) {
    const match = /^\S+ \S+ \[(\w+)\] ?(.*)$/.exec(raw);
    if (!match) continue;
    const [, severity, line] = match;
    severities.push(severity);
    if (line.startsWith('Got GMTI packet of length')) {
      current = { severities: [], lines: [], header: {}, segment: '', fields: {}, targets: [] };
      target = undefined;
      packets.push(current);
    }
    if (!current) continue;
    current.severities.push(severity);
    current.lines.push(line);
    const raw4 = /^\s+(\w+) \(RAW\):\s*(\S+)/.exec(line);
    if (/^-- Target \d+ --$/.test(line)) current.targets.push((target = {}));
    else if (raw4) (target ?? current.fields)[raw4[1]] = raw4[2];
    else {
      const pair = /^(\S[^:]*?)\s*::\s*(.*)$/.exec(line);
      if (!pair) continue;
      if (pair[1] === 'Segment type') current.segment = pair[2].replace(/\s*\(Integer value: \d+\)$/, '').trim();
      else if (current.segment === '') current.header[pair[1]] = pair[2];
      else current.fields[pair[1]] = pair[2];
    }
  }
  return { packets, severities };
}

/** PowerShell's error records on stderr: each ends with its FullyQualifiedErrorId line. */
function errorRecords(stderr: string): Array<{ id: string; text: string }> {
  const records: Array<{ id: string; text: string }> = [];
  let text = '';
  for (const line of stderr.split(/\r?\n/)) {
    text += `${line}\n`;
    const id = /^\s+\+ FullyQualifiedErrorId : (.*)$/.exec(line);
    if (id) { records.push({ id: id[1].trim(), text }); text = ''; }
  }
  if (text.trim() !== '') records.push({ id: '(no id)', text });
  return records;
}

/** Degrees from the dissector's "... (58.4999 degrees N)" text. */
function degrees(text: string | undefined): number {
  const match = /\(([-\d.]+) degrees [NE]\)/.exec(text ?? '');
  return match ? Number(match[1]) : NaN;
}

function near(a: LonLat, b: LonLat, tolerance: number): boolean {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
}

function inSweden([lon, lat]: LonLat): boolean {
  return lon > SWEDEN.west && lon < SWEDEN.east && lat > SWEDEN.south && lat < SWEDEN.north;
}

for (const edition of EDITIONS) {
  test(`GMTI-automated-external-verification, ${edition.name}: emc2's GMTI out over UDP, decoded by the owner's dissector, keeps its format and business rules and says what the simulation sent`, async ({ browser }, testInfo) => {
    test.skip(process.platform !== 'win32', 'the dissector is a Windows PowerShell script');
    test.skip(DISSECTOR === '' || !existsSync(DISSECTOR), `optional: set EMC2_GMTI_DISSECTOR to the dissector's path${DISSECTOR === '' ? '' : ` (${DISSECTOR} does not exist)`}`);
    await verify(edition, browser, testInfo);
  });
}

async function verify(edition: EditionCase, browser: Browser, testInfo: TestInfo) {
  await withM0(testInfo, browser, async ({ server }) => {
    const all = await LiveClient.open(server.baseUrl);
    await all.subscribe({ workspaces: ['*'] });
    const port = await freeUdpPort();
    const log = testInfo.outputPath('dissector.log');
    testInfo.annotations.push({ type: 'dissector log', description: log });
    const dissector: ChildProcess = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', DISSECTOR,
      '-ipAddress', '127.0.0.1', '-port', String(port), '-LogToFile', log,
      '-showMission', '-showDwells', '-showJobDefinition', '-showPlatformLocation',
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    dissector.stderr!.on('data', (d) => (stderr += d));
    dissector.stdout!.resume();
    const tap = await startTap(port);

    // The simulation: a platform with a sensor, a still track 100 km south-west and a runner 60 km
    // east, on a route (the sensors look only while a route runs). All in Sweden.
    const [eastStart, southWest] = direct([{ from: PLATFORM, azimuth: 90, metres: 60 * KM }, { from: PLATFORM, azimuth: 200, metres: 100 * KM }]) as LonLat[];
    const runnerLine: LonLat[] = [eastStart, [eastStart[0] + 0.5, eastStart[1] + 0.2]];
    try {
      const url = `${server.baseUrl}/api/settings/plugins/gmti`;
      const values = (await (await fetch(url)).json()).values;
      const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, links: [{ name: 'dissector', mode: 'udp', direction: 'out', host: '127.0.0.1', port: tap.port, ...(edition.setting === undefined ? {} : { edition: edition.setting }) }] }) });
      expect(put.status, `gmti settings: ${await put.clone().text()}`).toBe(200);
      testInfo.annotations.push({ type: 'the out link', description: JSON.stringify((await (await fetch(url)).json()).values.links) });

      const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
      await applied(all, layer);
      const runnerRoute = route(layer.entityId, 'Runner route', runnerLine);
      await applied(all, runnerRoute);
      const runner = track(layer.entityId, 'Runner', eastStart);
      await applied(all, runner);
      await simulator(server, '/put-on-route', { route: runnerRoute.entityId, kind: 'single', objects: [runner.entityId] });
      await applied(all, track(layer.entityId, 'South-west', southWest));
      const platform = track(layer.entityId, 'Hawk 1', PLATFORM, { direction: 45, speed: 120 });
      await applied(all, platform);
      await expect.poll(async () => (await simulator(server, '/sensors')).channels.map((c: { id: string }) => c.id), { message: 'gmti\'s out channel' }).toEqual(['gmti/dissector']);
      // From M7/M8 a new ground radar's defaults (the Medium wedge: 40° dwells of 50 km, one a second,
      // Random) give several dwells a revisit and a job area away from the platform. This test's
      // checks (one dwell a revisit, D3 0 and D4 set, both reports in it, a bounding area holding the
      // platform) need M5's single look: the whole ring out to 150 km in one dwell, once a revisit.
      await simulator(server, '/sensors', {
        platform: platform.entityId, create: true, revisitSeconds: REVISIT_S, detectAll: true, mission: MISSION, outputs: ['gmti/dissector'],
        startBearing: 0, endBearing: 360, maxRange: 150 * KM, searchWidth: 360, dwellDepth: 150 * KM, dwellInterval: REVISIT_S,
      });
      testInfo.annotations.push({ type: 'the sensor', description: JSON.stringify((await simulator(server, '/sensors')).sensors) });
      // The dissector logs this line just before it binds its socket; a report sent earlier is lost.
      await expect.poll(() => existsSync(log) && readFileSync(log, 'utf8').includes('Starting UDP listener on:'), { timeout: 30_000, message: 'the dissector listens' }).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await simulator(server, '/routes/start', {});
      await new Promise((resolve) => setTimeout(resolve, LISTEN_MS));
      await simulator(server, '/routes/pause', {}); // a paused simulation sends nothing more
      // The dissector is slower than the link: wait until it has logged every packet the tap sent on.
      await expect.poll(() => readLog(log).packets.length, { timeout: 30_000, message: 'the dissector decodes every packet' }).toBe(tap.sent());
    } finally {
      dissector.kill();
      tap.close();
      await new Promise((resolve) => (dissector.exitCode !== null ? resolve(null) : dissector.once('exit', resolve)));
      writeFileSync(testInfo.outputPath('dissector.stderr.txt'), stderr);
    }

    // The packets as they came (the tap's own check of the structure): one segment in each, by
    // default (criterion 22); each report the mission, the job definition when due, the dwells.
    expect(tap.faults, 'every packet holds one segment, which fills it exactly').toEqual([]);
    const order = tap.packets.map((p) => p.types.join('+')).join(' ');
    expect(order, 'the first report: mission, job definition, dwell').toMatch(/^1 5 2( |$)/);
    expect(order, 'each report: the mission, the job definition when due, then its dwells').toMatch(/^1( 5)?( 2)+( 1( 5)?( 2)+)*$/);
    expect(tap.packets.filter((p) => p.types[0] === 1).length, 'reports came').toBeGreaterThanOrEqual(LISTEN_MS / 1000 / REVISIT_S - 1);
    const jobTimes = tap.packets.filter((p) => p.types.includes(5)).map((p) => p.at);
    expect(jobTimes.length, 'the run is long enough to see the job definition sent again').toBeGreaterThanOrEqual(2);
    const jobGaps = jobTimes.slice(1).map((t, i) => t - jobTimes[i]);
    testInfo.annotations.push({ type: 'job definitions apart (ms)', description: jobGaps.join(', ') });
    for (const gap of jobGaps) expect(gap, 'job definitions at least every 20 s plus one revisit (G7, M9.1)').toBeLessThanOrEqual(JOB_EVERY_MS + 500);

    // The dissector's own format and business rules.
    const { packets, severities } = readLog(log);
    const lines = packets.flatMap((p) => p.lines);
    expect(severities.filter((s) => s !== 'INFO'), 'no [ERROR] or [WARNING] line').toEqual([]);
    expect(lines.filter((l) => /job id set to 0|Unhandled|Invalid|not sent in time|not yet reported/.test(l)), 'none of its rules broken').toEqual([]);
    const records = errorRecords(stderr);
    const known = (r: { id: string; text: string }) => KNOWN_ERRORS.find((k) => k.id === r.id && r.text.includes(k.text));
    expect(records.filter((r) => !known(r)).map((r) => r.text), 'no script error but its two known ones').toEqual([]);
    for (const k of KNOWN_ERRORS) expect(records.filter((r) => known(r) === k).length, `${k.what}: at most once`).toBeLessThanOrEqual(1);
    const count = (segment: string) => packets.filter((p) => p.segment === segment).length;
    const sentOf = (type: number) => tap.packets.flatMap((p) => p.types).filter((t) => t === type).length;
    expect({ mission: count('Mission Segment'), job: count('Job definition segment'), dwell: count('Dwell Segment') }, 'every segment decoded as its type')
      .toEqual({ mission: sentOf(1), job: sentOf(5), dwell: sentOf(2) });

    // What it decoded is what the simulation sent.
    const jobId = packets.find((p) => p.segment === 'Dwell Segment')?.header['Job Id'];
    expect(Number(jobId), 'a job id (a dwell needs one)').toBeGreaterThan(0);
    for (const [i, { header, segment }] of packets.entries()) {
      // Edition 4: P10 0 in a packet without a dwell (G18); Edition 3 keeps the job's there too.
      const job = edition.jobIdOnlyWithADwell && segment !== 'Dwell Segment' ? '0' : jobId;
      expect({
        version: header['VersionID']?.replace(/\s+/g, ' '), nationality: header['Nationality'], classification: header['Classification'],
        exercise: header['Excercise Indicator'], platform: header['platform Id']?.trim(), job: header['Job Id'],
      }, `packet ${i} (${segment}): the header`).toEqual({
        version: edition.version, nationality: 'XN', classification: 'UNCLASSIFIED (Integer value 5)',
        exercise: 'Operation, Simulated Data (Integer value: 1)', platform: 'Hawk 1', job,
      });
    }
    for (const mission of packets.filter((p) => p.segment === 'Mission Segment')) {
      expect(mission.fields['Mission plan'], 'M1: the sensor\'s mission').toBe(MISSION);
    }
    for (const job of packets.filter((p) => p.segment === 'Job definition segment')) {
      expect(job.fields['Job Id'], 'J1: the header\'s job').toBe(jobId);
      expect(job.fields['Nominal Revisit Interval'], 'J15: the revisit time').toBe(`${REVISIT_S}s`);
      expect(job.fields['Nominal Sensor Value Detection Probability'], 'J24: "Detect all in range"').toBe('100 %');
      const lats = ['A', 'B', 'C', 'D'].map((p) => degrees(job.fields[`Bounding Area Point ${p} Lat`]));
      const lons = ['A', 'B', 'C', 'D'].map((p) => degrees(job.fields[`Bounding Area Point ${p} Long`]));
      for (const [name, [lon, lat]] of [['the platform', PLATFORM], ['South-west', southWest]] as const) {
        expect(lat >= Math.min(...lats) && lat <= Math.max(...lats) && lon >= Math.min(...lons) && lon <= Math.max(...lons), `J6–J13: the bounding area holds ${name} (${lats}, ${lons})`).toBe(true);
      }
    }

    const dwells = packets.filter((p) => p.segment === 'Dwell Segment');
    const revisits = [...new Set(dwells.map((d) => Number(d.fields.RevisitIndex)))];
    expect(revisits.length, 'revisits seen').toBeGreaterThanOrEqual(LISTEN_MS / 1000 / REVISIT_S - 1);
    for (let i = 1; i < revisits.length; i++) expect(revisits[i], 'D2 counts the revisits').toBe(revisits[i - 1] + 1);
    const msOfDay = Date.now() % 86_400_000;
    for (const revisit of revisits) {
      const segments = dwells.filter((d) => Number(d.fields.RevisitIndex) === revisit);
      for (const { fields } of segments) {
        expect({ dwell: fields.DwellIndex, last: fields.LastDwellOfRevisit }, `revisit ${revisit}: D3 0, D4 set (one dwell per revisit)`).toEqual({ dwell: '0', last: '10000000' });
        expect(near([Number(fields.SensorPosLon), Number(fields.SensorPosLat)], PLATFORM, SAME_PLACE), `revisit ${revisit}: D7, D8 the platform (${fields.SensorPosLon}, ${fields.SensorPosLat})`).toBe(true);
        const age = (msOfDay - Number(fields.DwellTime) + 86_400_000) % 86_400_000;
        expect(age, `revisit ${revisit}: D6 within the last 2 min of the mission's day`).toBeLessThan(120_000);
      }
      const reports = segments.flatMap((s) => s.targets).map((t) => [Number(t.TargetHighResLon), Number(t.TargetHighResLat)] as LonLat);
      expect(reports.length, `revisit ${revisit}: two reports`).toBe(2);
      for (const report of reports) expect(inSweden(report), `revisit ${revisit}: ${report} in Sweden`).toBe(true);
      expect(reports.filter((r) => near(r, southWest, SAME_PLACE)).length, `revisit ${revisit}: South-west at ${southWest} (${JSON.stringify(reports)})`).toBe(1);
      const onRoute = reports.filter((r) => r[0] >= runnerLine[0][0] - SAME_PLACE && r[0] <= runnerLine[1][0] && r[1] >= runnerLine[0][1] - SAME_PLACE && r[1] <= runnerLine[1][1]);
      expect(onRoute.length, `revisit ${revisit}: the runner on its route (${JSON.stringify(reports)})`).toBe(1);
    }
    testInfo.annotations.push({ type: 'decoded', description: `${tap.packets.length} packets, ${packets.length} decoded, ${revisits.length} revisits` });
  });
}
