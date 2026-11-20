// Checks the cot plugin against the real emc2 server and the ITA's TAK test double (T-040 acceptance criteria; the
// double is tests/integration/lib/tak-double.mjs, T-043, and its certificates tests/integration/lib/test-certs.mjs).
// Not part of `node tools/test.mjs`: it needs the built system (node tools/build.mjs) and a free port.
//
//   node plugins/cot/check/real-server.mjs [--port 18088]
//   node plugins/cot/check/real-server.mjs --load [seconds]     criterion 10: 1 000 events/s over 10 000 uids (default 25 s)
//
// It starts the server (dev profile, no login) on the port with an empty data folder, makes certificates with the JDK's
// keytool at run time (random passwords, in a temporary folder, never committed), runs plain and TLS doubles on local
// ports, configures the plugin through the settings API like an administrator, and observes the live picture over its
// WebSocket like a browser. It stops only the server it started. Exit code 1 if a check fails.
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import { createConnection } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cotEvent, hostile, startTakDouble } from '../../../tests/integration/lib/tak-double.mjs';
import { LiveClient } from '../../../tests/integration/lib/live.mjs';
import { listenerCredentialArgs, makeTestCertificates } from '../../../tests/integration/lib/test-certs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const jar = join(root, 'server', 'app', 'target', 'emc2-app.jar');
const pluginsDir = join(root, 'build', 'plugins');
const portArg = process.argv.indexOf('--port');
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 18088;
const base = `http://127.0.0.1:${port}`;

const results = [];
let server;

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` -- ${detail}` : ''}`);
}

/** The output channels ECore lists in the monitor view (any object with an outputType), by link name. */
async function channels() {
  const found = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      if ('outputType' in o && 'link' in o) found.push(o);
      Object.values(o).forEach(walk);
    }
  };
  walk(await get('/api/monitor'));
  return found.filter((c) => c.plugin === undefined || c.plugin === 'cot');
}

const info = (message) => console.log(`INFO  ${message}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A UDP port that is free on loopback now. */
function freeUdpPort() {
  return new Promise((resolvePort) => {
    const socket = createSocket('udp4');
    socket.bind(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(() => resolvePort(port));
    });
  });
}


async function waitFor(what, test, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      last = await test();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what} (last: ${typeof last === 'string' ? last : JSON.stringify(last)})`);
    await sleep(50);
  }
}

/** Resolves when the double has `count` connections open now. */
const waitForOpen = (double, count = 1, timeoutMs = 20_000) => waitFor(`${count} open connection(s)`, () => double.open().length >= count, timeoutMs);

// ---------------------------------------------------------------- the server

function portInUse() {
  return new Promise((resolveUse) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolveUse(true);
    });
    socket.on('error', () => resolveUse(false));
  });
}

async function startServer(dataDir, extraArgs, logFile) {
  const args = ['-Dspring.profiles.active=dev', '-jar', jar, `--emc2.plugins.directory=${pluginsDir}`, `--server.port=${port}`,
    `--emc2.data.directory=${dataDir}`, ...extraArgs];
  const log = createWriteStream(logFile, { flags: 'a' });
  const child = spawn('java', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.exited = new Promise((r) => child.once('exit', r));
  await waitFor('the server to start', () => /Tomcat started on port/.test(readFileSync(logFile, 'utf8')), 90_000);
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    await fetch(`${base}/api/dev/stop`, { method: 'POST', signal: AbortSignal.timeout(5000) });
  } catch {
    // fall through to the kill
  }
  const exited = await Promise.race([child.exited.then(() => true), sleep(20_000).then(() => false)]);
  if (!exited) {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
    await child.exited;
  }
}

async function get(path) {
  const response = await fetch(`${base}${path}`);
  return response.json();
}

async function putSettings(values) {
  const response = await fetch(`${base}/api/settings/plugins/cot`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
  const body = await response.json();
  if (response.status !== 200) throw new Error(`settings refused: ${JSON.stringify(body)}`);
  return body;
}

async function status() {
  const plugins = await get('/api/plugins');
  return plugins.find((p) => p.id === 'cot').status;
}

// ---------------------------------------------------------------- the live picture, as a browser sees it

class Picture {
  /** The live picture, through the ITA's client of /api/live (protocol 2: a subscription with an id). */
  static async open() {
    const picture = new Picture();
    picture.client = await LiveClient.open(base);
    const snapshot = await picture.client.subscribe();
    picture.seen = 0;
    picture.objectMap = new Map(snapshot.objects.map((o) => [o.id, o]));
    picture.layerMap = new Map(snapshot.layers.map((l) => [l.id, l]));
    return picture;
  }

  /** Takes in the changes that have arrived since the last look. */
  refresh() {
    const events = this.client.events;
    for (; this.seen < events.length; this.seen++) {
      const event = events[this.seen];
      const map = event.entityType === 'layer' ? this.layerMap : this.objectMap;
      if (event.operation === 'delete') map.delete(event.entityId);
      else map.set(event.entityId, event.state);
    }
  }

  get objects() {
    this.refresh();
    return this.objectMap;
  }

  get layers() {
    this.refresh();
    return this.layerMap;
  }

  /** Every change event received so far, in order. */
  get changes() {
    return this.client.events;
  }

  /** The cot objects with this uid (there should be at most one). */
  byUid(uid) {
    return [...this.objects.values()].filter((o) => o.meta?.externalRef?.system === 'cot' && o.meta.externalRef.id === uid);
  }

  async waitForObject(uid, test = () => true, timeoutMs = 10_000) {
    return waitFor(`object ${uid}`, () => {
      const found = this.byUid(uid);
      return found.length === 1 && test(found[0]) ? found[0] : undefined;
    }, timeoutMs);
  }

  layerOf(object) {
    return this.layers.get(object.layerId);
  }

  /** Sends a change request as another plugin (a user moving an object) and waits for its outcome. */
  change(request) {
    return this.client.change(request);
  }

  close() {
    this.client.socket.close(1000);
  }
}

// ---------------------------------------------------------------- the checks

const NORTH = { lat: 59.3507, lon: 18.1012 };
// A team element and a private plugin's element, as ATAK sends them with every event of a device.
const DETAIL1 = '<__group name="Cyan" role="Team Member"/><priv:plugin xmlns:priv="urn:example:private" note="a &gt; b"/>';

function streams(...list) {
  return { links: list, idleTimeoutSeconds: 300, maxEventBytes: 65536, sendPresence: true, presenceCallsign: 'emc2-check' };
}

/** An input link (M3): the old 'layerName' extra is the target layer's name. */
function stream(name, double, { layerName, ...extra } = {}) {
  return { name, direction: 'in', host: '127.0.0.1', port: double.port, transport: double.transport, ...(layerName ? { targetLayer: { name: layerName } } : {}), ...extra };
}

function prerequisites() {
  if (!existsSync(jar) || !existsSync(join(pluginsDir, 'cot', 'plugin.json'))) {
    throw new Error('build first: node tools/build.mjs (needs server/app/target/emc2-app.jar and build/plugins/cot)');
  }
}

async function main() {
  prerequisites();
  if (await portInUse()) throw new Error(`port ${port} is in use (by another agent?): not touching it`);

  const work = mkdtempSync(join(tmpdir(), 'emc2-cot-check-'));
  const dataDir = join(work, 'data');
  mkdirSync(dataDir, { recursive: true });
  // ECore removes expired CoT objects 3 s after their expiry in this check (the plugin's default is 10 minutes).
  writeFileSync(join(dataDir, 'ecore-config.json'), JSON.stringify({ format: 'emc2-config/1', pluginSettings: {}, dataTypes: { 'cot.cot': { fadeWhenExpired: true, removeAfterExpirySeconds: 3 } } }));
  const certs = makeTestCertificates(join(work, 'certs'));
  const logFile = join(work, 'server.log');
  const logFile2 = join(work, 'server-after-restart.log');
  const credentials = listenerCredentialArgs(certs, 'tak-tls');
  console.log(`work folder: ${work} (certificates, data and the server logs; removed at the end unless a check failed)`);

  const north = await startTakDouble();
  const south = await startTakDouble();
  const secure = await startTakDouble({ certs });
  let picture;

  try {
    server = await startServer(dataDir, credentials, logFile);
    picture = await Picture.open();

    // ---- criterion 12: no stream
    const idle = await status();
    check('12  without a configured link: starts, does nothing, says so', idle.detail === 'no link configured' && idle.state === 'OK', JSON.stringify(idle));

    const config = await get('/api/config');
    const declared = config.dataTypes.find((t) => t.id === 'cot.cot');
    check('5   the data type cot.cot "CoT" is declared: faded from the expiry on, removed after 10 minutes by default (this check\'s data folder overrides the removal)',
      declared?.name === 'CoT' && declared.declaredBy === 'cot' && declared.defaults.fadeWhenExpired === true && declared.defaults.removeAfterExpirySeconds === 600
      && declared.behaviour.removeAfterExpirySeconds === 3, JSON.stringify(declared));

    // ---- connect one plain stream
    await putSettings(streams(stream('tak-north', north)));
    await waitForOpen(north);
    const presence = await waitFor('the presence event', () => north.receivedText().includes('</event>') && north.receivedText(), 5000).catch(() => '');
    check('9a  presence: the first thing written on the connection is one t-x-c-t ping with the callsign, and nothing else',
      presence.startsWith('<event ') && presence.includes('type="t-x-c-t"') && presence.includes('callsign="emc2-check"') && presence.split('<event ').length === 2, presence);

    // ---- criterion 1: appears within 2 s
    const sent = Date.now();
    north.send(cotEvent({ uid: 'ANDROID-1', lat: NORTH.lat, lon: NORTH.lon, hae: 45.2, callsign: 'VIPER 2', detail: DETAIL1 }));
    const first = await picture.waitForObject('ANDROID-1', () => true, 5000);
    const took = Date.now() - sent;
    const [lon, lat, alt] = first.geometry.coordinates;
    check('1   an atom appears within 2 s', took < 2000, `${took} ms`);
    check('1   at the right position (latitude differs from longitude), with the right symbol and callsign',
      lon === 18.1012 && lat === 59.3507 && alt === 45.2 && first.symbol.sidc === 'SFGPUCI--------' && first.symbol.standard === 'APP-6B' && first.properties?.name === 'VIPER 2'
      && first.symbol.modifiers?.uniqueDesignation === 'VIPER 2', JSON.stringify(first.geometry));
    check('1   dataType cot.cot, dataSource = the stream, externalRef {cot, uid}, plugin cot',
      first.dataType === 'cot.cot' && first.dataSource === 'tak-north' && first.meta.externalRef.system === 'cot' && first.meta.externalRef.id === 'ANDROID-1'
      && first.meta.created.by.plugin === 'cot' && first.meta.created.by.system === 'tak-north', JSON.stringify(first.meta));
    check('7   a layer per stream, named like the stream', picture.layerOf(first)?.name === 'tak-north', JSON.stringify(picture.layerOf(first)));
    check('32  the object carries the field set cot.unit (ECore accepted the manifest fieldSets), and the callsign is the Callsign of the set',
      JSON.stringify(first.fieldSets) === '["cot.unit"]' && first.extensions.cot.callsign === 'VIPER 2', JSON.stringify([first.fieldSets, first.extensions.cot]));

    // ---- criterion 2: the same object moves
    north.send(cotEvent({ uid: 'ANDROID-1', detail: DETAIL1, lat: 59.4, lon: 18.2, hae: 45.2, callsign: 'VIPER 2', time: Date.now() + 1000 }));
    const moved = await picture.waitForObject('ANDROID-1', (o) => o.geometry.coordinates[1] === 59.4);
    check('2   a repeated event moves the same object (same id, higher version)', moved.id === first.id && moved.version > first.version);

    // ---- criterion 3: an older event is ignored
    north.send(cotEvent({ uid: 'ANDROID-1', detail: DETAIL1, lat: 50.5, lon: 10.5, callsign: 'VIPER 2', time: Date.now() - 60_000 }));
    north.send(cotEvent({ uid: 'ANDROID-2', lat: 57.7, lon: 11.9, callsign: 'marker', time: Date.now() + 2000 })); // a later event proves the older one was processed first
    await picture.waitForObject('ANDROID-2');
    check('3   an event older (by @time) than the one applied is ignored', picture.byUid('ANDROID-1')[0].geometry.coordinates[1] === 59.4);

    // ---- criterion 4: unmapped CoT is kept, and a user's move leaves the extension alone
    const ext = moved.extensions.cot;
    check('4   how, ce, le and the private detail element are kept unchanged in the cot extension',
      ext.how === 'm-g' && ext.ce === 9999999.0 && ext.le === 9999999.0 && ext.type === 'a-f-G-U-C-I'
      && ext.detail.includes('<priv:plugin xmlns:priv="urn:example:private" note="a &gt; b"/>') && ext.detail.includes('<__group name="Cyan" role="Team Member"/>'), JSON.stringify(ext));
    const { id, version, meta, ...core } = moved;
    const userMove = await picture.change({ requestId: crypto.randomUUID(), entityType: 'object', operation: 'update', entityId: id, baseVersion: version,
      data: { ...core, geometry: { type: 'Point', coordinates: [11.9746, 57.7089] }, extensions: { 'draw-symbols': { by: 'a user' } } }, source: { plugin: 'draw-symbols' } });
    const afterMove = await picture.waitForObject('ANDROID-1', (o) => o.geometry.coordinates[0] === 11.9746);
    check('4   after a user moves the object, the cot extension is unchanged (ADR-0018)', userMove.outcome === 'applied' && JSON.stringify(afterMove.extensions.cot) === JSON.stringify(ext)
      && afterMove.extensions['draw-symbols']?.by === 'a user', JSON.stringify(afterMove.extensions));
    north.send(cotEvent({ uid: 'ANDROID-1', detail: DETAIL1, lat: 59.5, lon: 18.3, callsign: 'VIPER 2', time: Date.now() + 5000 }));
    const afterEvent = await picture.waitForObject('ANDROID-1', (o) => o.geometry.coordinates[1] === 59.5);
    check('4   the next event from TAK overwrites the core fields and keeps the other plugin\'s extension', afterEvent.extensions['draw-symbols']?.by === 'a user');

    // ---- criterion 6: bad input (the double's hostile documents)
    const connectionsBefore = north.connections.length;
    north.sendRaw(hostile.malformed());
    north.sendRaw(hostile.truncated()); // no end tag: the next event must not be lost with it
    north.sendRaw(hostile.externalEntity(north.entityUrl));
    north.sendRaw(hostile.entityExpansion());
    north.sendRaw(hostile.huge());
    north.send(cotEvent({ uid: 'AFTER-BAD', lat: 56.0, lon: 12.0, callsign: 'still here' }));
    await picture.waitForObject('AFTER-BAD');
    const afterBad = await waitFor('the status to count the dropped events', async () => {
      const s = await status();
      return /malformed 4/.test(s.detail) && /too large 1/.test(s.detail) ? s : undefined;
    }, 5000).catch(() => status());
    check('6   malformed XML, a cut-off event, a DTD with an external entity, a billion laughs and a 1 MB event are dropped and counted; the stream continues',
      north.connections.length === connectionsBefore && north.open().length === 1 && /malformed 4/.test(afterBad.detail) && /too large 1/.test(afterBad.detail)
      && ['ita-malformed', 'ita-truncated', 'ita-xxe', 'ita-laughs', 'ita-huge'].every((uid) => picture.byUid(uid).length === 0), afterBad.detail);
    check('6   no external entity was fetched (the double counts requests to its entity URL)', north.entityRequests.length === 0, JSON.stringify(north.entityRequests));
    const log = readFileSync(logFile, 'utf8');
    const warnings = log.split('\n').filter((l) => /WARN/.test(l) && /link tak-north: dropped an event/.test(l));
    check('6   at most one warning per minute is logged', warnings.length === 1, `${warnings.length} warnings`);

    // ---- criterion 7: a lost stream is connected again with the back-off, and other streams are not affected
    await putSettings(streams(stream('tak-north', north), stream('tak-south', south)));
    await waitForOpen(south);
    south.send(cotEvent({ uid: 'SOUTH-1', lat: 55.5, lon: 13.5, callsign: 'south one' }));
    await picture.waitForObject('SOUTH-1');
    await north.goAway('reset'); // new connections are reset at once; refused.times shows the back-off
    await waitFor('the status to show tak-north lost', async () => {
      const s = await status();
      return /tak-north: not connected/.test(s.detail) && s.state === 'DEGRADED' ? s : undefined;
    }, 5000).then((s) => check('7   the plugin status shows each stream\'s state (monitor view)', true, s.detail), () => check('7   the plugin status shows the lost stream', false, 'not seen'));
    south.send(cotEvent({ uid: 'SOUTH-1', lat: 55.6, lon: 13.6, callsign: 'south one', time: Date.now() + 1000 }));
    await picture.waitForObject('SOUTH-1', (o) => o.geometry.coordinates[1] === 55.6, 5000)
      .then(() => check('7   another stream is not affected', true), () => check('7   another stream is not affected', false));
    await waitFor('three refused attempts', () => north.refused.times.length >= 3, 40_000).catch(() => undefined);
    const times = north.refused.times;
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / 1000);
    // ECore's first delay after a lost connection is 2 s, not 1 s as function 8 says (it counts the failure before it asks the back-off): reported to the MCA.
    console.log(`      attempts ${times.length}, gaps between them: ${gaps.map((g) => g.toFixed(2)).join(', ')} s`);
    check('7   the delay between attempts doubles', gaps.length >= 2 && Math.abs(gaps[1] / gaps[0] - 2) < 0.25, gaps.map((g) => g.toFixed(2)).join(', '));
    await north.comeBack();
    await waitForOpen(north, 1, 45_000).then(() => check('7   the lost stream is connected again when the TAK system comes back', true),
      () => check('7   the lost stream is connected again when the TAK system comes back', false));
    await waitFor('tak-north connected again', async () => (await status()).state === 'OK', 8000)
      .then(() => check('7   and the status is OK again', true), () => check('7   and the status is OK again', false));
    north.send(cotEvent({ uid: 'ANDROID-1', detail: DETAIL1, lat: 59.6, lon: 18.4, callsign: 'VIPER 2', time: Date.now() + 8000 }));
    await picture.waitForObject('ANDROID-1', (o) => o.geometry.coordinates[1] === 59.6, 5000)
      .then(() => check('7   events flow again after the reconnect', true), () => check('7   events flow again after the reconnect', false));

    // ---- criterion 8: two streams, one uid
    north.send(cotEvent({ uid: 'SHARED', lat: 58.1, lon: 14.1, callsign: 'shared', time: Date.now() + 10_000 }));
    const sharedFirst = await picture.waitForObject('SHARED');
    south.send(cotEvent({ uid: 'SHARED', lat: 58.2, lon: 14.2, callsign: 'shared', time: Date.now() + 11_000 }));
    const sharedMoved = await picture.waitForObject('SHARED', (o) => o.geometry.coordinates[1] === 58.2);
    check('8   different streams give different dataSource values, each in its own layer',
      picture.byUid('SOUTH-1')[0].dataSource === 'tak-south' && picture.layerOf(picture.byUid('SOUTH-1')[0]).name === 'tak-south'
      && sharedFirst.layerId !== picture.byUid('SOUTH-1')[0].layerId);
    check('8   the same uid on both streams is one object that keeps the first stream\'s dataSource and layer, and names the stream of each change',
      sharedMoved.id === sharedFirst.id && sharedMoved.dataSource === 'tak-north' && sharedMoved.layerId === sharedFirst.layerId
      && sharedMoved.meta.modified.by.system === 'tak-south' && sharedMoved.meta.created.by.system === 'tak-north', JSON.stringify(sharedMoved.meta));

    // ---- criterion 9: TLS with a client certificate
    await putSettings(streams(stream('tak-north', north), stream('tak-south', south), stream('tak-tls', secure, { layerName: 'TAK (TLS)' })));
    await waitForOpen(secure, 1, 20_000).then(
      () => check('9   TLS with a client certificate connects to a test double with certificates made at test time', true),
      () => check('9   TLS with a client certificate connects to a test double with certificates made at test time', false, `${secure.rejected.join('; ')} / ${(readFileSync(logFile, 'utf8').split('\n').filter((l) => /tak-tls/.test(l)).slice(-3)).join(' | ')}`));
    if (secure.open().length === 1) {
      check('9   the double saw the client certificate', secure.open()[0].authorized === true && secure.open()[0].peer === certs.clientName, `${secure.open()[0].authorized} ${secure.open()[0].peer}`);
      secure.send(cotEvent({ uid: 'TLS-1', lat: 54.4, lon: 9.9, callsign: 'over tls' }));
      const tlsObject = await picture.waitForObject('TLS-1', () => true, 5000).catch(() => undefined);
      check('9   and its events appear: dataSource tak-tls, layer "TAK (TLS)"', tlsObject?.dataSource === 'tak-tls' && picture.layerOf(tlsObject)?.name === 'TAK (TLS)');
      check('9   the presence event also goes over TLS', secure.receivedText().includes('type="t-x-c-t"'));
    }
    const settingsText = JSON.stringify(await get('/api/settings/plugins/cot'));
    const allLog = readFileSync(logFile, 'utf8');
    check('9   no certificate, key or password is in the settings or in the server log', !settingsText.includes(certs.password) && !allLog.includes(certs.password) && !/BEGIN (RSA |EC )?PRIVATE KEY/.test(allLog));

    // ---- criterion 5: ECore removes expired objects; the plugin never deletes
    north.send(cotEvent({ uid: 'SHORT-LIVED', lat: 53.3, lon: 8.8, callsign: 'short', time: Date.now(), stale: Date.now() + 2000 }));
    const shortLived = await picture.waitForObject('SHORT-LIVED');
    check('5   @time, @start and @stale end up in the time attributes', !!shortLived.time?.observed && !!shortLived.time?.validFrom && Date.parse(shortLived.time.expires) - Date.parse(shortLived.time.observed) <= 2000, JSON.stringify(shortLived.time));
    await waitFor('ECore to remove the expired object', () => picture.byUid('SHORT-LIVED').length === 0, 25_000)
      .then(() => check('5   ECore removes the object after the data type\'s removal time (set to 3 s here)', true), () => check('5   ECore removes the object after the data type\'s removal time', false));
    const removal = picture.changes.find((e) => e.operation === 'delete' && e.entityId === shortLived.id);
    check('5   and the plugin did not delete it', !!removal && removal.by.plugin !== 'cot', JSON.stringify(removal?.by));
    check('5   the plugin has deleted nothing at all', !picture.changes.some((e) => e.operation === 'delete' && e.by.plugin === 'cot'));
    north.send(cotEvent({ uid: 'SHORT-LIVED', lat: 53.4, lon: 8.9, callsign: 'short again', time: Date.now(), stale: Date.now() + 600_000 }));
    await picture.waitForObject('SHORT-LIVED', (o) => o.geometry.coordinates[1] === 53.4)
      .then(() => check('2/5 a deleted object is created again by the next event for its uid', true), () => check('2/5 a deleted object is created again by the next event for its uid', false));

    // ---- criterion 2: a restart of the server does not duplicate objects
    const idsBefore = new Map([...picture.objects.values()].filter((o) => o.meta?.externalRef?.system === 'cot').map((o) => [o.meta.externalRef.id, o.id]));
    picture.close();
    await stopServer(server);
    server = await startServer(dataDir, credentials, logFile2);
    picture = await Picture.open();
    await waitFor('all three streams connected again', () => north.open().length === 1 && south.open().length === 1 && secure.open().length === 1, 30_000)
      .then(() => check('2   after a restart the streams from the stored settings are connected again', true), () => check('2   after a restart the streams from the stored settings are connected again', false));
    const restored = [...picture.objects.values()].filter((o) => o.meta?.externalRef?.system === 'cot');
    north.send(cotEvent({ uid: 'ANDROID-1', detail: DETAIL1, lat: 59.7, lon: 18.5, callsign: 'VIPER 2', time: Date.now() + 20_000 }));
    north.send(cotEvent({ uid: 'SHARED', lat: 58.3, lon: 14.3, callsign: 'shared', time: Date.now() + 20_000 }));
    await picture.waitForObject('ANDROID-1', (o) => o.geometry.coordinates[1] === 59.7);
    await picture.waitForObject('SHARED', (o) => o.geometry.coordinates[1] === 58.3);
    const uids = restored.map((o) => o.meta.externalRef.id);
    check('2   no second object is created after a restart: same ids, one object per uid, layers not made again',
      new Set(uids).size === uids.length && idsBefore.get('ANDROID-1') === picture.byUid('ANDROID-1')[0].id && idsBefore.get('SHARED') === picture.byUid('SHARED')[0].id
      && [...picture.layers.values()].filter((l) => ['tak-north', 'tak-south', 'TAK (TLS)'].includes(l.name)).length === 3, `${[...picture.layers.values()].map((l) => l.name)}`);

    // ---- M3 (criteria 14, 22, 23, 24): UDP links on loopback, two links sharing a new layer, stored streams
    const udpA = await freeUdpPort();
    const udpB = await freeUdpPort();
    const udpLink = (name, port) => ({ name, direction: 'in', transport: 'udp', port, targetLayer: { name: 'Shared mesh' } });
    await putSettings(streams(stream('tak-north', north), stream('tak-south', south), stream('tak-tls', secure, { layerName: 'TAK (TLS)' }), udpLink('mesh-a', udpA), udpLink('mesh-b', udpB)));
    await waitFor('both UDP links to listen', async () => /mesh-a: listening since/.test((await status()).detail) && /mesh-b: listening since/.test((await status()).detail), 10_000)
      .catch(() => undefined);
    const detail0 = (await status()).detail;
    check('14/23 a UDP link with no address listens on 127.0.0.1 only (status)', new RegExp(`mesh-a: listening since[^;]*\\[in udp 127\\.0\\.0\\.1:${udpA}\\]`).test(detail0), detail0);
    const sender = createSocket('udp4');
    const sendTo = (event, port, address = '127.0.0.1') => new Promise((resolveSend) => sender.send(Buffer.from(event), port, address, () => resolveSend()));
    await sendTo(cotEvent({ uid: 'MESH-A1', lat: 58.1, lon: 15.2, callsign: 'mesh a' }), udpA);
    await sendTo(cotEvent({ uid: 'MESH-B1', lat: 57.1, lon: 14.2, callsign: 'mesh b' }), udpB);
    const meshA = await picture.waitForObject('MESH-A1', () => true, 5000).catch(() => undefined);
    const meshB = await picture.waitForObject('MESH-B1', () => true, 5000).catch(() => undefined);
    check('14  a datagram is one event, shown at the right position (latitude differs from longitude), with dataSource = the link',
      meshA?.dataSource === 'mesh-a' && meshA.geometry.coordinates[0] === 15.2 && meshA.geometry.coordinates[1] === 58.1 && meshB?.dataSource === 'mesh-b');
    check('22  two links that name the same new layer share one', !!meshA && !!meshB && meshA.layerId === meshB.layerId && [...picture.layers.values()].filter((l) => l.name === 'Shared mesh').length === 1);
    const nonLoopback = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (nonLoopback) {
      await sendTo(cotEvent({ uid: 'MESH-OUT', lat: 56.1, lon: 13.2, callsign: 'not loopback' }), udpA, nonLoopback.address);
      await sleep(1000);
      check('23  a UDP link bound to loopback does not receive what is sent to this computer\'s network address', picture.byUid('MESH-OUT').length === 0, nonLoopback.address);
    }
    sender.close();
    const stored = { ...streams(stream('tak-north', north)), streams: [{ name: 'old-north', host: '127.0.0.1', port: 9, transport: 'tcp' }] };
    await putSettings(stored);
    const withStored = await waitFor('the status to name the stored streams', async () => { const s = await status(); return /1 stored streams \(old-north\) are no longer read/.test(s.detail) ? s : undefined; }, 5000).catch(() => undefined);
    check('24  stored streams of earlier versions are not read, and the status says so', !!withStored && withStored.state === 'DEGRADED', JSON.stringify(withStored));
    await putSettings(streams(stream('tak-north', north), stream('tak-south', south), stream('tak-tls', secure, { layerName: 'TAK (TLS)' })));

    // ---- M3 part 2 (criteria 14, 16 to 19): output from a source layer, the echo, the classification, stale and refresh
    const drawingLayerId = [...picture.layers.values()].find((l) => l.name === 'Drawing').id;
    const sourceLayers = [{ id: drawingLayerId, name: 'Drawing' }];
    const outLink = (name, double, direction, extra = {}) => ({ name, direction, host: '127.0.0.1', port: double.port, transport: 'tcp', sourceLayers, ...extra });
    const withOutput = (...more) => streams(stream('tak-north', north), stream('tak-south', south), stream('tak-tls', secure, { layerName: 'TAK (TLS)' }), ...more);
    const sentEvents = (double) => [...double.receivedText().matchAll(/<event [\s\S]*?<\/event>/g)].map((m) => m[0]).filter((e) => !/type="t-x-c-t"/.test(e));
    const attr = (event, name) => new RegExp(`${name}="([^"]*)"`).exec(event)?.[1];
    const drawn = async (name, lon, lat, label = 'UNCLASSIFIED', sidc = '10061000001211000000') => {
      const request = { requestId: crypto.randomUUID(), entityType: 'object', operation: 'create', entityId: crypto.randomUUID(),
        data: { type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId: drawingLayerId, geometry: { type: 'Point', coordinates: [lon, lat] },
          symbol: { standard: 'APP-6D', sidc }, properties: { name }, label: { policyIdentifier: { name: 'NATO' }, classification: label } }, source: { plugin: 'ita-test' } };
      const outcome = await picture.change(request);
      if (outcome.outcome !== 'applied') throw new Error(`could not draw ${name}: ${JSON.stringify(outcome)}`);
      return { id: request.entityId, request, version: outcome.event.version };
    };

    const outD = await startTakDouble();
    const bothD = await startTakDouble();
    const shown = await drawn('M3 ALPHA', 11.9746, 57.7089); // hostile infantry; longitude 11.9746, latitude 57.7089
    await putSettings(withOutput(outLink('tak-out', outD, 'out', { refreshSeconds: 0 }), outLink('tak-both', bothD, 'both', { refreshSeconds: 0 })));
    await waitFor('the output links to be connected', async () => /tak-out: connected since/.test((await status()).detail) && /tak-both: connected since/.test((await status()).detail), 10_000)
      .catch(async () => info(`output links not up: ${JSON.stringify(await status())}`));
    const offered = await waitFor('the output channels', async () => { const c = await channels(); return c.length >= 2 ? c : undefined; }, 10_000).catch(() => []);
    check('15  every enabled out or both link is an output channel cot/<link>: type cot, can delete (the monitor view lists them)',
      ['tak-out', 'tak-both'].every((name) => offered.some((c) => c.link === name && c.outputType === 'cot' && c.canDelete === true)) && !offered.some((c) => c.link === 'tak-north'), JSON.stringify(offered));
    await waitFor('the firstOut object at the out link', () => sentEvents(outD).length >= 1, 10_000).catch(() => {});
    const firstOut = sentEvents(outD)[0] ?? '';
    check('14  an out link sends the objects of its source layer when it starts, as CoT: type, uid (the object id), position (latitude differs from longitude), callsign',
      attr(firstOut, 'type') === 'a-h-G-U-C-I' && attr(firstOut, 'uid') === shown.id && attr(firstOut, 'lat') === '57.7089' && attr(firstOut, 'lon') === '11.9746' && /callsign="M3 ALPHA"/.test(firstOut), firstOut.slice(0, 400));
    check('14  the event is stale after its time, and the status says what was sent', Date.parse(attr(firstOut, 'stale')) > Date.parse(attr(firstOut, 'time')) && /tak-out: connected since[^;]*[1-9][0-9]* sent/.test((await status()).detail), (await status()).detail);
    await waitFor('the object at the both link too', () => sentEvents(bothD).length >= 1, 10_000).catch(() => {});
    check('14  a both link sends over the connection it also receives on (one connection)', sentEvents(bothD).length >= 1 && bothD.connections.length === 1, `${bothD.connections.length}`);

    // an update is an event, an unchanged object is not sent again
    const sentBefore = sentEvents(outD).length;
    const moveOutcome = await picture.change({ requestId: crypto.randomUUID(), entityType: 'object', operation: 'update', entityId: shown.id, baseVersion: shown.version,
      data: { ...shown.request.data, geometry: { type: 'Point', coordinates: [12.5, 58.25] } }, source: { plugin: 'ita-test' } });
    await waitFor('the update at the out link', () => sentEvents(outD).length > sentBefore, 10_000).catch(() => {});
    const movedEvent = sentEvents(outD).at(-1) ?? '';
    check('14  an update is sent as an event for the same uid at the new position', moveOutcome.outcome === 'applied' && attr(movedEvent, 'uid') === shown.id && attr(movedEvent, 'lon') === '12.5' && attr(movedEvent, 'lat') === '58.25', movedEvent.slice(0, 300));

    // classification: an object above the link's limit (the server's default label's) is not sent
    const secret = await drawn('M3 SECRET', 13.0, 59.0, 'SECRET');
    await sleep(1500);
    check('17  an object above the highest classification is not sent, and is counted', !outD.receivedText().includes('M3 SECRET') && /skipped [0-9]+ \(above the highest classification/.test((await status()).detail), (await status()).detail);

    // deleting an object sends one event that is stale at once
    const goneOutcome = await picture.change({ requestId: crypto.randomUUID(), entityType: 'object', operation: 'delete', entityId: shown.id, baseVersion: moveOutcome.event.version, source: { plugin: 'ita-test' } });
    await waitFor('the stale event', () => sentEvents(outD).length > sentBefore + 1, 10_000).catch(() => {});
    const staleEvent = sentEvents(outD).at(-1) ?? '';
    check('18  a deleted object is sent as an event that is stale at once', goneOutcome.outcome === 'applied' && attr(staleEvent, 'uid') === shown.id && attr(staleEvent, 'stale') === attr(staleEvent, 'time'), staleEvent.slice(0, 300));

    // no echo: an object that comes in on the both link goes out on no link of its own, and the same uid returned by TAK ends the loop
    bothD.send(cotEvent({ uid: 'M3-IN', lat: 56.5, lon: 14.25, callsign: 'from tak', time: Date.now(), stale: Date.now() + 300_000 }));
    const arrived = await picture.waitForObject('M3-IN', () => true, 8000).catch(() => undefined);
    await sleep(1500);
    check('16  an object received on a both link is not sent back on it (the loop through a TAK Server is checked by hand against the real one)', !!arrived && !bothD.receivedText().includes('uid="M3-IN"'), arrived ? '' : 'did not arrive');
    check('16  nor is it sent to an out link whose source layer it is not in', !outD.receivedText().includes('M3-IN'));

    // refresh and stale times: a link with refreshSeconds 2 and staleSeconds 5 sends an unchanged object again, with a later time
    const refreshD = await startTakDouble();
    const steady = await drawn('M3 STEADY', 10.5, 56.25, 'UNCLASSIFIED', '10031000001211000000');
    await putSettings(withOutput(outLink('tak-out', outD, 'out', { refreshSeconds: 0 }), outLink('tak-both', bothD, 'both', { refreshSeconds: 0 }), outLink('tak-refresh', refreshD, 'out', { refreshSeconds: 2, staleSeconds: 5 })));
    await waitFor('refreshed events', () => sentEvents(refreshD).filter((e) => attr(e, 'uid') === steady.id).length >= 3, 15_000).catch(() => {});
    const steadyEvents = sentEvents(refreshD).filter((e) => attr(e, 'uid') === steady.id);
    check('19  an unchanged object is sent again after refreshSeconds, with a later time and a stale time of staleSeconds',
      steadyEvents.length >= 3 && Date.parse(attr(steadyEvents[1], 'time')) > Date.parse(attr(steadyEvents[0], 'time'))
      && Math.abs(Date.parse(attr(steadyEvents[0], 'stale')) - Date.parse(attr(steadyEvents[0], 'time')) - 5000) <= 1000 && attr(steadyEvents[0], 'type') === 'a-f-G-U-C-I', `${steadyEvents.length}`);
    check('19  a link with refreshSeconds 0 sent it once', sentEvents(outD).filter((e) => attr(e, 'uid') === steady.id).length === 1, `${sentEvents(outD).filter((e) => attr(e, 'uid') === steady.id).length}`);
    check('19  the status warns when refreshSeconds is 0', /tak-out:[^;]*WARNING: refresh 0/.test((await status()).detail), (await status()).detail);
    await putSettings(withOutput(outLink('tak-renamed', outD, 'out', { refreshSeconds: 0 }), { ...outLink('tak-both', bothD, 'both', { refreshSeconds: 0 }), enabled: false }));
    const after = await waitFor('the renamed channel', async () => { const c = await channels(); return c.some((x) => x.link === 'tak-renamed') ? c : undefined; }, 10_000).catch(() => []);
    check('15  renaming a link withdraws the old channel and offers the new one; disabling a link withdraws its channel',
      after.some((c) => c.link === 'tak-renamed') && !after.some((c) => c.link === 'tak-out') && !after.some((c) => c.link === 'tak-both'), JSON.stringify(after));
    await Promise.all([outD.close(), bothD.close(), refreshD.close()]).catch(() => {});
    await putSettings(streams(stream('tak-north', north), stream('tak-south', south), stream('tak-tls', secure, { layerName: 'TAK (TLS)' })));

    // ---- criterion 11 (no threads/sockets/locks of its own) is the ArchUnit rule set, run by mvn verify; here only: nothing failed in the log
    const finalLog = readFileSync(logFile, 'utf8') + readFileSync(logFile2, 'utf8');
    check('11  the server log has no error from the cot plugin', !/ERROR.*cot/i.test(finalLog), finalLog.split('\n').filter((l) => /ERROR.*cot/i.test(l)).slice(0, 3).join(' | '));
  } finally {
    picture?.close();
    await stopServer(server).catch(() => {});
    await Promise.all([north.close(), south.close(), secure.close()]).catch(() => {});
    const failed = results.some((r) => !r.ok);
    if (!failed) rmSync(work, { recursive: true, force: true });
    else console.log(`kept for inspection: ${work}`);
  }
}

// ---------------------------------------------------------------- load: criterion 10 against the real server

async function loadMain() {
  prerequisites();
  if (await portInUse()) throw new Error(`port ${port} is in use (by another agent?): not touching it`);
  const work = mkdtempSync(join(tmpdir(), 'emc2-cot-load-'));
  const dataDir = join(work, 'data');
  mkdirSync(dataDir, { recursive: true });
  const logFile = join(work, 'server.log');
  const UIDS = 10_000;
  const RATE = 1_000;
  const SECONDS = Number(process.argv[process.argv.indexOf('--load') + 1]) || 25;
  const north = await startTakDouble();
  let picture;
  try {
    server = await startServer(dataDir, [], logFile);
    picture = await Picture.open();
    await putSettings({ ...streams(stream('tak-north', north)), sendPresence: false });
    await waitForOpen(north);
    const parse = async () => {
      const s = await status();
      const n = (word) => Number(new RegExp(`([0-9]+) ${word}`).exec(s.detail)?.[1] ?? 0);
      return { state: s.state, read: n('read'), created: n('created'), updated: n('updated'), detail: s.detail };
    };
    console.log(`sending ${RATE} events per second over ${UIDS} uids for ${SECONDS} s to the real server (the double's stream())`);
    const started = Date.now();
    let worstLag = 0;
    const streaming = north.stream({ rate: RATE, uids: UIDS, seconds: SECONDS });
    let done = false;
    streaming.then(() => (done = true));
    while (!done) {
      await sleep(1000);
      const seen = await parse();
      const lag = seen.read - seen.created - seen.updated;
      worstLag = Math.max(worstLag, lag);
      console.log(`  t=${((Date.now() - started) / 1000).toFixed(1)} s | plugin read ${seen.read}, created ${seen.created}, updated ${seen.updated}, lag ${lag}, ${seen.state}`);
    }
    const { sent, ratePerSecond } = await streaming;
    const settled = await waitFor('the plugin to apply everything', async () => {
      const seen = await parse();
      return seen.read >= sent && seen.created + seen.updated >= sent ? seen : undefined;
    }, 60_000).catch(async () => parse());
    check('10  1 000 events per second over 10 000 uids are sent and all are read by the plugin', settled.read === sent && ratePerSecond > 900, `${settled.read} read of ${sent}, ${ratePerSecond.toFixed(0)} events/s`);
    check('10  all are applied: created + updated = events sent, nothing dropped', settled.created + settled.updated === sent && !/dropped/.test(settled.detail), settled.detail);
    check('10  the backlog stayed small while it ran (worst: read minus applied)', worstLag < 2_000, `worst lag ${worstLag}`);
    await waitFor('the live picture to show all objects', () => [...picture.objects.values()].filter((o) => o.meta?.externalRef?.system === 'cot').length === UIDS, 30_000)
      .then(() => check('10  every uid is one object in the live picture', true), () => check('10  every uid is one object in the live picture', false, `${picture.objects.size} objects`));
    const log = readFileSync(logFile, 'utf8');
    check('10  the server log has no error and no warning from the cot plugin', !/(WARN|ERROR).*cot/i.test(log), log.split('\n').filter((l) => /(WARN|ERROR).*cot/i.test(l)).slice(0, 3).join(' | '));
    check('10  the plugin status is OK', settled.state === 'OK', settled.detail);
  } finally {
    picture?.close();
    await stopServer(server).catch(() => {});
    await north.close().catch(() => {});
    if (!results.some((r) => !r.ok)) rmSync(work, { recursive: true, force: true });
    else console.log(`kept for inspection: ${work}`);
  }
}

(process.argv.includes('--load') ? loadMain : main)().then(
  () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed against the real server`);
    process.exit(failed.length > 0 ? 1 : 0);
  },
  (error) => {
    console.error(`\nERROR: ${error.stack ?? error}`);
    process.exit(2);
  },
);
