// The multi-instance mass test (owner, 2026-11-20; mass/PLAN.md). Started only by mass/run.mjs, never by the quick or
// the full run. N instances exchange a known set over cot (through the ESA's TAK Server, or directly over UDP) and nvg
// (provider and consumer), move it, and run a simulation whose ground truth and GMTI go to the others. Every count and
// mismatch goes into report.md; the run fails on any problem, and a product fault is reported, not worked around.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { checkLog } from '../lib/log-check.mjs';
import { createLayer } from '../lib/live.mjs';
import { root } from '../lib/server.mjs';
import { freeUdp, getJson, postJson, putSettings, sampleLoad, startInstance, TAK_CREDENTIAL, takCredentialsMissing, type Instance } from './instances';
import { COT_LABEL, graphics, HIGHEST, symbols, type Item, type LonLat } from './known-set';
import { newReport, writeReport, type Mismatch, type Propagation, type Report, type Row } from './report';

const P = {
  instances: 2,
  phases: [1, 2, 3],
  links: ['cot', 'nvg', 'gmti'],
  objects: 25,
  moveInterval: 2,
  duration: 120,
  share: 0.2,
  both: false,
  directCot: false,
  echo: false,
  conflict: false,
  seed: 1,
  keep: false,
  release: '',
  ...JSON.parse(process.env.EMC2_MASS ?? '{}'),
};
const OUT = process.env.EMC2_OUT ?? resolve('out', 'mass-manual');
const SIMULATION = 'simulator.simulation';
const NVG_INTERVAL_S = 10;
const SAME = 1e-7;
const KM = 1000;
const REVISIT_S = 5;

const letter = (i: number) => String.fromCharCode(65 + i);
const lower = (i: number) => letter(i).toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A small seeded random number generator (mulberry32), so the moves are the same on every run with a seed. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ESA's TAK Server status (external/tak-server/status.mjs): healthy or not, and its last line. */
function takStatus(): { healthy: boolean; line: string } {
  let text = '';
  try {
    text = execFileSync(process.execPath, [join(root, 'external', 'tak-server', 'status.mjs')], { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error: any) {
    text = String(error.stdout ?? '') + String(error.stderr ?? '');
  }
  const line = text.trim().split(/\r?\n/).filter((l) => /STATUS/.test(l)).pop() ?? text.trim().split(/\r?\n/).pop() ?? '';
  return { healthy: /STATUS:\s*healthy/i.test(line), line: line.replace(/password\S*/gi, '') };
}

/** Applies create or update requests with at most 50 waiting (the server takes 100 a session). */
async function applyAll(instance: Instance, requests: any[]): Promise<any[]> {
  const states: any[] = [];
  for (let start = 0; start < requests.length; start += 50) {
    const batch = requests.slice(start, start + 50);
    const outcomes = await Promise.all(batch.map((r) => instance.live.change(r, 30_000)));
    outcomes.forEach((o: any, i) => {
      if (o.outcome !== 'applied') throw new Error(`${instance.name}: ${batch[i].operation} ${batch[i].data?.properties?.name ?? batch[i].entityId}: ${JSON.stringify(o.rejection ?? o)}`);
      states.push(o.event.state);
    });
  }
  return states;
}

function updateRequest(state: any, changes: Record<string, unknown>) {
  const { id, version, meta: _meta, ...data } = state;
  return { requestId: randomUUID(), entityType: 'object', operation: 'update', entityId: id, baseVersion: version, data: { ...data, ...changes }, source: { plugin: 'ita-test' } };
}

// ---- Geometry ----

const near = (a: number[], b: number[], tolerance = SAME) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
const openRing = (ring: number[][]) => (ring.length > 1 && near(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring);

/** The same ring, whichever point it starts at and whichever way round (the store may turn a ring). */
function sameRing(a: number[][], b: number[][]) {
  const x = openRing(a);
  const y = openRing(b);
  if (x.length !== y.length) return false;
  for (const candidate of [y, [...y].reverse()]) {
    for (let shift = 0; shift < candidate.length; shift++) {
      if (x.every((p, i) => near(p, candidate[(i + shift) % candidate.length]))) return true;
    }
  }
  return false;
}

function sameGeometry(a: any, b: any): boolean {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'Point') return near(a.coordinates, b.coordinates);
  if (a.type === 'LineString') return a.coordinates.length === b.coordinates.length && a.coordinates.every((p: number[], i: number) => near(p, b.coordinates[i]));
  if (a.type === 'Polygon') return a.coordinates.length === b.coordinates.length && a.coordinates.every((r: number[][], i: number) => sameRing(r, b.coordinates[i]));
  return JSON.stringify(a) === JSON.stringify(b);
}

/** How far apart two geometries' first points are, in metres (a sphere; for the report only). */
function offMetres(a: any, b: any): number {
  const first = (g: any): number[] => (g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0]);
  const [p, q] = [first(a), first(b)];
  const rad = Math.PI / 180;
  const h = Math.sin(((q[1] - p[1]) * rad) / 2) ** 2 + Math.cos(p[1] * rad) * Math.cos(q[1] * rad) * Math.sin(((q[0] - p[0]) * rad) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

function translate(geometry: any, dx: number, dy: number): any {
  const move = (p: number[]) => [Math.round((p[0] + dx) * 1e7) / 1e7, Math.round((p[1] + dy) * 1e7) / 1e7];
  if (geometry.type === 'Point') return { type: 'Point', coordinates: move(geometry.coordinates) };
  if (geometry.type === 'LineString') return { type: 'LineString', coordinates: geometry.coordinates.map(move) };
  return { type: 'Polygon', coordinates: geometry.coordinates.map((r: number[][]) => r.map(move)) };
}

// ---- What each link carries (mass/PLAN.md, section 1) ----

type Link = 'cot' | 'nvg';
const RANK: Record<string, number> = { UNCLASSIFIED: 0, RESTRICTED: 1, CONFIDENTIAL: 2, SECRET: 3, 'COSMIC TOP SECRET': 4 };
const sendable = (item: Item) => RANK[item.classification] <= RANK[HIGHEST.classification];
/** cot sends a `core.symbol` with a point; anything else it skips and counts (cot readme, "What goes out"). */
const cotCarries = (item: Item) => item.kind === 'symbol';

/** APP-6B identity letter to APP-6D's identity digit. */
const IDENTITY_6B: Record<string, string> = { P: '0', U: '1', A: '2', F: '3', N: '4', S: '5', H: '6', J: '6', K: '6' };
const COT_MODIFIERS = ['uniqueDesignation', 'higherFormation', 'quantity', 'staffComments', 'additionalInformation', 'direction', 'speed'];

function compare(link: Link, item: Item, copy: any): Mismatch[] {
  const src = item.request.data;
  const out: Mismatch[] = [];
  const check = (field: string, ok: boolean, expected: unknown, got: unknown) => {
    if (!ok) out.push({ object: item.name, field, expected, got });
  };
  check('type', copy.type === src.type, src.type, copy.type);
  check('geometry', sameGeometry(src.geometry, copy.geometry), src.geometry, copy.geometry);
  check('name', copy.properties?.name === src.properties.name, src.properties.name, copy.properties?.name);
  if (link === 'nvg') {
    check('label', copy.label?.policyIdentifier?.name === src.label.policyIdentifier.name && copy.label?.classification === src.label.classification, src.label, copy.label);
    if (src.label.categories) check('label categories', JSON.stringify(copy.label?.categories ?? null) === JSON.stringify(src.label.categories), src.label.categories, copy.label?.categories);
    if (src.symbol) {
      check('symbol', copy.symbol?.standard === src.symbol.standard && copy.symbol?.sidc === src.symbol.sidc, { standard: src.symbol.standard, sidc: src.symbol.sidc }, { standard: copy.symbol?.standard, sidc: copy.symbol?.sidc });
      for (const [k, v] of Object.entries(src.symbol.modifiers ?? {})) check(`modifier ${k}`, copy.symbol?.modifiers?.[k] === v, v, copy.symbol?.modifiers?.[k]);
    }
  } else {
    check('label', copy.label?.classification === COT_LABEL.classification, `the link's ${COT_LABEL.classification}`, copy.label?.classification);
    const s = src.symbol;
    const got = copy.symbol ?? {};
    if (s.standard === 'APP-6B') {
      const identity = IDENTITY_6B[s.sidc[1]];
      check('symbol (APP-6B to APP-6D: standard and identity)', got.standard === 'APP-6D' && String(got.sidc ?? '')[3] === identity, { standard: 'APP-6D', identity }, { standard: got.standard, sidc: got.sidc });
    } else {
      const expected = s.standard === 'APP-6E' ? `10${s.sidc.slice(2)}` : s.sidc;
      check('symbol', got.standard === 'APP-6D' && got.sidc === expected, { standard: 'APP-6D', sidc: expected }, { standard: got.standard, sidc: got.sidc });
    }
    for (const k of COT_MODIFIERS) {
      const v = s.modifiers[k];
      const g = got.modifiers?.[k];
      const ok = typeof v === 'number' ? typeof g === 'number' && Math.abs(g - v) <= (k === 'speed' ? 0.01 : 0.1) : g === v;
      check(`modifier ${k}`, ok, v, g);
    }
  }
  return out;
}

/** The copies of `sender`'s objects in `receiver` through `link`, by source object id. */
function copiesOf(link: Link, sender: Instance, receiver: Instance, cotSystem = 'cot'): Map<string, any[]> {
  if (link === 'cot') return receiver.picture.bySystem(cotSystem);
  const byRef = receiver.picture.bySystem(`mass-from-${lower(sender.index)}`);
  const map = new Map<string, any[]>();
  for (const [ref, list] of byRef) map.set(ref.replace(/^urn:uuid:/, ''), list);
  return map;
}

test('the multi-instance mass test (mass/PLAN.md)', async ({}, testInfo) => {
  const minutes = 6 + P.instances * 2 + (P.phases.includes(2) ? (P.duration / 60) * 2 + 3 : 0) + (P.phases.includes(3) ? (P.duration / 60) * 2 + 4 : 0);
  test.setTimeout(minutes * 60_000);
  const started = Date.now();
  const report: Report = newReport({ parameters: P, started: new Date(started).toISOString() });
  const instances: Instance[] = [];
  let loadTimer: NodeJS.Timeout | undefined;
  let commit = '';
  try {
    commit = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    commit = 'unknown';
  }
  report.run.build = P.release === '' ? `the tree at ${commit} (its last build)` : `release zip ${P.release.split(/[\\/]/).pop()}`;

  // cot's route (owner, in the ITA's session, 2026-11-20: through the ESA's TAK Server; --direct-cot for UDP).
  let cotRoute: 'tak' | 'direct' | null = null;
  if (P.links.includes('cot')) {
    if (P.directCot) cotRoute = 'direct';
    else {
      const missing = takCredentialsMissing();
      const status = missing === null ? takStatus() : { healthy: false, line: '' };
      if (missing !== null) report.skippedParts.push(`cot: ${missing}`);
      else if (!status.healthy) report.skippedParts.push(`cot: the ESA's TAK Server does not run (external/tak-server/status.mjs: "${status.line}")`);
      else cotRoute = 'tak';
    }
  }
  report.run.cot = cotRoute === 'tak' ? 'through the ESA\'s TAK Server (TLS 8089)' : cotRoute === 'direct' ? 'directly over UDP' : 'not run';
  const useNvg = P.links.includes('nvg');
  const cotSenders = new Map<number, string>(); // instance -> its cot link sending to the others (for the channel)

  try {
    for (let i = 0; i < P.instances; i++) instances.push(await startInstance(i, OUT, { release: P.release, tak: cotRoute === 'tak' }));
    report.run.instances = instances.map((x) => `${x.name} on port ${x.port}`).join(', ');
    loadTimer = setInterval(() => {
      for (const x of instances) void sampleLoad(x.name, x.port).then((l) => report.load.push(l));
    }, 30_000);
    for (const x of instances) report.load.push(await sampleLoad(x.name, x.port));

    // ---- Setup: the layers, the links, then the known set (so that cot sends each object as it is made). ----
    const setLayers = new Map<number, any>();
    const cotLayers = new Map<number, any>();
    const items = new Map<number, Item[]>();
    const ids = new Map<number, Map<string, Item>>(); // instance -> object id -> item
    if (P.phases.includes(1) || P.phases.includes(2)) {
      for (const x of instances) {
        const [set] = await applyAll(x, [createLayer(`Mass set ${x.name}`, { drawOrder: 2 })]);
        setLayers.set(x.index, set);
        if (cotRoute !== null) {
          const [fromCot] = await applyAll(x, [createLayer(cotRoute === 'tak' ? 'From TAK' : 'From cot', { drawOrder: 3 })]);
          cotLayers.set(x.index, fromCot);
        }
      }
      const cotPorts = new Map<number, number>();
      for (const x of instances) cotPorts.set(x.index, await freeUdp());
      for (const x of instances) {
        const set = setLayers.get(x.index);
        const sources = [{ id: set.id, name: set.name }];
        // The echo variant: A also sends what it received.
        if (P.echo && x.index === 0 && cotLayers.has(0)) sources.push({ id: cotLayers.get(0).id, name: cotLayers.get(0).name });
        const target = cotLayers.has(x.index) ? { id: cotLayers.get(x.index).id, name: cotLayers.get(x.index).name } : undefined;
        if (cotRoute === 'tak') {
          await putSettings(x.baseUrl, 'cot', { links: [{ name: 'mass-tak', direction: 'both', transport: 'tls', host: '127.0.0.1', port: 8089, tlsCredential: TAK_CREDENTIAL, sourceLayers: sources, targetLayer: target, label: COT_LABEL, highestClassification: HIGHEST, refreshSeconds: 0 }] });
          cotSenders.set(x.index, 'mass-tak');
        } else if (cotRoute === 'direct') {
          const links: any[] = [{ name: 'mass-in', direction: 'in', transport: 'udp', port: cotPorts.get(x.index), targetLayer: target, label: COT_LABEL }];
          for (const y of instances) if (y !== x) links.push({ name: `mass-to-${lower(y.index)}`, direction: 'out', transport: 'udp', host: '127.0.0.1', port: cotPorts.get(y.index), sourceLayers: sources, highestClassification: HIGHEST, refreshSeconds: 0 });
          await putSettings(x.baseUrl, 'cot', { links });
        }
        if (useNvg) {
          const links: any[] = [{ name: 'mass-provider', kind: 'soap-provider', sourceLayers: [{ id: set.id, name: set.name }], highestClassification: HIGHEST }];
          for (const y of instances) if (y !== x) links.push({ name: `mass-from-${lower(y.index)}`, kind: 'soap-consumer', url: `${y.baseUrl}/api/services/nvg/nvg/mass-provider`, intervalSeconds: NVG_INTERVAL_S, targetLayer: { name: `From ${y.name} (nvg)` } });
          await putSettings(x.baseUrl, 'nvg', { links });
        }
      }
      if (cotRoute === 'tak') {
        // Every instance's TLS link connected before anything is made: the TAK Server relays only what comes after.
        for (const x of instances) {
          let state = '';
          for (let t = 0; t < 30; t++) {
            const monitor = JSON.stringify(await getJson(`${x.baseUrl}/api/monitor`).catch(() => ({})));
            state = /mass-tak[^"]{0,40}(connected|not connected)[^"]{0,80}/.exec(monitor)?.[0] ?? '';
            if (/mass-tak[^"]{0,40}connected/.test(state) && !/not connected/.test(state)) break;
            await sleep(1000);
          }
          report.notes.push(`${x.name}'s cot link before the set: ${state || 'no state in /api/monitor'}`);
        }
      } else await sleep(2000);

      for (const x of instances) {
        const set = setLayers.get(x.index);
        const list = [...symbols(x.index, set.id, P.objects), ...graphics(x.index, set.id)];
        const states = await applyAll(x, list.map((it) => it.request));
        items.set(x.index, list);
        ids.set(x.index, new Map(states.map((s, i) => [s.id, list[i]])));
      }
      report.run.knownSet = `${P.objects} symbols + 1 SECRET, 10 graphics and 2 shapes per instance`;
    }

    // ---- Phase 1: the known set arrives, field by field; nothing lost, duplicated or echoed. ----
    const links: Link[] = [...(cotRoute !== null ? (['cot'] as Link[]) : []), ...(useNvg ? (['nvg'] as Link[]) : [])];
    const expectedFrom = (link: Link, sender: Instance) => [...ids.get(sender.index)!].filter(([, it]) => sendable(it) && (link === 'nvg' || cotCarries(it)));
    if (P.phases.includes(1)) {
      const deadline = Date.now() + (NVG_INTERVAL_S * 3 + 40) * 1000;
      for (;;) {
        let missing = 0;
        for (const link of links) for (const s of instances) for (const r of instances) {
          if (s === r) continue;
          const copies = copiesOf(link, s, r);
          missing += expectedFrom(link, s).filter(([id]) => !copies.has(id)).length;
        }
        if (missing === 0 || Date.now() > deadline) break;
        await sleep(1000);
      }
      await sleep(5000); // time for a duplicate or an echo to show
      for (const link of links) for (const s of instances) for (const r of instances) {
        if (s === r) continue;
        const copies = copiesOf(link, s, r);
        for (const kind of ['symbol', 'graphic', 'shape'] as const) {
          const all = [...ids.get(s.index)!].filter(([, it]) => it.kind === kind);
          const row: Row = { phase: 1, link, from: s.name, to: r.name, kind, sent: 0, received: 0, matched: 0, mismatched: [], skipped: [], lost: [], duplicated: [], unexpected: [] };
          for (const [id, it] of all) {
            const list = copies.get(id) ?? [];
            const expected = sendable(it) && (link === 'nvg' || cotCarries(it));
            if (!expected) {
              if (list.length > 0) row.unexpected.push(`${it.name} (${it.classification}${cotCarries(it) || link === 'nvg' ? '' : `, a ${kind}`})`);
              else row.skipped.push(`${it.name}: ${sendable(it) ? `cot sends no ${kind}` : `${it.classification}, above the link's highest`}`);
              continue;
            }
            row.sent++;
            if (list.length === 0) {
              row.lost.push(it.name);
              continue;
            }
            row.received++;
            if (list.length > 1) row.duplicated.push(`${it.name} ×${list.length}`);
            const mismatches = compare(link, it, list[0]);
            if (mismatches.length === 0) row.matched++;
            else row.mismatched.push(...mismatches);
          }
          if (all.length > 0) report.rows.push(row);
          const what = `phase 1, ${link} ${s.name} → ${r.name}, ${kind}s`;
          if (row.lost.length > 0) report.problems.push(`${what}: ${row.lost.length} lost (${row.lost.slice(0, 5).join(', ')})`);
          if (row.duplicated.length > 0) report.problems.push(`${what}: duplicated ${row.duplicated.slice(0, 5).join(', ')}`);
          if (row.unexpected.length > 0) report.problems.push(`${what}: arrived though not to be sent: ${row.unexpected.join(', ')}`);
          if (row.mismatched.length > 0) report.problems.push(`${what}: ${row.mismatched.length} mismatched fields (report.md, "Mismatches")`);
        }
      }
    }
    // Echoes, all the time: no instance holds a copy of an object of its own.
    const checkEchoes = (phase: string) => {
      for (const x of instances) {
        const own = ids.get(x.index);
        if (!own) continue;
        for (const o of x.picture.objects.values()) {
          const ref = o.meta?.externalRef;
          if (!ref || o.layerId === setLayers.get(x.index)?.id) continue;
          const id = String(ref.id).replace(/^urn:uuid:/, '');
          if (own.has(id)) report.echoes.push(`${phase}: ${x.name} holds a copy of its own ${own.get(id)!.name} (${ref.system})`);
        }
      }
    };
    if (P.phases.includes(1)) checkEchoes('phase 1');

    // ---- Phase 2: moves in every instance; every change arrives, the last position wins, no loops. ----
    if (P.phases.includes(2)) {
      const rnd = random(P.seed);
      type Move = { at: number; geometry: any };
      const moves = new Map<string, Move[]>(); // source object id -> its moves
      const movable = new Map<number, string[]>();
      for (const x of instances) movable.set(x.index, [...ids.get(x.index)!].filter(([, it]) => sendable(it)).map(([id]) => id));
      const phaseStart = Date.now();
      const rewrites = new Map<string, number>();
      let step = 0;
      let conflictDone = false;
      while (Date.now() - phaseStart < P.duration * 1000) {
        const tick = Date.now();
        await Promise.all(
          instances.map(async (x) => {
            const list = movable.get(x.index)!;
            const count = Math.max(1, Math.round(list.length * P.share));
            const chosen = new Set<string>();
            while (chosen.size < Math.min(count, list.length)) chosen.add(list[Math.floor(rnd() * list.length)]);
            const requests = [...chosen].map((id) => {
              const state = x.picture.objects.get(id);
              const dx = 0.0005 * (1 + (step % 3));
              const dy = step % 2 === 0 ? 0.0003 : -0.0002;
              return updateRequest(state, { geometry: translate(state.geometry, dx, dy) });
            });
            for (let k = 0; k < requests.length; k += 50) {
              const batch = requests.slice(k, k + 50);
              const outcomes = await Promise.all(batch.map((r) => x.live.change(r, 30_000)));
              outcomes.forEach((o: any, n) => {
                if (o.outcome !== 'applied') report.notes.push(`${x.name}: a move was not applied: ${JSON.stringify(o.rejection ?? o).slice(0, 200)}`);
                else moves.set(batch[n].entityId, [...(moves.get(batch[n].entityId) ?? []), { at: Date.now(), geometry: o.event.state.geometry }]);
              });
            }
          }),
        );
        // The conflict variant, once, half-way: B moves its cot copy of one of A's symbols.
        if (P.conflict && !conflictDone && Date.now() - phaseStart > (P.duration * 1000) / 2 && cotRoute !== null) {
          conflictDone = true;
          const [aId] = movable.get(0)!.filter((id) => ids.get(0)!.get(id)!.kind === 'symbol');
          const copy = copiesOf('cot', instances[0], instances[1]).get(aId)?.[0];
          if (copy) {
            const o: any = await instances[1].live.change(updateRequest(copy, { geometry: translate(copy.geometry, 0.01, 0.01) }), 30_000);
            report.notes.push(`conflict: B moved its cot copy of ${ids.get(0)!.get(aId)!.name}: ${o.outcome}; its final place is checked below`);
            report.phase3.conflictObject = ids.get(0)!.get(aId)!.name;
          }
        }
        step++;
        await sleep(Math.max(0, P.moveInterval * 1000 - (Date.now() - tick)));
      }
      report.notes.push(`phase 2: ${step} rounds of moves in ${Math.round((Date.now() - phaseStart) / 1000)} s`);
      await sleep(Math.max(15, NVG_INTERVAL_S * 2 + 5) * 1000);

      for (const link of links) for (const s of instances) for (const r of instances) {
        if (s === r) continue;
        const prop: Propagation = { link, from: s.name, to: r.name, what: 'moves', sent: 0, seen: 0, latenciesMs: [], lastPositionWrong: [], unexplained: [], outOfOrder: [] };
        const copies = copiesOf(link, s, r);
        for (const [id, it] of ids.get(s.index)!) {
          const list = moves.get(id);
          if (!list || !(link === 'nvg' || cotCarries(it))) continue;
          prop.sent += list.length;
          const copy = copies.get(id)?.[0];
          if (!copy) {
            prop.lastPositionWrong.push(`${it.name}: no copy`);
            continue;
          }
          const last = s.picture.objects.get(id)?.geometry ?? list[list.length - 1].geometry;
          if (!sameGeometry(last, copy.geometry)) prop.lastPositionWrong.push(`${it.name} (${offMetres(last, copy.geometry)} m off)`);
          let highest = -1;
          for (const a of r.picture.arrivals) {
            if (a.event.entityId !== copy.id || a.event.operation !== 'update' || !a.event.state) continue;
            const k = list.findIndex((m) => sameGeometry(m.geometry, a.event.state.geometry));
            if (k < 0) {
              // At the place it was made: a rewrite of an unchanged copy (counted apart), else unexplained.
              if (a.at > phaseStart && sameGeometry(it.request.data.geometry, a.event.state.geometry)) rewrites.set(`${link} ${s.name} → ${r.name}`, (rewrites.get(`${link} ${s.name} → ${r.name}`) ?? 0) + 1);
              else if (a.at > phaseStart) prop.unexplained.push(it.name);
              continue;
            }
            if (k < highest) prop.outOfOrder.push(`${it.name} (move ${k + 1} after ${highest + 1})`);
            if (k > highest) {
              prop.seen++;
              prop.latenciesMs.push(a.at - list[k].at);
              highest = k;
            }
          }
        }
        const conflictName = report.phase3.conflictObject;
        if (conflictName) prop.lastPositionWrong = prop.lastPositionWrong.filter((n) => !n.startsWith(`${conflictName} `));
        report.propagation.push(prop);
        const what = `phase 2, ${link} ${s.name} → ${r.name}`;
        if (prop.lastPositionWrong.length > 0) report.problems.push(`${what}: the last position did not win for ${prop.lastPositionWrong.length} (${prop.lastPositionWrong.slice(0, 5).join(', ')})`);
        if (prop.outOfOrder.length > 0) report.problems.push(`${what}: ${prop.outOfOrder.length} positions came back after a newer one (ping-pong?)`);
        if (prop.unexplained.length > 0) report.notes.push(`${what}: ${prop.unexplained.length} updates at a position no move gave (${[...new Set(prop.unexplained)].slice(0, 5).join(', ')})`);
      }
      for (const [what, n] of rewrites) report.notes.push(`phase 2, ${what}: ${n} updates that rewrote a copy at the place it was made (unchanged)`);
      // Loops: a source object changed by anyone but the test.
      for (const x of instances) {
        const own = ids.get(x.index)!;
        for (const a of x.picture.arrivals) {
          if (!own.has(a.event.entityId) || a.event.operation !== 'update') continue;
          const by = a.event.by?.plugin;
          if (by && by !== 'ita-test') report.loops.push(`${x.name}'s ${own.get(a.event.entityId)!.name} changed by ${by}`);
        }
      }
      checkEchoes('phase 2');
    }

    // ---- Phase 3: simulation in A (or every instance): ground truth and GMTI to the others. ----
    if (P.phases.includes(3)) {
      const senders = P.both ? instances : [instances[0]];
      const gmtiEdition = JSON.stringify(JSON.parse(readFileSync(join(root, 'plugins', 'gmti', 'plugin.json'), 'utf8'))).includes('"edition"');
      const jobLimitMs = (gmtiEdition ? 20_000 + REVISIT_S * 1000 : 30_000) + 500;
      report.phase3.jobDefinitionLimit = `${jobLimitMs} ms (${gmtiEdition ? 'M9.1: 20 s plus one revisit' : 'before M9.1: 30 s'})`;
      const taps: Array<{ from: string; to: string; result: { faults: string[]; jobs: number[]; packets: number } }> = [];
      const gmtiPorts = new Map<number, number>();
      if (P.links.includes('gmti')) {
        for (const r of instances) {
          if (senders.length === 1 && r === senders[0]) continue;
          const port = await freeUdp();
          gmtiPorts.set(r.index, port);
          await putSettings(r.baseUrl, 'gmti', { links: [{ name: 'mass-gmti-in', mode: 'udp', direction: 'in', listen: { address: '127.0.0.1', port } }] });
        }
      }
      const tracks = new Map<number, { runner: any; still: any; platform: any; line: LonLat[] }>();
      for (const s of senders) {
        const L = s.name;
        const base: LonLat = [15.5 + s.index * 0.7, 58.5 + s.index * 0.4];
        const [layer] = await applyAll(s, [createLayer(`Mass simulation ${L}`, { workspace: SIMULATION, drawOrder: 1 })]);
        const line: LonLat[] = [[base[0] + 1, base[1] + 0.05], [base[0] + 1.5, base[1] + 0.25]];
        const track = (name: string, at: LonLat, modifiers?: Record<string, unknown>) => ({
          requestId: randomUUID(), entityType: 'object', operation: 'create', entityId: randomUUID(), source: { plugin: 'ita-test' },
          data: { type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId: layer.id, geometry: { type: 'Point', coordinates: at }, symbol: { standard: 'APP-6B', sidc: 'SFGPUCI--------', ...(modifiers ? { modifiers } : {}) }, label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' }, properties: { name } },
        });
        const route = {
          requestId: randomUUID(), entityType: 'object', operation: 'create', entityId: randomUUID(), source: { plugin: 'ita-test' },
          data: {
            type: 'core.shape', dataType: 'simulator.route', dataSource: 'manual', layerId: layer.id, geometry: { type: 'LineString', coordinates: line },
            style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' }, properties: { name: `${L}-Route` },
            label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
            extensions: { simulator: { points: line.map(() => ({ speedKind: 'instant', speed: 30 / 3.6, events: [] })), groups: [], end: 'stop' } },
          },
        };
        const [routeState] = await applyAll(s, [route]);
        const [runner, still, platform] = await applyAll(s, [track(`${L}-Runner`, line[0]), track(`${L}-Still`, [base[0] - 0.4, base[1] - 0.6]), track(`${L}-Hawk`, base, { direction: 45, speed: 120 })]);
        tracks.set(s.index, { runner, still, platform, line });
        const sim = `${s.baseUrl}/api/plugins/simulator`;
        await postJson(`${sim}/put-on-route`, { route: routeState.id, kind: 'single', objects: [runner.id] });
        // Ground truth to cot's and nvg's channels.
        const wanted: string[] = [];
        if (cotRoute === 'tak') wanted.push('cot/mass-tak');
        if (cotRoute === 'direct') for (const y of instances) if (y !== s) wanted.push(`cot/mass-to-${lower(y.index)}`);
        if (useNvg) wanted.push('nvg/mass-provider');
        let offered: string[] = [];
        for (let t = 0; t < 20 && !wanted.every((w) => offered.includes(w)); t++) {
          offered = (await getJson(`${sim}/outputs`)).channels.map((c: { id: string }) => c.id);
          if (!wanted.every((w) => offered.includes(w))) await sleep(500);
        }
        const chosen = wanted.filter((w) => offered.includes(w));
        if (chosen.length < wanted.length) report.problems.push(`phase 3, ${L}: ground truth channels not offered: ${wanted.filter((w) => !chosen.includes(w)).join(', ')}`);
        await postJson(`${sim}/outputs`, { channels: chosen });
        // GMTI: one out link per receiver, through a tap that checks the 4607 structure.
        const outputs: string[] = [];
        if (P.links.includes('gmti')) {
          const outLinks: any[] = [];
          for (const r of instances) {
            if (r === s || !gmtiPorts.has(r.index)) continue;
            const tap = await startTap(gmtiPorts.get(r.index)!);
            taps.push({ from: L, to: r.name, result: tap.result });
            outLinks.push({ name: `mass-gmti-to-${lower(r.index)}`, mode: 'udp', direction: 'out', host: '127.0.0.1', port: tap.port });
            outputs.push(`gmti/mass-gmti-to-${lower(r.index)}`);
            closers.push(tap.close);
          }
          const inLink = gmtiPorts.has(s.index) ? [{ name: 'mass-gmti-in', mode: 'udp', direction: 'in', listen: { address: '127.0.0.1', port: gmtiPorts.get(s.index) } }] : [];
          await putSettings(s.baseUrl, 'gmti', { links: [...inLink, ...outLinks] });
          for (let t = 0; t < 20; t++) {
            const channels = (await getJson(`${sim}/sensors`)).channels.map((c: { id: string }) => c.id);
            if (outputs.every((o) => channels.includes(o))) break;
            await sleep(500);
          }
          await postJson(`${sim}/sensors`, {
            platform: platform.id, create: true, revisitSeconds: REVISIT_S, detectAll: true, mission: `MASS-${L}`, outputs,
            startBearing: 0, endBearing: 360, maxRange: 150 * KM, searchWidth: 360, dwellDepth: 150 * KM, dwellInterval: REVISIT_S,
          });
        }
      }
      const simStart = Date.now();
      for (const s of senders) await postJson(`${s.baseUrl}/api/plugins/simulator/routes/start`, {});
      await sleep(P.duration * 1000);
      for (const s of senders) await postJson(`${s.baseUrl}/api/plugins/simulator/routes/pause`, {});
      await sleep(Math.max(10, NVG_INTERVAL_S * 2 + 2) * 1000);

      for (const s of senders) {
        const t = tracks.get(s.index)!;
        // The positions the sender's runner took, and when its picture showed each.
        const path = s.picture.arrivals.filter((a) => a.event.entityId === t.runner.id && a.event.state?.geometry).map((a) => ({ at: a.at, p: a.event.state.geometry.coordinates as number[] }));
        report.phase3[`${s.name}'s runner positions`] = path.length;
        for (const r of instances) {
          if (r === s) continue;
          for (const link of links) {
            const system = link === 'cot' ? 'cot' : `mass-from-${lower(s.index)}`;
            const prop: Propagation = { link, from: s.name, to: r.name, what: 'ground truth (the runner)', sent: path.length, seen: 0, latenciesMs: [], lastPositionWrong: [], unexplained: [], outOfOrder: [] };
            const copies = [...r.picture.objects.values()].filter((o) => o.meta?.externalRef?.system === system && o.properties?.name === `${s.name}-Runner`);
            if (copies.length !== 1) {
              report.problems.push(`phase 3, ${link} ${s.name} → ${r.name}: ${copies.length} copies of ${s.name}-Runner, not 1`);
              report.propagation.push(prop);
              continue;
            }
            const copy = copies[0];
            for (const a of r.picture.arrivals) {
              if (a.event.entityId !== copy.id || !a.event.state?.geometry) continue;
              const k = path.findIndex((x) => near(x.p, a.event.state.geometry.coordinates, 1e-6));
              if (k < 0) prop.unexplained.push(`${s.name}-Runner at ${JSON.stringify(a.event.state.geometry.coordinates)}`);
              else {
                prop.seen++;
                prop.latenciesMs.push(a.at - path[k].at);
              }
            }
            const last = s.picture.objects.get(t.runner.id)?.geometry;
            if (last && !sameGeometry(last, copy.geometry)) prop.lastPositionWrong.push(`${s.name}-Runner (${offMetres(last, copy.geometry)} m off)`);
            report.propagation.push(prop);
            const what = `phase 3, ${link} ${s.name} → ${r.name}`;
            if (prop.seen === 0) report.problems.push(`${what}: no position of ${s.name}-Runner arrived`);
            if (prop.unexplained.length > 0) report.problems.push(`${what}: ${prop.unexplained.length} positions of ${s.name}-Runner that it never had`);
            if (prop.lastPositionWrong.length > 0) report.problems.push(`${what}: ${s.name}-Runner's copy is not at its last position`);
            for (const name of [`${s.name}-Still`, `${s.name}-Hawk`]) {
              const n = [...r.picture.objects.values()].filter((o) => o.meta?.externalRef?.system === system && o.properties?.name === name).length;
              if (n !== 1) report.problems.push(`${what}: ${n} copies of ${name}, not 1`);
            }
          }
          if (P.links.includes('gmti') && gmtiPorts.has(r.index)) {
            const gmti = [...r.picture.objects.values()].filter((o) => o.dataSource === 'mass-gmti-in');
            const detections = gmti.filter((o) => o.dataType === 'gmti.detection');
            const dwells = gmti.filter((o) => o.dataType === 'gmti.dwell-area');
            const created = r.picture.arrivals.filter((a) => a.event.operation === 'create' && a.event.state?.dataSource === 'mass-gmti-in');
            const allDetections = created.filter((a) => a.event.state.dataType === 'gmti.detection').map((a) => a.event.state);
            const truth = [
              ...path.map((x) => x.p),
              t.still.geometry.coordinates,
            ];
            const far = allDetections.filter((d) => !truth.some((p) => near(p, d.geometry.coordinates, 0.002)));
            report.phase3[`gmti ${s.name} → ${r.name}`] = { objectsNow: gmti.length, detectionsCreated: allDetections.length, dwellAreasCreated: created.filter((a) => a.event.state.dataType === 'gmti.dwell-area').length, detectionsNow: detections.length, dwellAreasNow: dwells.length, detectionsAwayFromATrack: far.length };
            if (allDetections.length === 0) report.problems.push(`phase 3, gmti ${s.name} → ${r.name}: no detections arrived`);
            if (far.length > 0) report.problems.push(`phase 3, gmti ${s.name} → ${r.name}: ${far.length} detections more than 0.002° from every track position`);
          }
        }
        // Nothing of the simulation comes back to its sender.
        for (const o of s.picture.objects.values()) {
          if (o.meta?.externalRef && /^[A-Z]-(Runner|Still|Hawk)$/.test(o.properties?.name ?? '') && o.properties.name.startsWith(`${s.name}-`)) report.echoes.push(`phase 3: ${s.name} holds a copy of its own ${o.properties.name} (${o.meta.externalRef.system})`);
        }
      }
      for (const { from, to, result: tap } of taps) {
        const gaps = tap.jobs.slice(1).map((x, i) => x - tap.jobs[i]);
        report.phase3[`4607 ${from} → ${to}`] = { packets: tap.packets, structureFaults: tap.faults.length, jobDefinitions: tap.jobs.length, jobGapsMs: gaps };
        if (tap.packets === 0) report.problems.push(`phase 3, 4607 ${from} → ${to}: no packets`);
        if (tap.faults.length > 0) report.problems.push(`phase 3, 4607 ${from} → ${to}: ${tap.faults.slice(0, 3).join('; ')}`);
        const late = gaps.filter((g) => g > jobLimitMs);
        if (late.length > 0) report.problems.push(`phase 3, 4607 ${from} → ${to}: job definitions ${late.join(', ')} ms apart (limit ${jobLimitMs})`);
      }
      report.phase3.durationS = Math.round((Date.now() - simStart) / 1000);
    }
  } catch (error: any) {
    report.problems.push(`the run stopped: ${String(error?.stack ?? error).split(/\r?\n/).slice(0, 6).join(' | ')}`);
    throw error;
  } finally {
    if (loadTimer) clearInterval(loadTimer);
    for (const close of closers.splice(0)) close();
    for (const x of instances) {
      await x.live.close().catch(() => undefined);
      let detail = '';
      try {
        detail = await x.stop();
      } catch (error: any) {
        detail = `stop failed: ${error.message}`;
      }
      const file = x.log();
      const problems = file && existsSync(file) ? checkLog(readFileSync(file, 'utf8')) : ['no log file found'];
      report.logs[x.name] = problems;
      if (detail !== 'stopped cleanly (exit code 0)' && detail !== 'stopped') report.problems.push(`${x.name}: ${detail}`);
      if (problems.length > 0) report.problems.push(`${x.name}'s log: ${problems.length} problems (report.md, "Server logs")`);
    }
    if (report.echoes.length > 0) report.problems.push(`${report.echoes.length} echoes (report.md, "Echoes and loops")`);
    if (report.loops.length > 0) report.problems.push(`${report.loops.length} loops (report.md, "Echoes and loops")`);
    report.run.durationS = Math.round((Date.now() - started) / 1000);
    writeReport(OUT, report);
    testInfo.annotations.push({ type: 'report', description: join(OUT, 'report.md') });
  }
  expect(report.problems, `the mass run's problems (${join(OUT, 'report.md')})`).toEqual([]);
});

const closers: Array<() => void> = [];

/**
 * A tap between a gmti out link and the receiving instance: passes every datagram on unchanged and checks the 4607
 * structure (P2 the datagram's size, one segment filling it) and when each job definition (segment 5) went.
 */
async function startTap(to: number) {
  const socket = createSocket('udp4');
  const result = { faults: [] as string[], jobs: [] as number[], packets: 0 };
  socket.on('message', (packet) => {
    const n = result.packets++;
    socket.send(packet, to, '127.0.0.1');
    if (packet.length < 37) {
      result.faults.push(`packet ${n}: ${packet.length} bytes`);
      return;
    }
    if (packet.readUInt32BE(2) !== packet.length) result.faults.push(`packet ${n}: P2 ${packet.readUInt32BE(2)}, the datagram ${packet.length}`);
    const types: number[] = [];
    for (let at = 32; at < packet.length; ) {
      const size = at + 5 <= packet.length ? packet.readUInt32BE(at + 1) : 0;
      if (size < 5 || at + size > packet.length) {
        result.faults.push(`packet ${n}: a segment at byte ${at} of ${size} bytes`);
        break;
      }
      types.push(packet[at]);
      at += size;
    }
    if (types.length !== 1) result.faults.push(`packet ${n}: ${types.length} segments`);
    if (types.includes(5)) result.jobs.push(Date.now());
  });
  await new Promise<void>((r) => socket.bind(0, '127.0.0.1', () => r()));
  return { port: socket.address().port, result, close: () => socket.close() };
}
