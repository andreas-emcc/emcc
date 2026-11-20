import { describe, expect, it, vi } from 'vitest';
import type { GraphicRenderRequest, GraphicRendering, MilSymbol, Position, SymbolService, Uuid } from '@emc2/plugin-sdk';
import { createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import type { DrawItem } from '../../src/core/drawData.ts';
import { contains, drawsGraphics, extentOfRing, GraphicRenderer, MAX_IN_FLIGHT, reaches, scaled, translatedParts, type GraphicView, type LonLatExtent } from '../../src/core/graphics.ts';
import { FakeClock, uuid } from '../fixtures.ts';

type Graphic = Extract<DrawItem, { readonly kind: 'graphic' }>;

const AXIS: MilSymbol = { standard: 'APP-6D', sidc: '10032500001514030000' };
const BOUNDARY: MilSymbol = { standard: 'APP-6D', sidc: '10032500001101000000' };

const graphic = (n: number, points: Position[], symbol: MilSymbol = AXIS, layer = 1): Graphic => ({
  id: uuid(n), layerId: uuid(layer), kind: 'graphic', symbol, points, parts: null,
});

/** A renderer with a fake service, a view the test moves, and what was delivered. */
function setup(options: { service?: SymbolService | null; extent?: LonLatExtent } = {}) {
  const clock = new FakeClock();
  const service = options.service === undefined ? createFakeSymbolService() : options.service;
  const view: GraphicView = { extent: options.extent ?? [10, 55, 20, 65], groundResolution: 1000, resolution: 1000 };
  const state = { view: view as GraphicView | null, service };
  const delivered: { layerId: Uuid; items: ReadonlyMap<Uuid, DrawItem> }[] = [];
  const warn = vi.fn();
  const renderer = new GraphicRenderer({
    symbols: () => state.service,
    view: () => state.view,
    deliver: (layerId, items) => {
      delivered.push({ layerId, items });
    },
    log: { warn },
    clock,
  });
  /** Lets the service's answers arrive and the slices run. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      clock.advance(0);
    }
  };
  const deliveredItems = () => delivered.flatMap((d) => [...d.items.values()]);
  return { renderer, clock, state, delivered, deliveredItems, warn, settle, service: service as ReturnType<typeof createFakeSymbolService> };
}

const POINTS: Position[] = [[12, 60], [14, 61], [16, 60.5]]; // longitude ≠ latitude

describe('GraphicRenderer (brief function 29, criteria 61 to 63)', () => {
  it('asks the service for a graphic in view, and hands on the drawing in place of the marker', async () => {
    const { renderer, state, deliveredItems, settle, service } = setup();
    const item = graphic(1, POINTS);
    expect(renderer.attach(item).parts).toBeNull(); // the marker until the answer
    await settle();
    expect(service.renderGraphicCalls).toBe(1);
    const [drawn] = deliveredItems() as Graphic[];
    expect(drawn?.id).toBe(item.id);
    // With the fake service the graphic's line runs through its control points (criterion 61).
    expect([...(drawn?.parts?.lines[0]?.coordinates ?? [])]).toEqual([12, 60, 14, 61, 16, 60.5]);
    expect(renderer.attach(item).parts).not.toBeNull(); // known now
    expect(state.view).not.toBeNull();
  });

  it('sends the control points, the view\'s resolution and an extent one and a half times the view', async () => {
    const requests: GraphicRenderRequest[] = [];
    const service = createFakeSymbolService();
    const real = service.renderGraphic.bind(service);
    service.renderGraphic = (request) => {
      requests.push(request);
      return real(request);
    };
    const { renderer, settle } = setup({ service });
    renderer.attach(graphic(1, POINTS));
    await settle();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ standard: 'APP-6D', sidc: AXIS.sidc, points: POINTS, resolution: 1000 });
    expect(requests[0]?.extent).toEqual([7.5, 52.5, 22.5, 67.5]);
  });

  it('asks again after a zoom, not after a pan inside the drawn extent, and again after a pan out of it (criterion 62)', async () => {
    const { renderer, state, settle, service } = setup();
    renderer.attach(graphic(1, POINTS));
    await settle();
    expect(service.renderGraphicCalls).toBe(1);
    // A pan inside the extent drawn (7.5 to 22.5): nothing.
    state.view = { ...(state.view as GraphicView), extent: [8, 55, 18, 65] };
    renderer.viewChanged();
    await settle();
    expect(service.renderGraphicCalls).toBe(1);
    // A zoom: a new resolution.
    state.view = { extent: [11, 58, 17, 62], groundResolution: 500, resolution: 500 };
    renderer.viewChanged();
    await settle();
    expect(service.renderGraphicCalls).toBe(2);
    // A pan out of the drawn extent, the graphic still in reach.
    state.view = { extent: [15, 58, 22, 62], groundResolution: 500, resolution: 500 };
    renderer.viewChanged();
    await settle();
    expect(service.renderGraphicCalls).toBe(3);
    // A slightly different resolution (a pan in Web Mercator) is the same resolution.
    state.view = { extent: [15.2, 58, 22.2, 62], groundResolution: 500, resolution: 500.5 };
    renderer.viewChanged();
    await settle();
    expect(service.renderGraphicCalls).toBe(3);
  });

  it('does not ask for a graphic out of view', async () => {
    const { renderer, state, settle, service } = setup();
    renderer.attach(graphic(1, [[100, -40], [101, -41], [102, -40]]));
    await settle();
    expect(service.renderGraphicCalls).toBe(0);
    state.view = { ...(state.view as GraphicView), extent: [95, -45, 105, -35] };
    renderer.viewChanged();
    await settle();
    expect(service.renderGraphicCalls).toBe(1);
  });

  it('asks again when the object changes, and drops the answer for the older state (criterion 62)', async () => {
    const slow: { resolve: (r: GraphicRendering) => void }[] = [];
    const service = createFakeSymbolService();
    service.renderGraphic = () => new Promise<GraphicRendering>((resolve) => slow.push({ resolve }));
    const { renderer, deliveredItems, settle } = setup({ service });
    renderer.attach(graphic(1, POINTS));
    await settle();
    expect(slow).toHaveLength(1);
    // The object changes while the first request is in flight.
    const moved: Position[] = [[13, 60], [15, 61], [17, 60.5]];
    renderer.attach(graphic(1, moved));
    await settle();
    expect(slow).toHaveLength(2);
    const answer = (points: Position[]): GraphicRendering => ({ ok: true, lines: [{ coordinates: new Float64Array(points.flat()), color: '#000000', width: 2 }], fills: [], labels: [] });
    slow[0]?.resolve(answer(POINTS)); // the old state's answer
    await settle();
    expect(deliveredItems()).toHaveLength(0); // dropped
    slow[1]?.resolve(answer(moved));
    await settle();
    expect([...((deliveredItems() as Graphic[])[0]?.parts?.lines[0]?.coordinates ?? [])]).toEqual([13, 60, 15, 61, 17, 60.5]);
  });

  it('keeps the marker without the service and when it refuses, and logs the reason once (criterion 63)', async () => {
    // No service at all: nothing is asked, nothing is logged.
    const none = setup({ service: null });
    none.renderer.attach(graphic(1, POINTS));
    await none.settle();
    expect(none.deliveredItems()).toHaveLength(0);
    expect(none.warn).not.toHaveBeenCalled();
    // A service without renderGraphic no longer exists: the member is required since the 1.4.0 freeze.
    // A refusal.
    const refusing = setup();
    refusing.service.refuse('no such graphic');
    const item = graphic(1, POINTS);
    refusing.renderer.attach(item);
    await refusing.settle();
    expect((refusing.deliveredItems() as Graphic[])[0]?.parts).toBeNull();
    expect(refusing.warn).toHaveBeenCalledTimes(1);
    expect(refusing.warn.mock.calls[0]?.[0]).toContain('no such graphic');
    // The same state again (a zoom): the reason is not logged twice.
    refusing.state.view = { extent: [11, 58, 17, 62], groundResolution: 500, resolution: 500 };
    refusing.renderer.viewChanged();
    await refusing.settle();
    expect(refusing.warn).toHaveBeenCalledTimes(1);
    // A changed object logs again.
    refusing.renderer.attach(graphic(1, [[13, 60], [15, 61], [17, 60.5]]));
    await refusing.settle();
    expect(refusing.warn).toHaveBeenCalledTimes(2);
  });

  it('draws no APP-6B graphic: it keeps the marker, and says so once', async () => {
    const { renderer, deliveredItems, warn, settle, service } = setup();
    renderer.attach(graphic(1, POINTS, { standard: 'APP-6B', sidc: 'GFGPGLB----K---' }));
    await settle();
    expect(service.renderGraphicCalls).toBe(0);
    expect((deliveredItems() as Graphic[])[0]?.parts).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('APP-6B');
  });

  it('draws no vessel symbol as a graphic (SDK 1.4.0 part 3): it keeps the marker, and says so once', async () => {
    const { renderer, deliveredItems, warn, settle, service } = setup();
    renderer.attach(graphic(1, POINTS, { standard: 'vessel', sidc: '0470' }));
    await settle();
    expect(service.renderGraphicCalls).toBe(0);
    expect((deliveredItems() as Graphic[])[0]?.parts).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('vessel');
  });

  it('asks only for the standards the service draws: APP-6 D and E', () => {
    expect((['APP-6B', 'APP-6D', 'APP-6E', 'vessel'] as const).map(drawsGraphics)).toEqual([false, true, true, false]);
  });

  it('has a limited number of requests in flight, and asks for the rest as they answer', async () => {
    const pending: { resolve: (r: GraphicRendering) => void }[] = [];
    const service = createFakeSymbolService();
    service.renderGraphic = () => new Promise<GraphicRendering>((resolve) => pending.push({ resolve }));
    const { renderer, settle } = setup({ service });
    for (let n = 1; n <= MAX_IN_FLIGHT + 10; n++) renderer.attach(graphic(n, POINTS, BOUNDARY));
    await settle();
    expect(pending).toHaveLength(MAX_IN_FLIGHT);
    pending[0]?.resolve({ ok: false, reason: 'x' });
    await settle();
    expect(pending).toHaveLength(MAX_IN_FLIGHT + 1);
  });

  it('hands on the answers a slice at a time, so no task takes long (spike S1)', async () => {
    const { clock, deliveredItems, delivered, settle } = setup();
    // The engine takes 8 ms to draw an item: three fit in a slice of 20 ms.
    const items = Array.from({ length: 10 }, (_, i) => graphic(i + 1, POINTS, BOUNDARY));
    // Rebuild with a delivery that costs time.
    const costly = new GraphicRenderer({
      symbols: () => createFakeSymbolService(),
      view: () => ({ extent: [10, 55, 20, 65], groundResolution: 1000, resolution: 1000 }),
      deliver: (layerId, batch) => {
        delivered.push({ layerId, items: batch });
        clock.time += 8 * batch.size;
      },
      log: { warn: vi.fn() },
      clock,
    });
    for (const item of items) costly.attach(item);
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    clock.advance(0);
    await settle();
    clock.advance(1_000);
    expect(deliveredItems()).toHaveLength(10);
    expect(delivered.length).toBeGreaterThan(1);
    // The first chunk is a guess (4 items, 32 ms here); then the chunks follow the cost, one item at 8 ms, and a slice ends once 20 ms are used.
    const sizes = delivered.map((d) => d.items.size);
    expect(sizes[0]).toBe(4);
    expect(sizes.slice(1).every((size) => size === 1)).toBe(true);
  });

  it('drops the answer of a request that was sent before the object changed and changed back', async () => {
    const waiting: { resolve: (r: GraphicRendering) => void }[] = [];
    const service = createFakeSymbolService();
    service.renderGraphic = () => new Promise<GraphicRendering>((resolve) => waiting.push({ resolve }));
    const { renderer, deliveredItems, settle } = setup({ service });
    const other: Position[] = [[13, 60], [15, 61], [17, 60.5]];
    renderer.attach(graphic(1, POINTS)); // request 1
    await settle();
    renderer.attach(graphic(1, other)); // the object changes ...
    await settle();
    renderer.attach(graphic(1, POINTS)); // ... and back: request 3
    await settle();
    expect(waiting).toHaveLength(3);
    const answer = (): GraphicRendering => ({ ok: true, lines: [], fills: [], labels: [] });
    waiting[0]?.resolve(answer()); // the first request's answer: older than the third
    await settle();
    expect(deliveredItems()).toHaveLength(0);
    waiting[2]?.resolve(answer());
    await settle();
    expect(deliveredItems()).toHaveLength(1);
  });

  it('forgets a deleted graphic: a late answer is not delivered', async () => {
    const slow: { resolve: (r: GraphicRendering) => void }[] = [];
    const service = createFakeSymbolService();
    service.renderGraphic = () => new Promise<GraphicRendering>((resolve) => slow.push({ resolve }));
    const { renderer, deliveredItems, settle } = setup({ service });
    renderer.attach(graphic(1, POINTS));
    await settle();
    renderer.forget(uuid(1));
    slow[0]?.resolve({ ok: true, lines: [], fills: [], labels: [] });
    await settle();
    expect(deliveredItems()).toHaveLength(0);
  });

  it('keeps a faded item faded when the answer comes', async () => {
    const { renderer, deliveredItems, settle } = setup();
    renderer.attach({ ...graphic(1, POINTS), faded: true });
    await settle();
    expect((deliveredItems()[0] as Graphic).faded).toBe(true);
  });
});

describe('the extent of a graphic request', () => {
  it('is the view scaled about its middle, across the antimeridian too, and the world when it covers it', () => {
    expect(scaled([10, 55, 20, 65], 1.5)).toEqual([7.5, 52.5, 22.5, 67.5]);
    const across = scaled([170, 0, -170, 10], 1.5); // 20° wide across the antimeridian
    expect(across[0]).toBeCloseTo(165, 9);
    expect(across[2]).toBeCloseTo(-165, 9);
    expect(scaled([-170, -50, 170, 50], 1.5)).toEqual([-180, -75, 180, 75].map((v, i) => (i === 1 ? -75 : v)));
    expect(scaled([0, 80, 10, 90], 1.5)[3]).toBe(90); // not beyond the pole
  });

  it('is made from the visible ring: its narrowest longitudes, with the antimeridian inside, and the pole in a polar view', () => {
    expect(extentOfRing([[10, 55], [20, 55], [20, 65], [10, 65]], [15, 60])).toEqual([10, 55, 20, 65]);
    expect(extentOfRing([[175, 0], [-175, 0], [-175, 10], [175, 10]], [180, 5])).toEqual([175, 0, -175, 10]);
    const polar = extentOfRing(Array.from({ length: 8 }, (_, i): Position => [-180 + i * 45, 60]), [0, 90]);
    expect(polar).toEqual([-180, 60, 180, 90]);
  });

  it('tells what lies in an extent', () => {
    expect(contains([7.5, 52.5, 22.5, 67.5], [8, 55, 18, 65])).toBe(true);
    expect(contains([7.5, 52.5, 22.5, 67.5], [19, 55, 25, 65])).toBe(false);
    expect(contains([165, 0, -165, 10], [170, 1, -170, 9])).toBe(true);
    expect(reaches([[12, 60]], [10, 55, 20, 65])).toBe(true);
    expect(reaches([[100, 60]], [10, 55, 20, 65])).toBe(false);
    expect(reaches([[179, 5]], [170, 0, -170, 10])).toBe(true);
  });

  it('moves a drawn graphic by a difference in longitude and latitude, clamped at the poles', () => {
    const parts = { ok: true as const, lines: [{ coordinates: new Float64Array([10, 60, 20, 89]), color: '#000000', width: 2 }], fills: [], labels: [{ position: [10, 60] as Position, text: 'A', angle: 0, font: '12px sans-serif', color: '#000000', align: 'left' as const }] };
    const moved = translatedParts(parts, 2, 1);
    expect([...(moved.lines[0]?.coordinates ?? [])]).toEqual([12, 61, 22, 90]);
    expect(moved.labels[0]?.position).toEqual([12, 61]);
  });
});
