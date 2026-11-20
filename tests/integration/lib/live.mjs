// A test client for the live picture WebSocket /api/live (server/live-picture-protocol.md), on
// Node's built-in WebSocket, plus helpers for raw handshakes and model documents.
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';

const DEFAULT_TIMEOUT_MS = 10_000;

export function liveUrl(baseUrl) {
  return `${baseUrl.replace(/^http/, 'ws')}/api/live`;
}

/**
 * Sends a bare WebSocket upgrade request with the given headers and resolves with the HTTP status:
 * 101 if the handshake was accepted, otherwise the refusal (e.g. 403). Node's WebSocket hides the
 * status of a refused handshake, so the handshake tests use this.
 */
export function handshakeStatus(baseUrl, headers = {}) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolveStatus, reject) => {
    const req = request({
      host: hostname,
      port,
      path: '/api/live',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': Buffer.from(randomUUID().slice(0, 16)).toString('base64'),
        ...headers,
      },
    });
    req.once('upgrade', (response, socket) => {
      socket.destroy();
      resolveStatus(response.statusCode);
    });
    req.once('response', (response) => {
      response.resume();
      resolveStatus(response.statusCode);
    });
    req.once('error', reject);
    req.setTimeout(DEFAULT_TIMEOUT_MS, () => req.destroy(new Error('handshake timed out')));
    req.end();
  });
}

/** Resolves with the HTTP status of a GET or POST with the given Host header (fetch cannot set it). */
export function statusWithHost(baseUrl, path, host, method = 'GET') {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolveStatus, reject) => {
    const req = request({ host: hostname, port, path, method, headers: { Host: host } }, (response) => {
      response.resume();
      resolveStatus(response.statusCode);
    });
    req.once('error', reject);
    req.end();
  });
}

/** The id of the whole-picture subscription that `subscribe()` opens without an id. */
export const ALL = 'all';

/**
 * One connection to /api/live (protocol version 2: several subscriptions per connection, each
 * with an id of the client's choice). Every message the server sends is kept in order; tests wait
 * for the ones they need with `next`. The `changes` events of each subscription are collected in
 * `eventsOf(id)`, those of the whole-picture subscription `all` also in `events`, and the last
 * `sequenceNo` each subscription has been brought up to in `sequenceOf(id)`.
 */
export class LiveClient {
  static async open(baseUrl, { headers } = {}) {
    const client = new LiveClient(new WebSocket(liveUrl(baseUrl), headers ? { headers } : undefined));
    const welcome = await client.next((m) => m.type === 'welcome');
    client.protocol = welcome.protocol;
    return client;
  }

  /** Opens a connection without waiting for anything; for limit tests. */
  static connect(baseUrl) {
    return new LiveClient(new WebSocket(liveUrl(baseUrl)));
  }

  constructor(socket) {
    this.socket = socket;
    this.inbox = [];
    this.waiters = [];
    this.events = [];
    this.eventsBy = new Map();
    this.sequenceBy = new Map();
    this.closed = new Promise((resolveClosed) => {
      socket.addEventListener('close', (event) => {
        this.closeCode = event.code;
        resolveClosed(event.code);
        for (const waiter of this.waiters.splice(0)) waiter.fail(new Error(`connection closed (${event.code})`));
      });
    });
    this.opened = new Promise((resolveOpened) => socket.addEventListener('open', () => resolveOpened(), { once: true }));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'changes') {
        const id = message.subscription;
        if (!this.eventsBy.has(id)) this.eventsBy.set(id, []);
        this.eventsBy.get(id).push(...message.events);
        if (id === ALL) this.events.push(...message.events);
        this.sequenceBy.set(id, message.sequenceNo);
      }
      const waiter = this.waiters.find((w) => w.matches(message));
      if (waiter) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      } else {
        this.inbox.push(message);
      }
    });
  }

  /** The next message (already received or still to come) that matches; it is taken from the inbox. */
  next(matches, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const index = this.inbox.findIndex(matches);
    if (index >= 0) return Promise.resolve(this.inbox.splice(index, 1)[0]);
    if (this.closeCode !== undefined) return Promise.reject(new Error(`connection closed (${this.closeCode})`));
    return new Promise((resolveNext, reject) => {
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`no matching message within ${timeoutMs} ms`));
      }, timeoutMs);
      const waiter = {
        matches,
        resolve: (message) => {
          clearTimeout(timer);
          resolveNext(message);
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.waiters.push(waiter);
    });
  }

  send(message) {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(data) {
    this.socket.send(data);
  }

  /**
   * Opens a subscription and resolves with its complete snapshot: { id, sequenceNo, layers,
   * objects, parts }, plus `objectCounts` for `objects: false` and the `clusters` full set for an
   * area. Without an id it is the whole picture, `all`. A number is taken as the timeout.
   * `workspaces` (data model 1.2.0): the workspace ids, or ['*']; without it, View only.
   */
  async subscribe(options = {}) {
    const { id = ALL, objects, area, resolution, budget, workspaces, timeoutMs = DEFAULT_TIMEOUT_MS } = typeof options === 'number' ? { timeoutMs: options } : options;
    this.send({
      type: 'subscribe',
      subscription: id,
      ...(objects === false ? { objects: false } : {}),
      ...(area !== undefined ? { area } : {}),
      ...(resolution !== undefined ? { resolution } : {}),
      ...(budget !== undefined ? { budget } : {}),
      ...(workspaces !== undefined ? { workspaces } : {}),
    });
    const snapshot = await this.snapshot(id, timeoutMs);
    if (area !== undefined && objects !== false) {
      // An area subscription's clusters full set follows its snapshot at once.
      snapshot.clusters = await this.next((m) => m.type === 'clusters' && m.subscription === id && m.full, timeoutMs);
    }
    return snapshot;
  }

  /** Collects the next snapshot of a subscription (snapshot-begin, its objects, snapshot-end). */
  async snapshot(id = ALL, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const mine = (type) => (m) => m.type === type && m.subscription === id;
    const begin = await this.next(mine('snapshot-begin'), timeoutMs);
    const objects = [];
    const parts = [];
    while (objects.length < begin.objectCount) {
      const part = await this.next(mine('snapshot-objects'), timeoutMs);
      parts.push(part.objects.length);
      objects.push(...part.objects);
    }
    const end = await this.next(mine('snapshot-end'), timeoutMs);
    return {
      id,
      sequenceNo: begin.sequenceNo,
      endSequenceNo: end.sequenceNo,
      layers: begin.layers,
      objects,
      parts,
      ...(begin.objectCounts ? { objectCounts: begin.objectCounts } : {}),
    };
  }

  /** Moves an area subscription's area and resolves with the `area-objects` answer. */
  async moveArea(id, area, { resolution, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.send({ type: 'area', subscription: id, area, ...(resolution !== undefined ? { resolution } : {}) });
    return this.next((m) => m.type === 'area-objects' && m.subscription === id, timeoutMs);
  }

  unsubscribe(id) {
    this.send({ type: 'unsubscribe', subscription: id });
  }

  /** The change events a subscription has received so far. */
  eventsOf(id) {
    return this.eventsBy.get(id) ?? [];
  }

  /** The last sequence number a subscription has been brought up to (its last `changes`). */
  sequenceOf(id) {
    return this.sequenceBy.get(id);
  }

  /** Reads objects by id (`get-objects`): resolves with the `objects` or `query-failed` answer. */
  async getObjects(ids, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const queryId = `q-${randomUUID()}`;
    this.send({ type: 'get-objects', queryId, ids });
    return this.next((m) => m.queryId === queryId && (m.type === 'objects' || m.type === 'query-failed'), timeoutMs);
  }

  /** Reads one page of a layer's objects (`query-layer`): resolves with the `layer-page` or `query-failed` answer. */
  async queryLayer(layerId, { page = 0, pageSize = 500, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const queryId = `q-${randomUUID()}`;
    this.send({ type: 'query-layer', queryId, layerId, page, pageSize });
    return this.next((m) => m.queryId === queryId && (m.type === 'layer-page' || m.type === 'query-failed'), timeoutMs);
  }

  /** Sends a change request and resolves with its change-outcome message. */
  async change(changeRequest, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.send({ type: 'change-request', request: changeRequest });
    return this.next((m) => m.type === 'change-outcome' && m.requestId === changeRequest.requestId, timeoutMs);
  }

  /**
   * Resolves when a subscription has been brought up to `sequenceNo` (protocol 2 sends `changes`
   * with the sequence number also when no event of it concerns the subscription).
   */
  async waitForSequence(sequenceNo, timeoutMs = DEFAULT_TIMEOUT_MS, id = ALL) {
    const deadline = Date.now() + timeoutMs;
    while (!((this.sequenceBy.get(id) ?? -1) >= sequenceNo)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`subscription ${id} not up to ${sequenceNo} within ${timeoutMs} ms`);
      if (this.closeCode !== undefined) throw new Error(`connection closed (${this.closeCode}) before ${id} was up to ${sequenceNo}`);
      await this.next((m) => m.type === 'changes' && m.subscription === id, left).catch(() => undefined);
    }
  }

  async close() {
    if (this.closeCode === undefined) this.socket.close(1000);
    await this.closed;
  }
}

const LABEL = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };

/**
 * A change request that creates a symbol on the given layer. Longitude and latitude differ
 * (ADR-0007), and every call gets a new position, so objects are distinguishable. Data model 1.0.0:
 * the built-in data type core.general, placed by hand (manual), as draw-symbols does.
 */
export function createSymbol(layerId, index = 0, { plugin = 'ita-test', name } = {}) {
  return {
    requestId: randomUUID(),
    entityType: 'object',
    operation: 'create',
    entityId: randomUUID(),
    data: {
      type: 'core.symbol',
      dataType: 'core.general',
      dataSource: 'manual',
      layerId,
      geometry: { type: 'Point', coordinates: [18 + (index % 1000) / 1000, 59 + Math.floor(index / 1000) / 100] },
      symbol: { standard: 'APP-6D', sidc: '10061000001211000000' },
      label: LABEL,
      ...(name ? { properties: { name } } : {}),
    },
    source: { plugin },
  };
}

/**
 * Creates `count` symbols through `client`, with at most `window` requests waiting at a time (the
 * server rejects more than 100 waiting per session). Resolves with the applied events in order.
 */
export async function createSymbols(client, layerId, count, window = 50) {
  const events = [];
  for (let start = 0; start < count; start += window) {
    const requests = [];
    for (let i = start; i < Math.min(count, start + window); i++) requests.push(createSymbol(layerId, i));
    for (const r of requests) client.send({ type: 'change-request', request: r });
    for (const r of requests) {
      const outcome = await client.next((m) => m.type === 'change-outcome' && m.requestId === r.requestId);
      if (outcome.outcome !== 'applied') throw new Error(`create ${r.entityId}: ${JSON.stringify(outcome)}`);
      events.push(outcome.event);
    }
  }
  return events;
}

/**
 * A change request that creates a layer; with `workspace` (data model 1.2.0) in that workspace,
 * without it in View.
 */
export function createLayer(name, { workspace, drawOrder = 0, plugin = 'ita-test' } = {}) {
  return {
    requestId: randomUUID(),
    entityType: 'layer',
    operation: 'create',
    entityId: randomUUID(),
    data: { name, drawOrder, visible: true, label: LABEL, ...(workspace !== undefined ? { workspace } : {}) },
    source: { plugin },
  };
}

/** The id of the layer named "Drawing" in a snapshot. */
export function seededLayer(snapshot) {
  const layer = snapshot.layers.find((l) => l.name === 'Drawing');
  if (!layer) throw new Error(`no Drawing layer in ${JSON.stringify(snapshot.layers)}`);
  return layer.id;
}

/**
 * An area (protocol 2, the SDK's Area) from a lon/lat box: a closed ring through its corners, its
 * centre inside, no margin. The ring's edges are geodesics, the short way: for a box wider than
 * 180° of longitude the west and east edges meet across the antimeridian, and the centre picks the
 * large side (the "world" boxes of the tests). For the poles build the ring by hand.
 */
export function boxArea([west, south, east, north], margin) {
  return {
    ring: [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
    inside: [(west + east) / 2, (south + north) / 2],
    ...(margin ? { margin } : {}),
  };
}
