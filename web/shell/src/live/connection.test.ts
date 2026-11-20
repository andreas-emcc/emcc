import {
  ObjectQueryError, OutcomeUnknownError, type Area, type ChangeOutcome, type ChangeRequestContent, type LivePictureListener, type MapView, type Snapshot,
  type Viewport,
} from '@emc2/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changes, layer, layerEvent, mapObject, objectEvent, sendSnapshot, socketFactory } from '../testing/fakes.ts';
import { LiveConnection, type LiveState } from './connection.ts';
import { LiveSubscriptions } from './subscriptions.ts';

const create: ChangeRequestContent = { entityType: 'layer', operation: 'delete', entityId: 'L1' };
const quiet = { warn: () => undefined };
const noErrors = () => undefined;

/** A view of about 110 × 70 km around Stockholm, its ring with corners only. */
function viewport(lon: number, lat: number, half = 1, resolution = 100): Viewport {
  const h = half;
  const v = half * 0.6;
  return {
    center: [lon, lat], resolution, projection: 'EPSG:3857',
    visibleArea: [[lon - h, lat - v], [lon + h, lat - v], [lon + h, lat + v], [lon - h, lat + v], [lon - h, lat - v]],
  };
}

/** A map view the test moves. */
function fakeMapView(start: Viewport) {
  const listeners = new Set<(v: Viewport) => void>();
  const view = {
    viewport: start,
    onViewportChange: (listener: (v: Viewport) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    view: view as unknown as MapView,
    move(next: Viewport) {
      view.viewport = next;
      for (const l of [...listeners]) l(next);
    },
  };
}

function setUp(options: {
  outcomeTimeoutMs?: number; mapView?: () => Promise<MapView>; random?: () => number; log?: Pick<Console, 'warn'>; onDisplay?: () => void;
  onLabeling?: () => void;
} = {}) {
  const sockets = socketFactory();
  const states: LiveState[] = [];
  const connection = new LiveConnection({
    url: 'ws://emc2.test/api/live', createSocket: sockets.create, onState: (s) => states.push(s),
    // The highest jitter: each pause is its full delay (see the jitter test for the rest).
    reconnectDelaysMs: [1_000, 5_000], log: options.log ?? quiet, random: options.random ?? (() => 1),
    ...(options.outcomeTimeoutMs === undefined ? {} : { outcomeTimeoutMs: options.outcomeTimeoutMs }),
    ...(options.onDisplay === undefined ? {} : { onDisplay: options.onDisplay }),
    ...(options.onLabeling === undefined ? {} : { onLabeling: options.onLabeling }),
  });
  const live = new LiveSubscriptions(connection, options.mapView ?? (() => Promise.reject(new Error('no map view'))));
  connection.start();
  return { sockets, states, connection, live };
}

/** A listener that records every call. */
function recorder() {
  const calls: [string, unknown][] = [];
  const listener: Required<LivePictureListener> = {
    snapshot: (s) => calls.push(['snapshot', s]),
    changes: (b) => calls.push(['changes', b.map((e) => e.sequenceNo)]),
    area: (c) => calls.push(['area', c]),
    clusters: (u) => calls.push(['clusters', u]),
    counts: (c) => calls.push(['counts', c]),
  };
  return { calls, listener };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveConnection with protocol version 2', () => {
  it('asks for the display settings again after each welcome and at each display notice (SDK 1.4.0 part 5)', async () => {
    const onDisplay = vi.fn();
    const { sockets } = setUp({ onDisplay });
    sockets.last().receive({ type: 'welcome', protocol: 2, session: 'first' });
    expect(onDisplay).toHaveBeenCalledTimes(1);
    sockets.last().receive({ type: 'display' });
    expect(onDisplay).toHaveBeenCalledTimes(2);
    sockets.last().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    sockets.last().receive({ type: 'welcome', protocol: 2, session: 'second' });
    expect(onDisplay, 'a change missed while closed').toHaveBeenCalledTimes(3);
  });

  it('tells Settings › Labeling at each labeling notice (T-170)', () => {
    const onLabeling = vi.fn();
    const { sockets } = setUp({ onLabeling });
    sockets.last().receive({ type: 'welcome', protocol: 2, session: 'first' });
    expect(onLabeling).not.toHaveBeenCalled();
    sockets.last().receive({ type: 'labeling' });
    expect(onLabeling).toHaveBeenCalledTimes(1);
  });

  it("keeps the session id from welcome and sends the page's time at each change and after each reconnect (SDK 1.4.0)", async () => {
    const { sockets, connection } = setUp();
    connection.setTime({ time: '2026-11-06T08:00:00.000Z' }); // before any connection: kept
    expect(connection.session).toBeNull();
    sockets.last().receive({ type: 'welcome', protocol: 2, session: '9b2f4c1e-0d7a-4c55-8a51-1c2d3e4f5a6b' });

    expect(connection.session).toBe('9b2f4c1e-0d7a-4c55-8a51-1c2d3e4f5a6b');
    expect(sockets.last().sent).toEqual([{ type: 'time', time: { time: '2026-11-06T08:00:00.000Z' } }]);
    connection.setTime({ time: '2026-11-06T08:00:00.000Z' });
    connection.setTime({});
    expect(sockets.last().sent, 'a change only').toHaveLength(2);

    sockets.last().drop();
    expect(connection.session, 'none while closed').toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    sockets.last().receive({ type: 'welcome', protocol: 2, session: 'second' });
    expect(sockets.last().sent, 'a new session starts at now: nothing to send').toEqual([]);
    connection.setTime({ time: '2026-11-07T12:00:00.000Z', interval: { from: '2026-11-06T08:00:00.000Z', to: '2026-11-06T09:00:00.000Z' } });
    expect(sockets.last().sent).toHaveLength(1);
  });

  it('subscribes nothing until a plugin does, then the whole picture as "all", and assembles its snapshot from parts', () => {
    const { sockets, live, states, connection } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    expect(socket.sent).toEqual([]);
    expect(connection.state).toBe('open');

    const { calls, listener } = recorder();
    live.subscribe(listener, noErrors);
    expect(socket.sent).toEqual([{ type: 'subscribe', subscription: 'all', workspaces: ['core.view'] }]);
    sendSnapshot(socket, 41, [layer('L')], Array.from({ length: 2_500 }, (_, i) => mapObject(`o${String(i)}`)));
    socket.receive(changes('all', [objectEvent(42, 'b', 'create'), objectEvent(43, 'o1', 'delete')]));

    expect((calls[0]?.[1] as Snapshot).objects).toHaveLength(2_500);
    expect(Object.isFrozen((calls[0]?.[1] as Snapshot).objects[0])).toBe(true);
    expect(calls[1]).toEqual(['changes', [42, 43]]);
    expect(states).toEqual(['connecting', 'open']);
  });

  it('shares the whole picture: a late subscriber gets the current state, and the last one to leave unsubscribes it', () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const first = recorder();
    const stopFirst = live.subscribe(first.listener, noErrors);
    sendSnapshot(socket, 5, [], [mapObject('a')]);
    const second = recorder();
    const stopSecond = live.subscribe(second.listener, noErrors);

    expect(socket.sentTypes).toEqual(['subscribe']);
    expect((second.calls[0]?.[1] as Snapshot).sequenceNo).toBe(5);
    stopFirst();
    expect(socket.sentTypes).toEqual(['subscribe']);
    stopSecond();
    expect(socket.sent.at(-1)).toEqual({ type: 'unsubscribe', subscription: 'all' });
  });

  it('asks for a new snapshot when the whole picture goes back, or after an incomplete snapshot, and ignores batches until then', () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const { calls, listener } = recorder();
    live.subscribe(listener, noErrors);
    sendSnapshot(socket, 10, [], [mapObject('a')]);

    // The server leaves out other workspaces' changes (T-080): a skipped number is no gap.
    socket.receive(changes('all', [objectEvent(12, 'b', 'create')]));
    expect(socket.sentTypes).toEqual(['subscribe']);
    socket.receive(changes('all', [objectEvent(12, 'b', 'update')]));
    expect(socket.sentTypes).toEqual(['subscribe', 'unsubscribe', 'subscribe']);
    socket.receive(changes('all', [objectEvent(13, 'c', 'create')]));
    socket.receive({ type: 'snapshot-begin', subscription: 'all', sequenceNo: 13, layers: [], objectCount: 2 });
    socket.receive({ type: 'snapshot-objects', subscription: 'all', objects: [mapObject('b')] });
    socket.receive({ type: 'snapshot-end', subscription: 'all', sequenceNo: 13 });

    expect(socket.sentTypes).toEqual(['subscribe', 'unsubscribe', 'subscribe', 'unsubscribe', 'subscribe']);
    expect(calls.map(([kind]) => kind)).toEqual(['snapshot', 'changes']);
  });

  it('objects: false shares one channel of layers and counts, with every layer counted and only layer events', () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const { calls, listener } = recorder();
    live.subscribe(listener, noErrors, { objects: false });
    expect(socket.sent).toEqual([{ type: 'subscribe', subscription: 'counts', objects: false, workspaces: ['core.view'] }]);

    sendSnapshot(socket, 7, [layer('L'), layer('M')], [], { subscription: 'counts', objectCounts: { L: 2 } });
    socket.receive(changes('counts', [], 8)); // an object was created elsewhere: no event
    socket.receive({ type: 'counts', subscription: 'counts', sequenceNo: 8, counts: { L: 2, M: 1 } });
    socket.receive(changes('counts', [layerEvent(9, 'N', 'create')]));
    const late = recorder();
    live.subscribe(late.listener, noErrors, { objects: false });

    expect(calls).toEqual([
      ['snapshot', { layers: [layer('L'), layer('M')], objects: [], sequenceNo: 7, objectCounts: { L: 2, M: 0 } }],
      ['counts', { L: 2, M: 1 }],
      ['changes', [9]],
      ['counts', { L: 2, M: 1, N: 0 }],
    ]);
    expect(late.calls).toEqual([['snapshot', expect.objectContaining({ sequenceNo: 9, objectCounts: { L: 2, M: 1, N: 0 } }) as unknown]]);
    expect(socket.sentTypes).toEqual(['subscribe']);
  });

  it('an area subscription has a channel of its own and gets its objects, moves and clusters', () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const area: Area = { ring: [[17, 58], [20, 58], [20, 60], [17, 60], [17, 58]], inside: [18.5, 59] };
    const { calls, listener } = recorder();
    live.subscribe(listener, noErrors, { area, budget: 500 });
    const other = recorder();
    live.subscribe(other.listener, noErrors, { area });
    expect(socket.sent).toEqual([
      { type: 'subscribe', subscription: 'area-1', area, workspaces: ['core.view'], budget: 500 },
      { type: 'subscribe', subscription: 'area-2', area, workspaces: ['core.view'] },
    ]);

    sendSnapshot(socket, 3, [layer('L')], [mapObject('a')], { subscription: 'area-1' });
    socket.receive({ type: 'clusters', subscription: 'area-1', sequenceNo: 3, level: 9, full: true, upsert: [], remove: [] });
    socket.receive(changes('area-1', [], 5)); // nothing in this area changed
    socket.receive({ type: 'area-objects', subscription: 'area-1', sequenceNo: 5, entered: [mapObject('b')], left: ['a'] });

    expect(calls.map(([kind]) => kind)).toEqual(['snapshot', 'clusters', 'area']);
    expect(calls[2]?.[1]).toEqual({ sequenceNo: 5, entered: [mapObject('b')], left: ['a'] });
    expect(other.calls).toEqual([]);
  });

  it('area: viewport subscribes once the map view is known, sends a move only when the view leaves the area it holds, and subscribes with the current area after a reconnect', async () => {
    const map = fakeMapView(viewport(18, 59.3));
    let resolveView: (view: MapView) => void = () => undefined;
    const mapView = new Promise<MapView>((resolve) => { resolveView = resolve; });
    const { sockets, live } = setUp({ mapView: () => mapView });
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    live.subscribe(recorder().listener, noErrors, { area: 'viewport', budget: 10_000 });
    expect(sockets.last().sent).toEqual([]);

    resolveView(map.view);
    await vi.advanceTimersByTimeAsync(0);
    const subscribe = sockets.last().sent[0] as unknown as { area: Area; resolution: number; budget: number };
    expect(subscribe).toMatchObject({ type: 'subscribe', subscription: 'area-1', resolution: 100, budget: 10_000 });
    expect(subscribe.area).toEqual({ ring: viewport(18, 59.3).visibleArea, inside: [18, 59.3], margin: { share: 0.5 } });

    map.move(viewport(18.1, 59.32)); // a small pan: still inside
    map.move(viewport(18, 59.3, 0.9)); // a small zoom in: not below a quarter
    expect(sockets.last().sentTypes).toEqual(['subscribe']);
    map.move(viewport(19.5, 59.3)); // panned out of it
    expect(sockets.last().sent[1]).toMatchObject({ type: 'area', subscription: 'area-1', area: { inside: [19.5, 59.3] }, resolution: 100 });
    map.move(viewport(19.5, 59.3, 0.5, 50)); // zoomed in to a quarter
    expect(sockets.last().sentTypes).toEqual(['subscribe', 'area', 'area']);

    sockets.last().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    expect(sockets.last().sent[0]).toMatchObject({ type: 'subscribe', subscription: 'area-1', area: { inside: [19.5, 59.3] }, resolution: 50 });
  });

  it('area: viewport waits for a view with an area, and subscribes again with the next view after the server refused it', async () => {
    const empty: Viewport = { center: [0, 0], resolution: 1, projection: 'EPSG:3857', visibleArea: [] };
    const map = fakeMapView(empty); // a map that has no size yet
    const { sockets, live } = setUp({ mapView: () => Promise.resolve(map.view) });
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    live.subscribe(recorder().listener, noErrors, { area: 'viewport', budget: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sent).toEqual([]);

    map.move(viewport(18, 59.3));
    expect(socket.sent).toEqual([expect.objectContaining({ type: 'subscribe', subscription: 'area-1' }) as unknown]);
    expect(socket.sent[0]).not.toHaveProperty('budget'); // 0 would be refused: the server's cap applies
    socket.receive({ type: 'error', subscription: 'area-1', message: 'subscription area-1 not opened: …' });
    map.move(viewport(18, 59.3)); // the same view: subscribes again, does not send a move
    expect(socket.sentTypes).toEqual(['subscribe', 'subscribe']);
  });

  it('follows a view around the pole and across the antimeridian without asking again for the same view', async () => {
    const polar: Viewport = {
      center: [0, 90], resolution: 2_000, projection: 'EPSG:3413',
      visibleArea: [[-180, 75], [-90, 75], [0, 75], [90, 75], [180, 75], [-180, 75]],
    };
    const map = fakeMapView(polar);
    const { sockets, live } = setUp({ mapView: () => Promise.resolve(map.view) });
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    live.subscribe(recorder().listener, noErrors, { area: 'viewport' });
    await vi.advanceTimersByTimeAsync(0);
    map.move(polar);
    map.move({ ...polar, center: [170, 89] });
    const across = viewport(180, 0, 2);
    map.move(across); // far away: a move
    map.move(viewport(179.5, 0.2, 2)); // a small pan across the antimeridian: inside

    expect(sockets.last().sentTypes).toEqual(['subscribe', 'area']);
  });

  it('sends a ring of at most 256 positions, closed, however many the view has', async () => {
    const ring: [number, number][] = [];
    for (let i = 0; i < 4_000; i++) ring.push([17 + (2 * i) / 4_000, 59]); // a long southern edge, split finely
    ring.push([19, 59.6], [17, 59.6], [17, 59]);
    const map = fakeMapView({ center: [18, 59.3], resolution: 100, projection: 'EPSG:3857', visibleArea: ring });
    const { sockets, live } = setUp({ mapView: () => Promise.resolve(map.view) });
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    live.subscribe(recorder().listener, noErrors, { area: 'viewport' });
    await vi.advanceTimersByTimeAsync(0);

    const sent = (sockets.last().sent[0] as unknown as { area: Area }).area.ring;
    expect(sent.length).toBeLessThanOrEqual(256);
    expect(sent[0]).toEqual([17, 59]);
    expect(sent.at(-1)).toEqual([17, 59]); // closed again; a corner may be cut, which the margin covers
  });

  it('a wide, low view does not ask again when nothing moved', async () => {
    const wide: Viewport = {
      center: [10, 50], resolution: 50, projection: 'EPSG:3857',
      visibleArea: [[8, 49.9], [12, 49.9], [12, 50.1], [8, 50.1], [8, 49.9]],
    };
    const map = fakeMapView(wide);
    const { sockets, live } = setUp({ mapView: () => Promise.resolve(map.view) });
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    live.subscribe(recorder().listener, noErrors, { area: 'viewport' });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5; i++) map.move(wide);

    expect(sockets.last().sentTypes).toEqual(['subscribe']);
  });

  it('resolves an applied change once every subscription has judged it, also those it did not concern', async () => {
    const { sockets, live, connection } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    live.subscribe(recorder().listener, noErrors);
    live.subscribe(recorder().listener, noErrors, { area: { ring: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], inside: [0.5, 0.5] } });
    sendSnapshot(socket, 10, [], []);
    sendSnapshot(socket, 10, [], [], { subscription: 'area-1' });
    const outcome = vi.fn<(o: ChangeOutcome) => void>();

    void connection.submit(create, 'layer-panel').then(outcome);
    const request = socket.lastRequest();
    expect(request.source).toEqual({ plugin: 'layer-panel' });
    expect(request.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const event = objectEvent(11, 'x', 'create', request.requestId);
    socket.receive({ type: 'change-outcome', requestId: request.requestId, outcome: 'applied', event });
    socket.receive(changes('all', [event]));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).not.toHaveBeenCalled(); // the area subscription has not judged it yet

    socket.receive(changes('area-1', [], 11));
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toHaveBeenCalledWith({ outcome: 'applied', event });
  });

  it('resolves an applied change at the latest after the outcome timeout, if a subscription never gets a snapshot', async () => {
    const { sockets, live, connection } = setUp({ outcomeTimeoutMs: 10_000 });
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    live.subscribe(recorder().listener, noErrors); // the server never sends its snapshot
    const result = connection.submit(create, 'p');
    const requestId = socket.lastRequest().requestId;
    const event = objectEvent(3, 'x', 'create', requestId);
    socket.receive({ type: 'change-outcome', requestId, outcome: 'applied', event });

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toEqual({ outcome: 'applied', event });
  });

  it('resolves with the rejection, and without subscriptions an applied change at once', async () => {
    const { sockets, connection } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const rejected = connection.submit(create, 'p');
    const first = socket.lastRequest().requestId;
    const rejection = { requestId: first, code: 'LAYER_NOT_EMPTY', message: 'not empty' };
    socket.receive({ type: 'change-outcome', requestId: first, outcome: 'rejected', rejection });
    await expect(rejected).resolves.toEqual({ outcome: 'rejected', rejection });

    const applied = connection.submit(create, 'p');
    const second = socket.lastRequest().requestId;
    const event = objectEvent(1, 'x', 'create', second);
    socket.receive({ type: 'change-outcome', requestId: second, outcome: 'applied', event });
    await expect(applied).resolves.toEqual({ outcome: 'applied', event });
  });

  it('rejects with OutcomeUnknownError on an unknown outcome, an error about the request, or no answer in time', async () => {
    const { sockets, connection } = setUp({ outcomeTimeoutMs: 10_000 });
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const idOf = () => socket.lastRequest().requestId;

    const unknown = connection.submit(create, 'p');
    socket.receive({ type: 'change-outcome', requestId: idOf(), outcome: 'unknown' });
    await expect(unknown).rejects.toBeInstanceOf(OutcomeUnknownError);

    const refused = connection.submit(create, 'p');
    socket.receive({ type: 'error', requestId: idOf(), message: 'too busy' });
    await expect(refused).rejects.toThrow(/too busy/);

    const silent = connection.submit(create, 'p');
    const late = idOf();
    const expectation = expect(silent).rejects.toThrow(/within 10 s/);
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
    socket.receive({ type: 'change-outcome', requestId: late, outcome: 'rejected', rejection: {} }); // ignored
  });

  it('ends every waiting request with OutcomeUnknownError when the connection is lost, reconnects, and subscribes every channel again', async () => {
    const { sockets, connection, live, states } = setUp();
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    live.subscribe(recorder().listener, noErrors);
    live.subscribe(recorder().listener, noErrors, { objects: false });
    const first = connection.submit(create, 'p');

    sockets.last().drop();

    await expect(first).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(connection.state).toBe('closed');
    await expect(connection.submit(create, 'p')).rejects.toThrow(/not connected/);
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.sockets).toHaveLength(2);
    expect(states).toEqual(['connecting', 'open', 'closed', 'connecting']);

    sockets.last().drop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets.sockets).toHaveLength(3);
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    expect(sockets.last().sent).toEqual([
      { type: 'subscribe', subscription: 'all', workspaces: ['core.view'] }, { type: 'subscribe', subscription: 'counts', objects: false, workspaces: ['core.view'] },
    ]);
    sockets.last().drop();
    await vi.advanceTimersByTimeAsync(1_000); // a welcome resets the pause
    expect(sockets.sockets).toHaveLength(4);
  });

  it('jitters the reconnect pauses: half of each fixed, half random', async () => {
    const draws = [0, 0.5];
    const { sockets } = setUp({ random: () => draws.shift() ?? 0 });
    sockets.last().drop();
    await vi.advanceTimersByTimeAsync(499);
    expect(sockets.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); // 1 000 ms × (0.5 + 0 × 0.5)
    expect(sockets.sockets).toHaveLength(2);
    sockets.last().drop();
    await vi.advanceTimersByTimeAsync(3_749);
    expect(sockets.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // 5 000 ms × (0.5 + 0.5 × 0.5)
    expect(sockets.sockets).toHaveLength(3);
  });

  it('ignores a message of the wrong shape, and says why, instead of failing in a listener', () => {
    const warnings: string[] = [];
    const { sockets, live } = setUp({ log: { warn: (text: unknown) => warnings.push(String(text)) } });
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    const all = recorder();
    live.subscribe(all.listener, noErrors);
    for (const bad of [null, 42, 'text', { protocol: 2 }, { type: 'changes', subscription: 'all', sequenceNo: 3 },
      { type: 'snapshot-begin', subscription: 'all', sequenceNo: 'one', layers: [], objectCount: 0 }, { type: 'settings', plugin: 'p' },
      { type: 'changes', subscription: 'all', sequenceNo: 3, events: [null] },
      { type: 'snapshot-objects', subscription: 'all', objects: [{ name: 'no id' }] }]) {
      sockets.last().receiveText(JSON.stringify(bad));
    }
    sockets.last().receiveText('{not json');
    expect(warnings).toEqual([
      'Live picture: a message was ignored: not an object with a type',
      'Live picture: a message was ignored: not an object with a type',
      'Live picture: a message was ignored: not an object with a type',
      'Live picture: a message was ignored: not an object with a type',
      'Live picture: a message was ignored: a changes message without a valid events',
      'Live picture: a message was ignored: a snapshot-begin message without a valid sequenceNo',
      'Live picture: a message was ignored: a settings message without a valid values',
      'Live picture: a message was ignored: a changes message without a valid events',
      'Live picture: a message was ignored: a snapshot-objects message without a valid objects',
      'Live picture: a message was ignored: not JSON',
    ]);
    sockets.last().receive({ type: '__proto__' });
    expect(warnings.at(-1), 'no type of the prototype chain').toBe('Live picture: a message of an unknown type was ignored');
    expect(all.calls).toEqual([]);
  });

  it('takes a snapshot part of any size (no argument-limit spread)', () => {
    const { sockets, live } = setUp();
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    const all = recorder();
    live.subscribe(all.listener, noErrors);
    const objects = Array.from({ length: 200_000 }, (_, i) => ({ id: `o${String(i)}` }));
    sockets.last().receive({ type: 'snapshot-begin', subscription: 'all', sequenceNo: 1, layers: [], objectCount: objects.length });
    sockets.last().receive({ type: 'snapshot-objects', subscription: 'all', objects });
    sockets.last().receive({ type: 'snapshot-end', subscription: 'all', sequenceNo: 1 });
    expect(all.calls.map(([kind]) => kind)).toEqual(['snapshot']);
  });

  it('stops on another protocol version and does not reconnect', async () => {
    const { sockets, connection } = setUp();
    sockets.last().receive({ type: 'welcome', protocol: 1 });

    expect(connection.state).toBe('incompatible');
    expect(sockets.last().closedWith?.code).toBe(1000);
    sockets.last().drop(1000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.sockets).toHaveLength(1);
  });

  it('ignores messages that are not JSON, of an unknown type, or for a subscription it does not have', () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const { calls, listener } = recorder();
    live.subscribe(listener, noErrors);
    socket.receive({ type: 'something-new' });
    (socket as unknown as { fire: (t: string, e: object) => void }).fire('message', { data: 'not json' });
    sendSnapshot(socket, 1, [], [], { subscription: 'nobody' });
    expect(calls).toEqual([]);
  });

  it('ends for good when the server says the login session has ended, or on stop', async () => {
    const { sockets, connection, states } = setUp();
    sockets.last().receive({ type: 'welcome', protocol: 2 });
    const waiting = connection.submit(create, 'p');
    sockets.last().drop(4401);
    await expect(waiting).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(states.at(-1)).toBe('logged-out');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.sockets).toHaveLength(1);

    const other = setUp();
    other.sockets.last().receive({ type: 'welcome', protocol: 2 });
    other.connection.stop();
    expect(other.sockets.last().closedWith?.code).toBe(1000);
  });

  it('passes the data types and the settings of each plugin on, whether subscribed or not (SDK v1)', () => {
    const sockets = socketFactory();
    const dataTypes: unknown[] = [];
    const settings: unknown[] = [];
    const connection = new LiveConnection({
      url: 'ws://emc2.test/api/live', createSocket: sockets.create, log: quiet,
      onDataTypes: (d) => dataTypes.push(d), onSettings: (plugin, values) => settings.push([plugin, values]),
    });
    connection.start();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });

    socket.receive({ type: 'data-types', dataTypes: [{ id: 'core.general' }] });
    socket.receive({ type: 'settings', plugin: 'cot', values: { mode: 'x' } });

    expect(dataTypes).toEqual([[{ id: 'core.general' }]]);
    expect(settings).toEqual([['cot', { mode: 'x' }]]);
  });
});

describe('LiveConnection, object queries (ctx.objects, CR-0015 items 8 and 9)', () => {
  const ID = '0199e8a0-0000-7000-8000-000000000001';

  function opened(queryTimeoutMs?: number) {
    const sockets = socketFactory();
    const connection = new LiveConnection({
      url: 'ws://emc2.test/api/live', createSocket: sockets.create, log: quiet, reconnectDelaysMs: [1_000],
      ...(queryTimeoutMs === undefined ? {} : { queryTimeoutMs }),
    });
    connection.start();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const lastQuery = () => {
      const message = socket.sent.at(-1);
      if (message === undefined) throw new Error('nothing was sent');
      return message;
    };
    return { connection, socket, lastQuery };
  }

  it('fetches objects by id and a layer page, each answer to its own query', async () => {
    const { connection, socket, lastQuery } = opened();

    const fetched = connection.getObjects([ID, 'gone']);
    const fetch = lastQuery();
    const paged = connection.queryLayer('L', 1, 2);
    const page = lastQuery();
    expect(fetch).toEqual({ type: 'get-objects', queryId: fetch.queryId, ids: [ID, 'gone'] });
    expect(page).toEqual({ type: 'query-layer', queryId: page.queryId, layerId: 'L', page: 1, pageSize: 2 });
    expect(fetch.queryId).not.toEqual(page.queryId);

    // Answers in any order; the sequence number stays with the shell.
    socket.receive({ type: 'layer-page', queryId: page.queryId, sequenceNo: 7, layerId: 'L', page: 1, pageSize: 2, total: 3, objects: [mapObject('c')] });
    socket.receive({ type: 'objects', queryId: fetch.queryId, sequenceNo: 7, found: [mapObject(ID)], missing: ['gone'] });

    expect(await fetched).toEqual({ found: [mapObject(ID)], missing: ['gone'] });
    expect(await paged).toEqual({ layerId: 'L', page: 1, pageSize: 2, total: 3, objects: [mapObject('c')] });
  });

  it("rejects with ObjectQueryError on the server's query-failed, no answer in time, or a lost connection", async () => {
    const { connection, socket, lastQuery } = opened(15_000);

    for (const problem of ['invalid', 'no-layer', 'busy', 'unavailable']) {
      const query = connection.queryLayer('L', 0, 10);
      socket.receive({ type: 'query-failed', queryId: lastQuery().queryId, problem, message: `the server says ${problem}` });
      await expect(query, problem).rejects.toThrow(new ObjectQueryError(`the server says ${problem}`));
    }

    const silent = connection.getObjects([ID]);
    const late = lastQuery().queryId;
    const expectation = expect(silent).rejects.toThrow(new ObjectQueryError('no answer from the server within 15 s'));
    await vi.advanceTimersByTimeAsync(15_000);
    await expectation;
    socket.receive({ type: 'objects', queryId: late, sequenceNo: 1, found: [], missing: [ID] }); // too late: ignored

    const waiting = connection.getObjects([ID]);
    socket.drop();
    await expect(waiting).rejects.toThrow(new ObjectQueryError('the connection to the server was lost'));
    await expect(connection.queryLayer('L', 0, 10)).rejects.toThrow(new ObjectQueryError('not connected to the server'));
  });

  it('an answer of the wrong kind or shape fails the query or is ignored, never a listener', async () => {
    const log = { warn: vi.fn() };
    const sockets = socketFactory();
    const connection = new LiveConnection({ url: 'ws://emc2.test/api/live', createSocket: sockets.create, log, queryTimeoutMs: 1_000 });
    connection.start();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });

    const mixedUp = connection.getObjects([ID]);
    const queryId = socket.sent.at(-1)?.queryId;
    socket.receive({ type: 'layer-page', queryId, sequenceNo: 1, layerId: 'L', page: 0, pageSize: 1, total: 0, objects: [] });
    await expect(mixedUp).rejects.toThrow(new ObjectQueryError('the server answered get-objects with layer-page'));

    const malformed = connection.queryLayer('L', 0, 10);
    socket.receive({ type: 'layer-page', queryId: socket.sent.at(-1)?.queryId, sequenceNo: 1 });
    expect(log.warn).toHaveBeenCalledWith('Live picture: a message was ignored: a layer-page message without a valid layerId');
    const expectation = expect(malformed).rejects.toThrow(/within 1 s/); // ignored: it ends with the timeout
    await vi.advanceTimersByTimeAsync(1_000);
    await expectation;
  });
});

describe('the live picture by workspace (SDK 1.2.0, ADR-0039; T-080)', () => {
  it('a subscription without workspaces follows the one shown and gets a fresh snapshot at a switch; one with them does not', async () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const following = recorder();
    const named = recorder();
    live.subscribe(following.listener, noErrors);
    live.subscribe(named.listener, noErrors, { workspaces: ['simulator.simulation'] });
    live.subscribe(recorder().listener, noErrors, { objects: false, workspaces: ['*', 'core.view'] });
    expect(socket.sent).toEqual([
      { type: 'subscribe', subscription: 'all', workspaces: ['core.view'] },
      { type: 'subscribe', subscription: 'all-1', workspaces: ['simulator.simulation'] },
      { type: 'subscribe', subscription: 'counts-2', objects: false, workspaces: ['*'] },
    ]);
    sendSnapshot(socket, 5, [], [mapObject('a')]);
    sendSnapshot(socket, 5, [], [], { subscription: 'all-1' });

    let fresh = false;
    const switched = live.follow('simulator.simulation').then(() => { fresh = true; });
    expect(socket.sent.slice(3)).toEqual([
      { type: 'unsubscribe', subscription: 'all' },
      { type: 'subscribe', subscription: 'all', workspaces: ['simulator.simulation'] },
    ]);
    await Promise.resolve();
    expect(fresh).toBe(false);
    sendSnapshot(socket, 7, [], [mapObject('s')]);
    await switched;

    expect(fresh).toBe(true);
    expect(following.calls.map(([kind]) => kind)).toEqual(['snapshot', 'snapshot']);
    expect(named.calls.map(([kind]) => kind)).toEqual(['snapshot']);
  });

  it('subscriptions naming the same workspaces share a channel, in any order and with a workspace named twice', () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });

    const stopA = live.subscribe(recorder().listener, noErrors, { workspaces: ['b.two', 'a.one'] });
    live.subscribe(recorder().listener, noErrors, { workspaces: ['a.one', 'b.two', 'a.one'] });
    stopA();

    expect(socket.sent).toEqual([{ type: 'subscribe', subscription: 'all-1', workspaces: ['a.one', 'b.two'] }]);
  });

  it('an area subscription names its workspaces or follows the one shown, and is subscribed again at a switch', async () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const area: Area = { ring: [[17, 58], [20, 58], [20, 60], [17, 60], [17, 58]], inside: [18.5, 59] };
    live.subscribe(recorder().listener, noErrors, { area });
    live.subscribe(recorder().listener, noErrors, { area, workspaces: ['core.view'] });
    sendSnapshot(socket, 3, [], [], { subscription: 'area-1' });
    sendSnapshot(socket, 3, [], [], { subscription: 'area-2' });

    const switched = live.follow('simulator.simulation');
    sendSnapshot(socket, 4, [], [], { subscription: 'area-1' });
    await switched;

    expect(socket.sent.slice(2)).toEqual([
      { type: 'unsubscribe', subscription: 'area-1' },
      { type: 'subscribe', subscription: 'area-1', area, workspaces: ['simulator.simulation'] },
    ]);
  });

  it('a channel not subscribed at a switch is not waited for, and subscribes for the new workspace when it can', async () => {
    const { sockets, live } = setUp();
    live.subscribe(recorder().listener, noErrors);

    await live.follow('simulator.simulation'); // the connection is not open yet

    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    expect(socket.sent).toEqual([{ type: 'subscribe', subscription: 'all', workspaces: ['simulator.simulation'] }]);
  });
});

describe('a switch\'s wait for fresh snapshots (the conformance review of cda/workspaces-shell, 2)', () => {
  it('ends when the channel waited for is closed: its last subscriber was a panel of the workspace left', async () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    const stop = live.subscribe(recorder().listener, noErrors);
    sendSnapshot(socket, 5, [], []);
    let done = false;

    const switched = live.follow('simulator.simulation').then(() => { done = true; });
    stop();
    await switched;

    expect(done).toBe(true);
  });

  it('ends when the connection is lost', async () => {
    const { sockets, live } = setUp();
    const socket = sockets.last();
    socket.receive({ type: 'welcome', protocol: 2 });
    live.subscribe(recorder().listener, noErrors);
    sendSnapshot(socket, 5, [], []);

    const switched = live.follow('simulator.simulation');
    socket.drop();

    await expect(switched).resolves.toBeUndefined();
  });
});
