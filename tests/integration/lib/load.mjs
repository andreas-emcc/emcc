// Load for the performance suite (T-031): many objects and a steady stream of position changes,
// sent over the live picture WebSocket like any client (server/live-picture-protocol.md). Unlike
// LiveClient it does not subscribe and keeps no messages, only counts, so 100 000 objects and a
// minute of 1 000 changes per second cost the test process little memory.
import { randomUUID } from 'node:crypto';
import { liveUrl } from './live.mjs';

const LABEL = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
/** Land unit entities with icons (as in symbology's render tests). */
const ENTITIES = ['121100', '120500', '130300', '121300', '140700', '161300'];
/** Friend, hostile, neutral, unknown. */
const IDENTITIES = ['3', '6', '4', '1'];
/** The server refuses more than 100 change requests waiting per session; stay below. */
const WINDOW = 80;

/** 24 appearances (4 identities × 6 entities), as a real picture has several, not one. */
export function sidcOf(index) {
  const identity = IDENTITIES[index % IDENTITIES.length];
  const entity = ENTITIES[Math.floor(index / IDENTITIES.length) % ENTITIES.length];
  return `100${identity}1000${'00'}${entity}0000`;
}

/**
 * The content of a symbol object: an APP-6D unit with a unique designation (text, which the map
 * view draws for up to its text threshold of symbols in view) and a direction. Data model 1.0.0:
 * the built-in data type core.general, placed by hand (manual), as in lib/live.mjs.
 */
export function symbolData(layerId, index, [lon, lat]) {
  return {
    type: 'core.symbol',
    dataType: 'core.general',
    dataSource: 'manual',
    layerId,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    symbol: { standard: 'APP-6D', sidc: sidcOf(index), modifiers: { uniqueDesignation: `U${index}`, direction: (index * 37) % 360 } },
    label: LABEL,
  };
}

/**
 * `count` positions on a regular grid filling the box [west, south, east, north], row by row.
 * Latitude differs from longitude everywhere (ADR-0007) as long as the box does.
 */
export function grid([west, south, east, north], count) {
  const columns = Math.ceil(Math.sqrt(count * ((east - west) / (north - south))));
  const rows = Math.ceil(count / columns);
  const positions = [];
  for (let i = 0; i < count; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    positions.push([west + ((column + 0.5) * (east - west)) / columns, south + ((row + 0.5) * (north - south)) / rows]);
  }
  return positions;
}

/** A small seeded random generator (mulberry32): the same objects are moved in every run. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** One live picture session that sends change requests and counts their outcomes. */
export class LoadClient {
  static async open(baseUrl) {
    const client = new LoadClient(new WebSocket(liveUrl(baseUrl)));
    await client.welcome;
    return client;
  }

  constructor(socket) {
    this.socket = socket;
    /** requestId → { sent, resolve } of the requests waiting for their outcome. */
    this.waiting = new Map();
    this.counts = { applied: 0, rejected: 0, unknown: 0, errors: 0 };
    this.rejections = new Map();
    this.closed = new Promise((resolveClosed) => {
      socket.addEventListener('close', (event) => {
        this.closeCode = event.code;
        resolveClosed(event.code);
        for (const w of this.waiting.values()) w.resolve(null);
        this.waiting.clear();
      });
    });
    this.welcome = new Promise((resolveWelcome, reject) => {
      this.closed.then((code) => reject(new Error(`connection closed (${code}) before welcome`)));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'welcome') resolveWelcome(message);
        else if (message.type === 'change-outcome') this.outcome(message);
        else if (message.type === 'error') this.counts.errors++;
      });
    });
  }

  outcome(message) {
    const w = this.waiting.get(message.requestId);
    if (w === undefined) return;
    this.waiting.delete(message.requestId);
    if (message.outcome === 'applied') this.counts.applied++;
    else if (message.outcome === 'rejected') {
      this.counts.rejected++;
      const code = message.rejection?.code ?? 'unknown';
      this.rejections.set(code, (this.rejections.get(code) ?? 0) + 1);
    } else this.counts.unknown++;
    w.resolve(Date.now() - w.sent);
  }

  /** Sends one change request; resolves with its round trip in ms, or null if the connection closed. */
  send(request) {
    if (this.closeCode !== undefined) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiting.set(request.requestId, { sent: Date.now(), resolve });
      this.socket.send(JSON.stringify({ type: 'change-request', request }));
    });
  }

  /** Creates objects from `datas` with at most WINDOW waiting; resolves with their ids and the time taken. */
  async create(datas) {
    const started = Date.now();
    const ids = [];
    const pending = new Set();
    for (const data of datas) {
      while (pending.size >= WINDOW) await Promise.race(pending);
      const entityId = randomUUID();
      ids.push(entityId);
      const sent = this.send({ requestId: randomUUID(), entityType: 'object', operation: 'create', entityId, data, source: { plugin: 'ita-load' } });
      pending.add(sent);
      sent.then(() => pending.delete(sent));
    }
    await Promise.all(pending);
    return { ids, ms: Date.now() - started };
  }

  /**
   * Sends `rate` position updates per second for `seconds`, each moving a random object (seeded) of
   * `objects` ({ id, data }) a little. Every tick (about 10 ms; timers are coarser on Windows) sends
   * what is due by then. No more than the window waits, so a server that answers slowly shows up
   * as skipped changes and a lower rate, not as rejections.
   */
  async stream(objects, { rate = 1_000, seconds = 60, seed = 1 } = {}) {
    const tickMs = 10;
    const random = seeded(seed);
    const started = Date.now();
    const roundTrips = [];
    let sent = 0;
    let skipped = 0;
    const pending = new Set();
    while (Date.now() - started < seconds * 1000 && this.closeCode === undefined) {
      const due = Math.floor(((Date.now() - started) / 1000) * rate);
      while (sent + skipped < due) {
        if (pending.size >= WINDOW) {
          skipped++;
          continue;
        }
        const object = objects[Math.floor(random() * objects.length)];
        const [lon, lat] = object.data.geometry.coordinates;
        const step = sent % 2 === 0 ? 0.001 : -0.001;
        const data = { ...object.data, geometry: { type: 'Point', coordinates: [lon + step, lat + step / 2] } };
        object.data = data;
        const request = { requestId: randomUUID(), entityType: 'object', operation: 'update', entityId: object.id, data, source: { plugin: 'ita-load' } };
        const p = this.send(request).then((ms) => {
          pending.delete(p);
          if (ms !== null) roundTrips.push(ms);
        });
        pending.add(p);
        sent++;
      }
      await new Promise((r) => setTimeout(r, tickMs));
    }
    await Promise.all(pending);
    const elapsed = (Date.now() - started) / 1000;
    roundTrips.sort((a, b) => a - b);
    return {
      seconds: elapsed,
      sent,
      skipped,
      ratePerSecond: sent / elapsed,
      roundTripMs: { p50: percentile(roundTrips, 50), p95: percentile(roundTrips, 95), max: roundTrips.at(-1) ?? null },
    };
  }

  /** Counts of outcomes so far, with the rejection codes. */
  summary() {
    return { ...this.counts, rejections: Object.fromEntries(this.rejections), closeCode: this.closeCode ?? null };
  }

  async close() {
    if (this.closeCode === undefined) this.socket.close(1000);
    await this.closed;
  }
}
