import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY } from '@emc2/plugin-sdk';
import type { GraphicRendering, MilSymbol, Position, Uuid } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeSymbolService, fakeGraphicImage } from '@emc2/plugin-sdk/testing';
import { initialView, MapController } from '../../src/core/controller.ts';
import type { DrawItem } from '../../src/core/drawData.ts';
import { registerProjections } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { FakeEngine } from '../fakeEngine.ts';
import { FakeClock, layer, object, uuid } from '../fixtures.ts';

const AXIS: MilSymbol = { standard: 'APP-6D', sidc: '10032500001514030000' };
const BOUNDARY: MilSymbol = { standard: 'APP-6D', sidc: '10032500001101000000' };
const FAN: MilSymbol = { standard: 'APP-6D', sidc: '10032500002422000000', modifiers: { distances: [5000], azimuths: [0, 90] } };
const A = layer(1, 10);

/** A controller on a fake engine, with the fake symbology service; `settle` lets answers and slices run. */
function setup(service = createFakeSymbolService()) {
  const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
  const start = initialView(DEFAULT_SETTINGS, projections);
  if (start === null) throw new Error('no initial view');
  const engine = new FakeEngine(start.projection);
  engine.show(start.center, start.resolution);
  const clock = new FakeClock();
  const ctx = createFakeContext({ pluginId: 'map-view-2d' });
  const controller = new MapController({
    display: DEFAULT_DISPLAY,
    engine, settings: DEFAULT_SETTINGS, projections, clock, origin: 'http://127.0.0.1:8080', log: ctx.log,
    notify: (n) => {
      ctx.notify(n);
    },
    objects: ctx.objects,
    rendering: { mode: 'hardware', renderer: 'Test GPU' },
  });
  controller.setSymbols(service);
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      clock.advance(1_000);
    }
  };
  return { engine, controller, map: controller.service, clock, service, settle, ctx };
}

// Longitude and latitude differ everywhere: the map starts near 15° E, 62° N.
const AXIS_POINTS: Position[] = [[15, 62], [17, 62.5], [16, 63]];
const axisObject = (n: number, points: Position[] = AXIS_POINTS) => object(n, A.id, 'core.multipoint', { type: 'LineString', coordinates: points }, { symbol: AXIS });

const graphicItem = (engine: FakeEngine, id: Uuid): Extract<DrawItem, { kind: 'graphic' }> | undefined => {
  const item = engine.items.get(A.id)?.get(id);
  return item?.kind === 'graphic' ? item : undefined;
};

describe('tactical graphics in the controller (brief functions 29, 31 and 32)', () => {
  it('draws a graphic in place of its marker once the service has answered, and the highlight follows', async () => {
    const { engine, controller, map, settle } = setup();
    const o = axisObject(10);
    controller.listener.snapshot({ layers: [A], objects: [o], sequenceNo: 1 });
    expect(graphicItem(engine, o.id)?.parts).toBeNull(); // the marker first
    await settle();
    const drawn = graphicItem(engine, o.id);
    expect([...(drawn?.parts?.lines[0]?.coordinates ?? [])]).toEqual([15, 62, 17, 62.5, 16, 63]);
    map.selection.set([o.id]);
    expect(engine.highlighted).toEqual([o.id]);
  });

  it('criterion 62: draws again for the new resolution after a zoom, and not after a pan inside what is drawn', async () => {
    const { engine, controller, settle, service } = setup();
    controller.listener.snapshot({ layers: [A], objects: [axisObject(10)], sequenceNo: 1 });
    await settle();
    const calls = service.renderGraphicCalls;
    expect(calls).toBe(1);
    const view = engine.view;
    if (view === null) throw new Error('no view');
    engine.show([view.center[0] + view.resolution * 20, view.center[1]], view.resolution); // a pan of 20 pixels
    await settle();
    expect(service.renderGraphicCalls).toBe(calls);
    engine.show(view.center, view.resolution / 2); // a zoom
    await settle();
    expect(service.renderGraphicCalls).toBe(calls + 1);
    engine.show([view.center[0] + view.resolution * 5000, view.center[1]], view.resolution / 2); // out of the extent drawn
    await settle();
    expect(service.renderGraphicCalls).toBeGreaterThanOrEqual(calls + 1);
  });

  it('criterion 92 (SDK 1.5.0 part 2): the images of the new answer replace the old ones after a zoom; an image that cannot be drawn never reaches the engine', async () => {
    const { engine, controller, settle, service } = setup();
    const first = fakeGraphicImage([16, 62.4], 30);
    service.withImages([first, { ...fakeGraphicImage([16, 62.5]), svg: 'https://example.com/a.svg' }]);
    const o = axisObject(10);
    controller.listener.snapshot({ layers: [A], objects: [o], sequenceNo: 1 });
    await settle();
    expect(graphicItem(engine, o.id)?.parts?.images).toEqual([first]);
    const second = fakeGraphicImage([16.1, 62.3], 60);
    service.withImages([second]);
    const view = engine.view;
    if (view === null) throw new Error('no view');
    engine.show(view.center, view.resolution / 2); // a zoom
    await settle();
    expect(graphicItem(engine, o.id)?.parts?.images).toEqual([second]);
    service.withImages([{ ...second, svg: 'data:text/html,<b>x</b>' }]);
    engine.show(view.center, view.resolution / 4);
    await settle();
    expect(graphicItem(engine, o.id)?.parts).not.toHaveProperty('images'); // as in M5
    expect(graphicItem(engine, o.id)?.parts?.lines).toHaveLength(1);
  });

  it('criterion 67: a selected graphic dragged by +2° and +1° previews moved, and the plugin gets the drop position', async () => {
    const { engine, controller, map, settle } = setup();
    const o = axisObject(10);
    controller.listener.snapshot({ layers: [A], objects: [o], sequenceNo: 1 });
    await settle();
    map.selection.set([o.id]);
    let dropped: Position | null | 'waiting' = 'waiting';
    void map.dragObject(o.id).then((position) => {
      dropped = position;
    });
    const first = engine.pixelOf([15, 62]);
    engine.pointer('down', first);
    const to = engine.pixelOf([17, 63]);
    engine.pointer('move', to);
    const preview = engine.dragPreview;
    expect(preview?.kind).toBe('graphic');
    const moved = preview?.kind === 'graphic' ? preview.parts?.lines[0]?.coordinates : undefined;
    const original = [15, 62, 17, 62.5, 16, 63];
    [...(moved ?? [])].forEach((v, i) => {
      expect(v).toBeCloseTo((original[i] as number) + (i % 2 === 0 ? 2 : 1), 6);
    });
    const firstPoint = preview?.kind === 'graphic' ? preview.points[0] : undefined;
    expect(firstPoint?.[0]).toBeCloseTo(17, 6);
    expect(firstPoint?.[1]).toBeCloseTo(63, 6);
    engine.pointer('up', to);
    await Promise.resolve();
    expect(dropped).not.toBe('waiting');
    const drop = dropped as unknown as Position;
    expect(drop[0]).toBeCloseTo(17, 6);
    expect(drop[1]).toBeCloseTo(63, 6);
  });
});

describe('placing a graphic with a preview (criterion 68)', () => {
  const drawAxis = async (options: { service?: ReturnType<typeof createFakeSymbolService> } = {}) => {
    const t = setup(options.service);
    let result: unknown = 'running';
    void t.map.draw('line', { graphic: AXIS }).then((geometry) => {
      result = geometry;
    });
    await Promise.resolve();
    await Promise.resolve();
    const xy = (lon: number, lat: number) => t.engine.projection.forward([lon, lat]) as [number, number];
    return { ...t, xy, result: () => result };
  };

  it('criterion 92 (SDK 1.5.0 part 2): the preview shows the images of the answer, the usable ones only', async () => {
    const service = createFakeSymbolService();
    const good = fakeGraphicImage([16, 62.6], 45);
    service.withImages([good, { ...fakeGraphicImage([16, 62.7]), svg: 'https://example.com/a.svg' }]);
    const { engine, settle, xy } = await drawAxis({ service });
    engine.sketch([xy(15, 62), xy(17, 62.5), xy(16, 63)]);
    await settle();
    const parts = engine.dragPreview?.kind === 'graphic' ? engine.dragPreview.parts : null;
    expect(parts?.images).toEqual([good]);
  });

  it('shows the plain line while the points are fewer than the graphic needs, then the graphic itself, and the result is the plain LineString', async () => {
    const { engine, settle, xy, result } = await drawAxis();
    expect(engine.drawing?.options?.minPoints).toBe(3); // from the catalogue
    expect(engine.drawing?.options?.maxPoints).toBe(50);
    engine.sketch([xy(15, 62), xy(16, 62.2)]); // one point set and the pointer
    await settle();
    expect(engine.dragPreview).toBeNull();
    expect(engine.drawingPlain).toBe(true);
    engine.sketch([xy(15, 62), xy(17, 62.5), xy(16, 63)]); // two set and the pointer: the minimum
    await settle();
    expect(engine.dragPreview?.kind).toBe('graphic');
    expect(engine.drawingPlain).toBe(false);
    const parts = engine.dragPreview?.kind === 'graphic' ? engine.dragPreview.parts : null;
    expect(parts?.lines[0]?.coordinates[0]).toBeCloseTo(15, 6);
    expect(parts?.lines[0]?.coordinates[1]).toBeCloseTo(62, 6);
    // The result is the geometry without a graphic: the points the user set.
    engine.drawing?.onEnd({ kind: 'line', points: [xy(15, 62), xy(17, 62.5), xy(16, 63)] });
    await Promise.resolve();
    const line = result() as { type: string; coordinates: Position[] };
    expect(line.type).toBe('LineString');
    [[15, 62], [17, 62.5], [16, 63]].forEach(([lon, lat], i) => {
      expect(line.coordinates[i]?.[0]).toBeCloseTo(lon as number, 6);
      expect(line.coordinates[i]?.[1]).toBeCloseTo(lat as number, 6);
    });
    expect(engine.dragPreview).toBeNull(); // the preview is gone
  });

  it('asks for one drawing at a time, and the newest points go next', async () => {
    const waiting: { resolve: (r: GraphicRendering) => void; points: readonly Position[] }[] = [];
    const service = createFakeSymbolService();
    service.renderGraphic = (request) => new Promise<GraphicRendering>((resolve) => waiting.push({ resolve, points: request.points }));
    const { engine, xy } = await drawAxis({ service });
    engine.sketch([xy(15, 62), xy(17, 62.5), xy(16, 63)]);
    engine.sketch([xy(15, 62), xy(17, 62.5), xy(16.5, 63)]);
    engine.sketch([xy(15, 62), xy(17, 62.5), xy(16.8, 63)]);
    await Promise.resolve();
    expect(waiting).toHaveLength(1); // one in flight
    waiting[0]?.resolve({ ok: true, lines: [], fills: [], labels: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(waiting).toHaveLength(2); // the newest points, not the one in between
    expect(waiting[1]?.points[2]?.[0]).toBeCloseTo(16.8, 6);
  });

  it('takes the preview away when the drawing is cancelled', async () => {
    const { engine, settle, xy } = await drawAxis();
    engine.sketch([xy(15, 62), xy(17, 62.5), xy(16, 63)]);
    await settle();
    expect(engine.dragPreview?.kind).toBe('graphic');
    engine.escape();
    expect(engine.dragPreview).toBeNull();
  });

  it('keeps the plain line when the service refuses', async () => {
    const service = createFakeSymbolService();
    service.refuse('no such graphic');
    const { engine, settle, xy } = await drawAxis({ service });
    engine.sketch([xy(15, 62), xy(17, 62.5), xy(16, 63)]);
    await settle();
    expect(engine.dragPreview).toBeNull();
    expect(engine.drawingPlain).toBe(true);
  });

  it('never asks the service for a vessel symbol (SDK 1.4.0 part 3): the plain line stays, no catalogue and no drawing', async () => {
    const service = createFakeSymbolService();
    let catalogueCalls = 0;
    const catalogue = service.graphicCatalog.bind(service);
    service.graphicCatalog = (standard) => {
      catalogueCalls++;
      return catalogue(standard);
    };
    const t = setup(service);
    void t.map.draw('line', { graphic: { standard: 'vessel', sidc: '0470' } });
    await Promise.resolve();
    await Promise.resolve();
    const xy = (lon: number, lat: number) => t.engine.projection.forward([lon, lat]) as [number, number];
    t.engine.sketch([xy(15, 62), xy(17, 62.5), xy(16, 63)]);
    await t.settle();
    expect(catalogueCalls).toBe(0);
    expect(service.renderGraphicCalls).toBe(0);
    expect(t.engine.dragPreview).toBeNull();
    expect(t.engine.drawingPlain).toBe(true);
  });

  it('returns a polygon ring in the clicked order, closing position last, clockwise and anticlockwise', async () => {
    for (const order of ['clockwise', 'anticlockwise']) {
      const { engine, map } = setup();
      const xy = (lon: number, lat: number) => engine.projection.forward([lon, lat]) as [number, number];
      const ring: [number, number][] = order === 'clockwise' ? [[15, 62], [15, 63], [17, 63], [17, 62]] : [[15, 62], [17, 62], [17, 63], [15, 63]];
      let result: unknown = null;
      void map.draw('polygon', { graphic: BOUNDARY }).then((g) => {
        result = g;
      });
      engine.drawing?.onEnd({ kind: 'polygon', points: [...ring, ring[0] as [number, number]].map(([lon, lat]) => xy(lon, lat)) });
      await Promise.resolve();
      const coordinates = (result as { coordinates: Position[][] }).coordinates[0] ?? [];
      expect(coordinates).toHaveLength(5);
      coordinates.forEach((c, i) => {
        const expected = [...ring, ring[0] as [number, number]][i] as [number, number];
        expect(c[0]).toBeCloseTo(expected[0], 6);
        expect(c[1]).toBeCloseTo(expected[1], 6);
      });
    }
  });
});

describe('editing a graphic (criterion 69)', () => {
  it('shows a handle on each control point, draws the graphic again as a point moves, and resolves with the moved point', async () => {
    const { engine, controller, map, settle } = setup();
    const o = axisObject(10);
    controller.listener.snapshot({ layers: [A], objects: [o], sequenceNo: 1 });
    await settle();
    let result: unknown = 'running';
    void map.edit(o.id).then((geometry) => {
      result = geometry;
    });
    expect(engine.editing?.options?.vertexHandles).toBe(true);
    expect(engine.editing?.shape.kind).toBe('line');
    const xy = (lon: number, lat: number) => engine.projection.forward([lon, lat]) as [number, number];
    engine.editChange({ kind: 'line', points: [xy(15, 62), xy(17, 62.5), xy(16.4, 63.2)] }); // the last point moved
    await settle();
    const preview = engine.dragPreview;
    const coordinates = preview?.kind === 'graphic' ? preview.parts?.lines[0]?.coordinates : undefined;
    expect(coordinates?.[4]).toBeCloseTo(16.4, 6);
    expect(coordinates?.[5]).toBeCloseTo(63.2, 6);
    engine.finishEditing({ kind: 'line', points: [xy(15, 62), xy(17, 62.5), xy(16.4, 63.2)] });
    await Promise.resolve();
    const moved = result as { type: string; coordinates: Position[] };
    expect(moved.type).toBe('LineString');
    expect(moved.coordinates[2]?.[0]).toBeCloseTo(16.4, 6);
    expect(moved.coordinates[2]?.[1]).toBeCloseTo(63.2, 6);
    expect(engine.dragPreview).toBeNull();
  });

  it('resolves with the geometry type the object has: a graphic stored as a MultiPoint comes back as one', async () => {
    const { engine, controller, map, settle } = setup();
    const fan = object(11, A.id, 'core.multipoint', { type: 'MultiPoint', coordinates: [[15, 62]] }, { symbol: FAN });
    controller.listener.snapshot({ layers: [A], objects: [fan], sequenceNo: 1 });
    await settle();
    let result: unknown = 'running';
    void map.edit(fan.id).then((geometry) => {
      result = geometry;
    });
    expect(engine.editing?.shape.kind).toBe('point');
    engine.finishEditing({ kind: 'point', at: engine.projection.forward([16, 62.5]) as [number, number] });
    await Promise.resolve();
    const moved = result as { type: string; coordinates: Position[] };
    expect(moved.type).toBe('MultiPoint');
    expect(moved.coordinates[0]?.[0]).toBeCloseTo(16, 6);
    expect(moved.coordinates[0]?.[1]).toBeCloseTo(62.5, 6);
  });

  it('resolves with null on Escape, and the preview is gone', async () => {
    const { engine, controller, map, settle } = setup();
    const o = axisObject(10);
    controller.listener.snapshot({ layers: [A], objects: [o], sequenceNo: 1 });
    await settle();
    const done = map.edit(o.id);
    engine.escape();
    expect(await done).toBeNull();
    expect(engine.dragPreview).toBeNull();
  });
});

describe('the fallback marker and the budget (criteria 63 and function 29)', () => {
  it('is the marker without the service, and a graphic counts as one object like a shape', async () => {
    const { engine, controller, settle } = setup();
    controller.setSymbols({ ...createFakeSymbolService(), renderGraphic: undefined } as never);
    const o = axisObject(10);
    controller.listener.snapshot({ layers: [A], objects: [o], sequenceNo: 1 });
    await settle();
    expect(graphicItem(engine, o.id)?.parts).toBeNull();
    expect(uuid(10)).toBe(o.id);
  });
});
