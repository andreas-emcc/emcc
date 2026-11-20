import { describe, expect, it, vi } from 'vitest';
import type { BackgroundMapProvider, Cluster, ClusterUpdate, DataType, DataTypeDefaults, MapObject, OverlayItem, SteppedFade, Pixel, Position, RenderingMode, VectorSource, WmsSource } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeVectorBackground } from '@emc2/plugin-sdk/testing';
import { jsonBytes, MAX_SETUP_SHARE_BYTES, NotALineError, NotOnMapError, OVERLAY_MAX_ITEMS, DEFAULT_DISPLAY } from '@emc2/plugin-sdk';
import type { BackgroundChoices, ChoiceStore } from '../../src/core/background.ts';
import { CLUSTER_CLICK_GRACE_MS, CLUSTER_ZOOM_FACTOR } from '../../src/core/clusters.ts';
import type { DrawnShape } from '../../src/core/drawing.ts';
import { initialView, MapController, translated } from '../../src/core/controller.ts';
import type { DrawItem } from '../../src/core/drawData.ts';
import { destination, distance } from '../../src/core/geodesic.ts';
import { registerProjections } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS, type ProjectionDef } from '../../src/core/settings.ts';
import { viewIn } from '../../src/core/viewport.ts';
import { FakeEngine } from '../fakeEngine.ts';
import { itemOpacity } from '../../src/core/expiry.ts';
import { cotDataType, cotObject, event, FakeClock, INFANTRY, layer, object, symbolObject, textbook, uuid, WALL_START } from '../fixtures.ts';

const ORIGIN = 'http://127.0.0.1:8080';

function setup(options: { extraProjections?: readonly ProjectionDef[]; mode?: RenderingMode; budget?: number; mounted?: boolean; choices?: ChoiceStore; dataTypes?: readonly DataType[]; setupChanged?: () => void } = {}) {
  const { projections } = registerProjections([...DEFAULT_SETTINGS.projections, ...(options.extraProjections ?? [])]);
  const settings = { ...DEFAULT_SETTINGS, softwareBudget: options.budget ?? DEFAULT_SETTINGS.softwareBudget };
  const start = initialView(settings, projections);
  if (start === null) throw new Error('no initial view');
  const engine = new FakeEngine(start.projection);
  if (options.mounted !== false) engine.show(start.center, start.resolution);
  const clock = new FakeClock();
  const ctx = createFakeContext({ pluginId: 'map-view-2d' });
  const controller = new MapController({
    display: DEFAULT_DISPLAY,
    engine, settings, projections, clock, origin: ORIGIN, log: ctx.log,
    notify: (notification) => {
      ctx.notify(notification);
    },
    objects: ctx.objects,
    openMenu: (at, target) => {
      ctx.actions.openMenu(at, target);
    },
    rendering: { mode: options.mode ?? 'hardware', renderer: 'Test GPU' },
    ...(options.choices === undefined ? {} : { choices: options.choices }),
    ...(options.dataTypes === undefined ? {} : { dataTypes: options.dataTypes }),
    ...(options.setupChanged === undefined ? {} : { setupChanged: options.setupChanged }),
  });
  return { engine, clock, controller, map: controller.service, ctx };
}

const A = layer(1, 10);
const B = layer(2, 20);

function provider(id: string, projections: readonly string[], url = `/api/plugins/${id}/tiles/{z}/{x}/{y}.png`): BackgroundMapProvider {
  return { id, name: id, projections, source: { type: 'xyz', url, minZoom: 0, maxZoom: 19, tileSize: 256 }, attribution: { text: `© ${id}` } };
}

describe('map controller: live picture (brief functions 4 and 5)', () => {
  it('draws a snapshot: one map layer per emc2 layer in drawOrder, with its objects', () => {
    const { engine, controller } = setup();
    controller.listener.snapshot({ layers: [B, A], objects: [symbolObject(10, A.id, 15, 60), symbolObject(11, B.id, 16, 61)], sequenceNo: 1 });
    expect(engine.layers).toEqual([{ id: A.id, stack: 0, visible: true }, { id: B.id, stack: 1, visible: true }]);
    expect(engine.idsIn(A.id)).toEqual([uuid(10)]);
    expect(engine.idsIn(B.id)).toEqual([uuid(11)]);
  });

  it('a second snapshot replaces everything', () => {
    const { engine, controller } = setup();
    controller.listener.snapshot({ layers: [A, B], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    controller.listener.snapshot({ layers: [B], objects: [symbolObject(20, B.id, 15, 60)], sequenceNo: 50 });
    expect(engine.layers.map((l) => l.id)).toEqual([B.id]);
    expect(engine.idsIn(B.id)).toEqual([uuid(20)]);
    expect(engine.items.has(A.id)).toBe(false);
  });

  it('criterion 2: a single change is drawn at once, without waiting for the cadence', () => {
    const { engine, clock, controller } = setup();
    controller.listener.snapshot({ layers: [A], objects: [], sequenceNo: 1 });
    clock.advance(10_000);
    controller.listener.changes([event(2, symbolObject(10, A.id, 15, 60))]);
    clock.advance(0);
    expect(engine.idsIn(A.id)).toEqual([uuid(10)]);
  });

  it('criterion 9: a stream of changes is applied once per cadence, merged per object (latest wins)', () => {
    const { engine, clock, controller } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    let seq = 2;
    for (let ms = 0; ms < 3000; ms++) {
      controller.listener.changes([event(seq++, { ...symbolObject(10, A.id, 15 + ms / 1000, 60), version: seq })]);
      clock.advance(1);
    }
    clock.advance(1000);
    expect(engine.calls.updateItems).toBe(4); // at 0, 1000, 2000 and 3000 ms: never per change
    const drawn = engine.items.get(A.id)?.get(uuid(10));
    expect(drawn?.kind === 'symbol' ? drawn.position : null).toEqual([15 + 2999 / 1000, 60]);
  });

  it('criterion 5: changing a layer drawOrder reorders the map without reload', () => {
    const { engine, controller } = setup();
    controller.listener.snapshot({ layers: [A, B], objects: [], sequenceNo: 1 });
    controller.listener.changes([event(2, { ...A, drawOrder: 30, version: 2 })]);
    expect(engine.layers.map((l) => l.id)).toEqual([B.id, A.id]);
  });

  it('criterion 10: draws objects whose layer is not in the live picture, on top', () => {
    const { engine, clock, controller } = setup();
    const lost = uuid(99);
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, lost, 15, 60)], sequenceNo: 1 });
    expect(engine.layers.map((l) => l.id)).toEqual([A.id, lost]);
    expect(engine.idsIn(lost)).toEqual([uuid(10)]);
    controller.listener.changes([event(2, symbolObject(11, uuid(98), 15, 60))]);
    clock.advance(0);
    expect(engine.layers.map((l) => l.id)).toEqual([A.id, uuid(98), lost]);
    expect(engine.idsIn(uuid(98))).toEqual([uuid(11)]);
  });

  it('criterion 10: draws objects of unknown types as fallback markers, never drops them', () => {
    const { engine, controller } = setup();
    controller.listener.snapshot({ layers: [A], objects: [object(10, A.id, 'cot.track', { type: 'Point', coordinates: [15, 60] })], sequenceNo: 1 });
    expect(engine.items.get(A.id)?.get(uuid(10))?.kind).toBe('fallback');
  });

  it('moves an object between layers and removes deleted objects', () => {
    const { engine, clock, controller } = setup();
    controller.listener.snapshot({ layers: [A, B], objects: [symbolObject(10, A.id, 15, 60), symbolObject(11, A.id, 15, 60)], sequenceNo: 1 });
    controller.listener.changes([event(2, symbolObject(10, B.id, 15, 60)), event(3, null, { id: uuid(11), type: 'object' })]);
    clock.advance(0);
    expect(engine.idsIn(A.id)).toEqual([]);
    expect(engine.idsIn(B.id)).toEqual([uuid(10)]);
  });
});

function wms(id: string, projections: readonly string[] | 'any', overrides: Partial<WmsSource> = {}): BackgroundMapProvider {
  return {
    id, name: id, projections, attribution: { text: `© ${id}` },
    source: { type: 'wms', url: `/api/plugins/basemap-wms/map/${id}`, layers: ['relief'], version: '1.3.0', format: 'image/png', ...overrides },
  };
}

describe('map controller: WMS backgrounds (brief function 3, criteria 55 and 58)', () => {
  it('offers a wms background in the projections it lists and draws it there, and only there', () => {
    const { engine, controller, map } = setup();
    const topo = wms('topo', ['EPSG:3857', 'EPSG:3413']);
    controller.setProviders([topo]);
    expect(map.mapType).toEqual({ projection: 'EPSG:3857', background: 'topo' });
    expect(engine.backgroundShown).toEqual({ kind: 'tiles', provider: topo });
    controller.setProjection('EPSG:3413'); // around the pole
    expect(map.mapType).toEqual({ projection: 'EPSG:3413', background: 'topo' });
    expect(engine.backgroundShown).toEqual({ kind: 'tiles', provider: topo });
    controller.setProjection('EPSG:3031'); // not listed: not offered, and not drawn in another projection
    expect(controller.backgrounds).toEqual([]);
    expect(map.mapType).toEqual({ projection: 'EPSG:3031', background: null });
    expect(engine.backgroundShown).toBeNull();
  });

  it('does not offer one with a URL on another host, no layers or any projection, and says why once', () => {
    const { controller, ctx } = setup();
    controller.setProviders([
      wms('far', ['EPSG:3857'], { url: 'https://wms.example/ows' }),
      wms('bare', ['EPSG:3857'], { layers: [] }),
      wms('all', 'any'),
    ]);
    controller.setProviders([wms('far', ['EPSG:3857'], { url: 'https://wms.example/ows' }), wms('bare', ['EPSG:3857'], { layers: [] }), wms('all', 'any')]);
    expect(controller.backgrounds).toEqual([]);
    expect(ctx.logs.filter((l) => l.level === 'warn').map((l) => l.message)).toEqual([
      'background map far is not used: the wms URL must point to the emc2 server',
      'background map bare is not used: a wms source needs at least one layer name',
      'background map all is not used: a wms source needs a list of projections, not any',
    ]);
  });

  it('falls back to another background when the shown one is removed, and says so (criterion 59)', () => {
    const { engine, controller, map, ctx } = setup();
    const topo = wms('topo', ['EPSG:3857']);
    const osm = provider('basemap-osm', ['EPSG:3857']);
    controller.setProviders([topo, osm]);
    controller.chooseBackground('topo');
    expect(map.mapType.background).toBe('topo');
    expect(ctx.notifications).toHaveLength(0);
    controller.setProviders([osm]); // the plugin removed it (the Unsubscribe of services.provide)
    expect(map.mapType.background).toBe('basemap-osm');
    expect(engine.backgroundShown).toEqual({ kind: 'tiles', provider: osm });
    expect(ctx.notifications.at(-1)).toEqual({ severity: 'warning', message: 'The background map topo is not available; showing basemap-osm.' });
    controller.setProviders([]); // and the last one: the grid
    expect(ctx.notifications.at(-1)?.message).toBe('The background map basemap-osm is not available; showing the grid.');
    expect(engine.backgroundShown).toBeNull();
  });

  it('says nothing when a background that is not shown is removed, or when the providers only change', () => {
    const { controller, ctx } = setup();
    const topo = wms('topo', ['EPSG:3857']);
    const osm = provider('basemap-osm', ['EPSG:3857']);
    controller.setProviders([topo, osm]); // topo is shown (the first)
    controller.setProviders([topo]); // osm goes
    controller.setProviders([topo, wms('other', ['EPSG:3857'])]);
    expect(ctx.notifications).toHaveLength(0);
  });

  it('offers a wms background in a projection whose extent cannot be cut into tiles inside of only as a single image', () => {
    const mercator = DEFAULT_SETTINGS.projections[0] as ProjectionDef;
    const odd: ProjectionDef = { ...mercator, code: 'EPSG:9990', extent: [-30_000_000, -20_000_000, 30_000_000, 20_000_000] }; // 3 to 2
    const { controller } = setup({ extraProjections: [odd] });
    const tiles = wms('tiles', ['EPSG:9990']);
    const single = wms('single', ['EPSG:9990'], { mode: 'image' });
    controller.setProviders([tiles, single]);
    controller.setProjection('EPSG:9990');
    expect(controller.backgrounds.map((p) => p.id)).toEqual(['single']);
  });
});

describe('map controller: map type and layer visibility events (SDK 1.1.0, brief function 20)', () => {
  const osm = provider('basemap-osm', ['EPSG:3857']);
  const polar = provider('basemap-polar', ['EPSG:3413']);

  it("mapType is the projection and the background shown; onMapTypeChange hears every change, also the map's own fallback", () => {
    const { controller, map } = setup();
    controller.setProviders([osm, polar]);
    const heard: unknown[] = [];
    const stop = map.onMapTypeChange((mapType) => heard.push(mapType));
    expect(map.mapType).toEqual({ projection: 'EPSG:3857', background: 'basemap-osm' });
    controller.setProjection('EPSG:3413'); // OSM does not fit: the map takes the polar background
    controller.chooseBackground(null);
    stop();
    controller.setProjection('EPSG:3857');
    expect(heard).toEqual([{ projection: 'EPSG:3413', background: 'basemap-polar' }, { projection: 'EPSG:3413', background: null }]);
  });

  it('setMapType switches projection and background, returns what it applied, and is heard once (review finding 3, part F1)', () => {
    const { engine, controller, map, ctx } = setup();
    controller.setProviders([osm, polar, provider('basemap-polar-2', ['EPSG:3413'])]);
    const heard: unknown[] = [];
    map.onMapTypeChange((mapType) => heard.push(mapType));
    expect(map.setMapType({ projection: 'EPSG:3413', background: 'basemap-polar-2' })).toEqual({ projection: 'EPSG:3413', background: 'basemap-polar-2' });
    expect(heard).toEqual([{ projection: 'EPSG:3413', background: 'basemap-polar-2' }]); // not the fallback in between
    expect(map.setMapType({ projection: 'EPSG:3413', background: 'basemap-polar' })).toEqual({ projection: 'EPSG:3413', background: 'basemap-polar' });
    expect(engine.projection.def.code).toBe('EPSG:3413');
    expect(ctx.notifications).toHaveLength(0);
  });

  it('setMapType with a projection or background that is not available falls back as the map does, with a notice', () => {
    const { engine, controller, map, ctx } = setup();
    controller.setProviders([osm, polar]);
    expect(map.setMapType({ projection: 'EPSG:9999', background: 'basemap-osm' })).toEqual({ projection: 'EPSG:3857', background: 'basemap-osm' });
    expect(ctx.notifications.at(-1)?.message).toBe('The map projection EPSG:9999 is not available; the map stays in EPSG:3857.');
    expect(map.setMapType({ projection: 'EPSG:3413', background: 'basemap-gone' })).toEqual({ projection: 'EPSG:3413', background: 'basemap-polar' });
    expect(ctx.notifications.at(-1)?.message).toBe('The background map basemap-gone is not available; showing basemap-polar.');
    expect(engine.projection.def.code).toBe('EPSG:3413');
    expect(map.setMapType(null as never)).toEqual({ projection: 'EPSG:3413', background: 'basemap-polar' }); // not a map type: ignored
  });

  it("onLayerVisibilityChange hears a local change of a layer's visibility, only when it changes", () => {
    const { controller, map } = setup();
    const hidden = { ...B, visible: false };
    controller.listener.snapshot({ layers: [A, hidden], objects: [], sequenceNo: 1 });
    const heard: unknown[] = [];
    map.onLayerVisibilityChange((layerId, visible) => heard.push([layerId, visible]));
    map.setLayerVisible(A.id, false);
    map.setLayerVisible(A.id, false);
    map.setLayerVisible(A.id, true);
    map.setLayerVisible(hidden.id, false); // as its own field says: nothing changes
    expect(heard).toEqual([[A.id, false], [A.id, true]]);
  });
});

describe('map controller: dim (brief function 19)', () => {
  it('criterion 37: the level moves in steps of 10 % up to the highest level and dims through the engine; objects are not involved', () => {
    const { engine, controller } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    const items = engine.idsIn(A.id);
    controller.setDim(34);
    expect(controller.dimLevel).toBe(30);
    expect(engine.dim).toBeCloseTo(0.3, 9);
    controller.setDim(150);
    expect(controller.dimLevel).toBe(90);
    controller.setDim(-5);
    expect(engine.dim).toBe(0);
    expect(engine.idsIn(A.id)).toEqual(items);
  });

  it('a lower highest level in the settings takes the level down at once', () => {
    const { engine, controller } = setup();
    controller.setDim(80);
    const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
    controller.setSettings({ ...DEFAULT_SETTINGS, highestDim: 50 }, projections);
    expect(controller.dimLevel).toBe(50);
    expect(engine.dim).toBeCloseTo(0.5, 9);
  });
});

describe('map controller: its share of the setup (brief function 20)', () => {
  const osm = provider('basemap-osm', ['EPSG:3857']);
  const polar = provider('basemap-polar', ['EPSG:3413']);
  const C = layer(3, 30);

  function shared(setupChanged?: () => void) {
    const s = setup(setupChanged === undefined ? {} : { setupChanged });
    s.controller.setProviders([osm, polar]);
    s.controller.listener.snapshot({ layers: [A, B, { ...C, visible: false }], objects: [], sequenceNo: 1 });
    return s;
  }

  it('criterion 38: saves projection, background, centre, zoom, dim and the layers whose visibility is not their own, and a second map restores all of it', () => {
    const first = shared();
    first.map.setMapType({ projection: 'EPSG:3413', background: 'basemap-polar' });
    first.map.goTo([-40, 75], 1_500);
    first.controller.setDim(60);
    first.map.setLayerVisible(A.id, false);
    first.map.setLayerVisible(B.id, true); // as its own field: not saved
    first.map.setLayerVisible(C.id, true);
    const share = first.controller.saveShare();
    expect(share).toMatchObject({ v: 1, projection: 'EPSG:3413', background: 'basemap-polar', dim: 60, layers: { [A.id]: false, [C.id]: true } });
    expect(Object.keys((share as { layers: object }).layers)).toHaveLength(2);

    const second = shared();
    expect(second.controller.restoreShare(share)).toBe(true);
    expect(second.map.mapType).toEqual({ projection: 'EPSG:3413', background: 'basemap-polar' });
    expect(second.map.viewport.center[0]).toBeCloseTo(-40, 6);
    expect(second.map.viewport.center[1]).toBeCloseTo(75, 6);
    expect(second.map.viewport.resolution).toBeCloseTo(1_500, 3);
    expect(second.controller.dimLevel).toBe(60);
    expect([A, B, C].map((l) => second.map.isLayerVisible(l.id))).toEqual([false, true, true]);
  });

  // Values that do not survive the round trip through the projection (ITA, 2026-10-19).
  const mercatorShare = { v: 1, projection: 'EPSG:3857', background: 'basemap-osm', center: [15.123456789012344, 60.98765432101234], metresPerPixel: 2294.0739775488755, dim: 60, layers: { [A.id]: false } };
  const polarShare = { v: 1, projection: 'EPSG:3413', background: 'basemap-polar', center: [-40.12345678901234, 75.98765432101234], metresPerPixel: 1500.0000000000002, dim: 0, layers: {} };

  it('criterion 38: a restored share reads back as the same text while the view has not changed, also after a resize (ITA, 2026-10-19)', () => {
    for (const share of [mercatorShare, polarShare]) {
      const { controller, engine } = shared();
      controller.restoreShare(share);
      expect(JSON.stringify(controller.saveShare())).toBe(JSON.stringify(share));
      const view = engine.view;
      if (view === null) throw new Error('no view');
      engine.show(view.center, view.resolution, 1024, 768);
      expect(JSON.stringify(controller.saveShare())).toBe(JSON.stringify(share));
    }
  });

  it('criterion 38: once the view moves, the share follows it, also when it comes back', () => {
    const { controller, engine, map } = shared();
    controller.restoreShare(mercatorShare);
    const view = engine.view;
    if (view === null) throw new Error('no view');
    engine.setView([view.center[0] + 100 * view.resolution, view.center[1]]); // a pan of 100 pixels
    const panned = controller.saveShare() as { center: [number, number] };
    expect(panned.center).toEqual([map.viewport.center[0], map.viewport.center[1]]);
    expect(panned.center[0]).toBeGreaterThan(16); // about 4° east of the stored 15.12
    engine.setView(view.center, view.resolution);
    expect(controller.saveShare()).toMatchObject({ center: [map.viewport.center[0], map.viewport.center[1]], metresPerPixel: map.viewport.resolution });
  });

  it('criterion 38: restored before the map has a size, the share keeps the stored view, also when the size comes at that view', () => {
    const { controller, engine } = setup({ mounted: false });
    controller.restoreShare(mercatorShare);
    expect(controller.saveShare()).toMatchObject({ center: mercatorShare.center, metresPerPixel: mercatorShare.metresPerPixel });
    const [lon = 0, lat = 0] = mercatorShare.center;
    const asked = viewIn(engine.projection, [lon, lat], mercatorShare.metresPerPixel);
    engine.show(asked.center, asked.resolution); // OpenLayers keeps the view it was given until it has a size
    expect(controller.saveShare()).toMatchObject({ center: mercatorShare.center, metresPerPixel: mercatorShare.metresPerPixel });
  });

  it('criterion 38: a projection switch after the restore gives the view it shows, with a size and before it has one (review finding 1)', () => {
    for (const mounted of [true, false]) {
      const { controller, map } = setup({ mounted });
      controller.restoreShare(mercatorShare);
      map.setMapType({ projection: 'EPSG:3413', background: null });
      const share = controller.saveShare() as { projection: string; center: [number, number]; metresPerPixel: number };
      expect(share.projection).toBe('EPSG:3413');
      expect(share.center).toEqual([map.viewport.center[0], map.viewport.center[1]]);
      expect(share.center).not.toEqual(mercatorShare.center);
    }
  });

  it('criterion 38: Centre on or goTo before the map has a size give the view asked for, not the stored one (review finding 1)', async () => {
    const { controller, map } = setup({ mounted: false });
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 18, 62)], sequenceNo: 1 });
    controller.restoreShare(mercatorShare);
    map.goTo([16, 61], 3_000);
    expect(controller.saveShare()).toMatchObject({ center: [map.viewport.center[0], map.viewport.center[1]] });
    expect((controller.saveShare() as { metresPerPixel: number }).metresPerPixel).not.toBe(mercatorShare.metresPerPixel);
    controller.restoreShare(mercatorShare);
    await map.centreOn([uuid(10)]);
    expect((controller.saveShare() as { center: number[] }).center[0]).toBeCloseTo(18, 6);
  });

  it('criterion 38: a goTo to another position that the projection clamps to the same point gives where the map went (review finding 1)', () => {
    const { controller, map } = shared();
    controller.restoreShare({ ...polarShare, center: [15, 10] });
    map.goTo([15, 5]); // also south of what EPSG:3413 shows: the same clamped view
    const share = controller.saveShare() as { center: [number, number] };
    expect(share.center).toEqual([map.viewport.center[0], map.viewport.center[1]]);
    expect(share.center[1]).toBeGreaterThan(30);
  });

  it('criterion 38: a stored centre beyond what the projection shows stays in the share until the map moves (owner, 2026-10-19)', () => {
    const { controller, map } = shared();
    const share = { ...polarShare, center: [15, 10] };
    controller.restoreShare(share);
    expect(map.viewport.center[1]).toBeGreaterThan(30);
    expect(JSON.stringify(controller.saveShare())).toBe(JSON.stringify(share));
  });

  it('criterion 38: a layer deleted since is ignored, a layer the share does not name keeps its own field, and the layer panel hears every change', () => {
    const { controller, map } = shared();
    map.setLayerVisible(B.id, false); // to be undone by the restore: B is not in the share
    const heard: unknown[] = [];
    map.onLayerVisibilityChange((layerId, visible) => heard.push([layerId, visible]));
    const share = { v: 1, projection: 'EPSG:3857', background: 'basemap-osm', center: [15, 60], metresPerPixel: 2_000, dim: 0, layers: { [A.id]: false, [uuid(77)]: false } };
    expect(controller.restoreShare(share)).toBe(true);
    expect(map.isLayerVisible(A.id)).toBe(false);
    expect(map.isLayerVisible(B.id)).toBe(true);
    expect(heard).toEqual(expect.arrayContaining([[A.id, false], [B.id, true]]));
    expect(heard).toHaveLength(2);
    expect(controller.saveShare()).toMatchObject({ layers: { [A.id]: false } });
    expect(Object.keys((controller.saveShare() as { layers: object }).layers)).toEqual([A.id]);
  });

  it('criterion 38: restored before the first snapshot, the layers are kept until it comes, also in a save meanwhile; those it does not have are forgotten', () => {
    const { controller, map } = setup();
    controller.restoreShare({ v: 1, projection: 'EPSG:3857', background: null, center: [15, 60], metresPerPixel: 2_000, dim: 0, layers: { [A.id]: false, [uuid(77)]: true } });
    // The restore moves the map, so the shell may save before the snapshot (review finding 1, part F1).
    expect(controller.saveShare()).toMatchObject({ layers: { [A.id]: false, [uuid(77)]: true } });
    controller.listener.snapshot({ layers: [A], objects: [], sequenceNo: 1 });
    expect(map.isLayerVisible(A.id)).toBe(false);
    expect(Object.keys((controller.saveShare() as { layers: object }).layers)).toEqual([A.id]);
  });

  it('keeps a layer only objects name in a save (review finding 1, part F1)', () => {
    const { controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, uuid(88), 15, 60)], sequenceNo: 1 });
    map.setLayerVisible(uuid(88), false);
    expect(controller.saveShare()).toMatchObject({ layers: { [uuid(88)]: false } });
  });

  it("the user's own choice of background or projection ends the wait for a restored background: no notice, and the share keeps the choice (review finding 2, part F1)", () => {
    const { controller, map, clock, ctx } = setup();
    controller.setProviders([polar]);
    controller.restoreShare({ v: 1, projection: 'EPSG:3857', background: 'basemap-osm', center: [15, 60], metresPerPixel: 2_000, dim: 0, layers: {} });
    controller.chooseBackground(null);
    expect(controller.saveShare()).toMatchObject({ background: null });
    controller.restoreShare({ v: 1, projection: 'EPSG:3857', background: 'basemap-osm', center: [15, 60], metresPerPixel: 2_000, dim: 0, layers: {} });
    controller.setProjection('EPSG:3413');
    expect(controller.saveShare()).toMatchObject({ projection: 'EPSG:3413', background: 'basemap-polar' });
    clock.advance(20_000);
    expect(ctx.notifications).toHaveLength(0);
    expect(map.mapType).toEqual({ projection: 'EPSG:3413', background: 'basemap-polar' });
  });

  it('closing the map during the wait gives no notice later', () => {
    const { controller, clock, ctx } = setup();
    controller.restoreShare({ v: 1, projection: 'EPSG:3857', background: 'basemap-osm', center: [15, 60], metresPerPixel: 2_000, dim: 0, layers: {} });
    controller.dispose();
    clock.advance(20_000);
    expect(ctx.notifications).toHaveLength(0);
  });

  it('waits for a background whose plugin has not started yet; only if it is still missing 10 s later the notice says so (owner, 2026-10-17)', () => {
    const { controller, map, clock, ctx } = setup();
    controller.setProviders([polar]);
    controller.restoreShare({ v: 1, projection: 'EPSG:3857', background: 'basemap-osm', center: [15, 60], metresPerPixel: 2_000, dim: 0, layers: {} });
    expect(map.mapType.background).toBeNull();
    expect(controller.saveShare()).toMatchObject({ background: 'basemap-osm' }); // what the user had, not the fallback
    clock.advance(5_000);
    controller.setProviders([polar, osm]);
    expect(map.mapType.background).toBe('basemap-osm');
    clock.advance(10_000);
    expect(ctx.notifications).toHaveLength(0);
    // Still missing after the wait: the notice.
    controller.restoreShare({ v: 1, projection: 'EPSG:3857', background: 'basemap-gone', center: [15, 60], metresPerPixel: 2_000, dim: 0, layers: {} });
    clock.advance(9_999);
    expect(ctx.notifications).toHaveLength(0);
    clock.advance(1);
    expect(ctx.notifications.at(-1)?.message).toBe('The background map basemap-gone is not available; showing basemap-osm.');
  });

  it('ignores a share it cannot read and keeps its state; the share stays well under the 64 KiB a share may have', () => {
    const { controller, map, ctx } = shared();
    const good = { v: 1, projection: 'EPSG:3413', background: null, center: [15, 60], metresPerPixel: 1_000, dim: 0, layers: {} };
    for (const bad of [null, 'x', { ...good, v: 2 }, { ...good, center: [200, 0] }, { ...good, metresPerPixel: 0 }, { ...good, layers: { [A.id]: 'no' } }]) {
      expect(controller.restoreShare(bad)).toBe(false);
    }
    expect(map.mapType.projection).toBe('EPSG:3857');
    expect(ctx.logs.some((l) => l.level === 'warn' && l.message === 'the saved setup could not be read; the map keeps its current state')).toBe(true);
    for (let i = 0; i < 600; i++) controller.listener.changes([event(10 + i, layer(1000 + i, i))]);
    for (let i = 0; i < 600; i++) map.setLayerVisible(layer(1000 + i, i).id, false);
    expect(jsonBytes(controller.saveShare())).toBeLessThan(MAX_SETUP_SHARE_BYTES);
    expect(Object.keys((controller.saveShare() as { layers: object }).layers)).toHaveLength(500);
  }, 20_000); // 600 layers, each redrawn on every eye: 2 to 4 s alone, more under the full run's load

  it("tells the shell when its share changed: a move, the map type, the dim level, a layer's visibility", () => {
    const changed = vi.fn();
    const { engine, controller, map } = shared(changed);
    map.goTo([16, 61]);
    engine.setView(engine.view?.center ?? [0, 0]); // the move ends
    const afterMove = changed.mock.calls.length;
    controller.setDim(20);
    map.setLayerVisible(A.id, false);
    map.setMapType({ projection: 'EPSG:3413', background: 'basemap-polar' });
    expect(afterMove).toBeGreaterThan(0);
    expect(changed.mock.calls.length).toBeGreaterThanOrEqual(afterMove + 3);
  });
});

describe('map controller: local layer visibility (brief function 7, criterion 5)', () => {
  it('starts from the layer visible field and changes only this browser', () => {
    const { engine, controller, map, ctx } = setup();
    const hidden = layer(3, 5, false);
    controller.listener.snapshot({ layers: [A, hidden], objects: [], sequenceNo: 1 });
    expect(map.isLayerVisible(hidden.id)).toBe(false);
    expect(map.isLayerVisible(A.id)).toBe(true);
    map.setLayerVisible(A.id, false);
    expect(engine.layers.find((l) => l.id === A.id)?.visible).toBe(false);
    expect(controller.store.layers.get(A.id)?.visible).toBe(true);
    expect(ctx.submitted).toEqual([]); // no change request: a second browser is not affected
  });

  it('keeps the local choice when the layer changes', () => {
    const { controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [], sequenceNo: 1 });
    map.setLayerVisible(A.id, false);
    controller.listener.changes([event(2, { ...A, drawOrder: 99, version: 2 })]);
    expect(map.isLayerVisible(A.id)).toBe(false);
  });
});

describe('map controller: viewport (brief function 8)', () => {
  it('reports centre, metres per pixel, projection and the visible area', () => {
    const { map } = setup();
    const v = map.viewport;
    expect(v.projection).toBe('EPSG:3857');
    expect(v.center[0]).toBeCloseTo(15, 9);
    expect(v.center[1]).toBeCloseTo(62, 9);
    // Zoom 5 in Web Mercator is 4 892 projected metres per pixel; at 62° N that is about 2 300 m on the ground.
    expect(v.resolution).toBeGreaterThan(2200);
    expect(v.resolution).toBeLessThan(2400);
    expect(v.visibleArea.length).toBeGreaterThan(4);
  });

  it('has a centre but no visible area before the map is shown', () => {
    const { map } = setup({ mounted: false });
    expect(map.viewport.center).toEqual([15, 62]);
    expect(map.viewport.visibleArea).toEqual([]);
  });

  it('goTo centres the map at lon/lat and resolution in metres per pixel', () => {
    const { engine, map } = setup();
    const changes = vi.fn();
    map.onViewportChange(changes);
    map.goTo([15, 60], 100);
    expect(map.viewport.center[0]).toBeCloseTo(15, 9);
    expect(map.viewport.center[1]).toBeCloseTo(60, 9);
    expect(map.viewport.resolution).toBeCloseTo(100, 3);
    // In Web Mercator at 60° N, 100 m on the ground is about 200 projected metres.
    expect(engine.view?.resolution).toBeCloseTo(200 * (6_378_137 / 6_371_008.8), 0);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('goTo without a resolution keeps the zoom; a bad centre is ignored and logged', () => {
    const { engine, map, ctx } = setup();
    const before = engine.view?.resolution;
    map.goTo([18, 59]);
    expect(engine.view?.resolution).toBe(before);
    map.goTo([Number.NaN, 0] as unknown as Position);
    expect(ctx.logs.some((l) => l.level === 'warn' && l.message.includes('goTo'))).toBe(true);
  });
});

describe('map controller: pointer and pick (brief function 8)', () => {
  it('criterion 3: reports click and move with lon/lat converted back from the screen', () => {
    const { engine, map } = setup();
    const events: unknown[] = [];
    map.onPointer((e) => events.push(e));
    const pixel = engine.pixelOf([15, 60]);
    engine.pointer('move', pixel);
    engine.pointer('click', pixel);
    engine.pointer('down', pixel); // not reported
    expect(events).toHaveLength(2);
    const [move] = events as { type: string; position: Position }[];
    expect(move?.type).toBe('move');
    expect(move?.position[0]).toBeCloseTo(15, 9);
    expect(move?.position[1]).toBeCloseTo(60, 9);
  });

  it('criterion 3 and 4: converts back in EPSG:3413, also over the pole and across the antimeridian', () => {
    const { engine, controller, map } = setup();
    controller.setProjection('EPSG:3413');
    map.goTo([0, 90], 2000);
    for (const p of [[15, 60], [179, 85], [-179, 85], [-45, 89.9]] as const) {
      const back = controller.positionAt(engine.pixelOf(p));
      expect(distance(back ?? [0, 0], p)).toBeLessThan(0.01);
    }
  });

  it('criterion 3: reads 15° E 60° N back from the pixel that textbook formulas give, in EPSG:3857 and EPSG:3413 (review remark N4)', () => {
    const { engine, controller, map } = setup();
    for (const [code, project] of [['EPSG:3857', textbook.webMercator], ['EPSG:3413', textbook.polarStereographic3413]] as const) {
      controller.setProjection(code);
      map.goTo([10, 58], 500);
      const view = engine.view;
      if (view === null) throw new Error('no view');
      // The screen position worked out by hand: the view's centre and resolution, the formula's x/y.
      const [x, y] = project(15, 60);
      const pixel: Pixel = [(x - view.center[0]) / view.resolution + view.width / 2, (view.center[1] - y) / view.resolution + view.height / 2];
      const back = controller.positionAt(pixel);
      expect(back?.[0]).toBeCloseTo(15, 6);
      expect(back?.[1]).toBeCloseTo(60, 6);
    }
  });

  it('reports no position outside the projection valid area', () => {
    const { engine, controller } = setup();
    controller.setProjection('EPSG:3413');
    const view = engine.view;
    if (view === null) throw new Error('no view');
    engine.setView(engine.projection.forward([15, 35]) ?? [0, 0], 20_000);
    expect(controller.positionAt([view.width / 2, view.height - 1])).toBeNull(); // south of 30° N
  });

  it('criterion 6: pick returns the topmost object under the pointer first', () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({
      layers: [A, B],
      objects: [symbolObject(10, A.id, 15, 60), symbolObject(11, B.id, 15, 60), symbolObject(12, A.id, 15, 60), symbolObject(13, A.id, 30, 70)],
      sequenceNo: 1,
    });
    expect(map.pick(engine.pixelOf([15, 60]))).toEqual([uuid(11), uuid(12), uuid(10)]);
    map.setLayerVisible(B.id, false);
    expect(map.pick(engine.pixelOf([15, 60]))).toEqual([uuid(12), uuid(10)]);
  });

  it('bounds the pick tolerance and ignores a bad pixel', () => {
    const { engine, map } = setup();
    const spy = vi.spyOn(engine, 'pickCandidates');
    map.pick([10, 10], 10_000);
    expect(spy).toHaveBeenLastCalledWith([10, 10], 50);
    expect(map.pick([Number.NaN, 1])).toEqual([]);
  });
});

describe('map controller: selection on the map (brief function 14)', () => {
  const near = (n: number, layerId = A.id) => symbolObject(n, layerId, 14 + (n % 40) * 0.05, 61 + Math.floor(n / 40) * 0.05);
  const whole: [Pixel, Pixel] = [[0, 0], [800, 600]];

  it('criterion 24: a click on an object selects it and replaces the selection; a click on empty map or Escape clears it', () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62), symbolObject(11, A.id, 16, 61)], sequenceNo: 1 });
    engine.pointer('click', engine.pixelOf([15, 62]));
    expect(map.selection.value).toEqual([uuid(10)]);
    engine.pointer('click', engine.pixelOf([16, 61]));
    expect(map.selection.value).toEqual([uuid(11)]);
    engine.pointer('click', engine.pixelOf([20, 65]));
    expect(map.selection.value).toEqual([]);
    engine.pointer('click', engine.pixelOf([15, 62]));
    engine.escape();
    expect(map.selection.value).toEqual([]);
  });

  it('criterion 25: a click with the add key adds an unselected object and removes a selected one; other keys and the add key on empty map change nothing', () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62), symbolObject(11, A.id, 16, 61)], sequenceNo: 1 });
    engine.pointer('click', engine.pixelOf([15, 62]));
    engine.pointer('click', engine.pixelOf([16, 61]), 'add');
    expect(map.selection.value).toEqual([uuid(10), uuid(11)]);
    engine.pointer('click', engine.pixelOf([15, 62]), 'add');
    expect(map.selection.value).toEqual([uuid(11)]);
    engine.pointer('click', engine.pixelOf([20, 65]), 'add');
    engine.pointer('click', engine.pixelOf([15, 62]), 'other'); // e.g. Ctrl+click on a Mac, which opens the menu there
    expect(map.selection.value).toEqual([uuid(11)]);
  });

  it('criterion 26: a box replaces the selection with the objects in it, also when the add key was used for the selection before', () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62), symbolObject(11, A.id, 16, 61), symbolObject(12, A.id, 25, 55)], sequenceNo: 1 });
    map.selection.set([uuid(12)]);
    const a = engine.pixelOf([14.5, 62.5]);
    const b = engine.pixelOf([16.5, 60.5]);
    engine.selectBox(b, a); // any two opposite corners
    expect(new Set(map.selection.value)).toEqual(new Set([uuid(10), uuid(11)]));
  });

  it('criterion 27: a box over 1 500 objects selects exactly 1 000, topmost layer first, and the notice states the 500 left out', () => {
    const { engine, controller, map, ctx } = setup();
    const objects = [...Array.from({ length: 800 }, (_, i) => near(i, A.id)), ...Array.from({ length: 700 }, (_, i) => near(1000 + i, B.id))];
    controller.listener.snapshot({ layers: [A, B], objects, sequenceNo: 1 });
    engine.selectBox(...whole);
    expect(map.selection.value).toHaveLength(1000);
    const onTop = new Set(objects.slice(800).map((o) => o.id));
    expect(map.selection.value.slice(0, 700).every((id) => onTop.has(id))).toBe(true);
    expect(ctx.notifications.at(-1)).toEqual({ severity: 'warning', message: 'Selected the first 1,000 objects; 500 more in the box were left out. Zoom in to select them.' });
  });

  it('criterion 28: objects in clusters and in a locally hidden layer are not selected; the notice asks to zoom in for the clustered ones', () => {
    const { engine, controller, map, ctx } = setup();
    controller.listener.snapshot({ layers: [A, B], objects: [symbolObject(10, A.id, 15, 62), symbolObject(11, B.id, 16, 61)], sequenceNo: 1 });
    controller.listener.clusters?.({ level: 6, full: true, remove: [], upsert: [{ cell: 'c1', position: [14, 61], count: 40, byLayer: { [A.id]: 40 }, byIdentity: { friend: 40, hostile: 0, neutral: 0, unknown: 0 } }] });
    map.setLayerVisible(B.id, false);
    engine.selectBox(...whole);
    expect(map.selection.value).toEqual([uuid(10)]);
    expect(ctx.notifications.at(-1)?.message).toBe('40 objects inside clusters could not be selected. Zoom in to select them.');
    // A click on the hidden layer's object selects nothing either.
    engine.pointer('click', engine.pixelOf([16, 61]));
    expect(map.selection.value).toEqual([]);
  });

  it('a click with the add key on a cluster zooms in, as a plain click does, and leaves the selection alone (owner, 2026-10-16)', () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62)], sequenceNo: 1 });
    controller.listener.clusters?.({ level: 6, full: true, remove: [], upsert: [{ cell: 'c1', position: [14, 61], count: 5, byLayer: { [A.id]: 5 }, byIdentity: { friend: 5, hostile: 0, neutral: 0, unknown: 0 } }] });
    map.selection.set([uuid(10)]);
    const before = map.viewport.resolution;
    engine.pointer('click', engine.pixelOf([14, 61]), 'add');
    expect(map.viewport.resolution).toBeCloseTo(before / CLUSTER_ZOOM_FACTOR, 6);
    expect(map.selection.value).toEqual([uuid(10)]);
  });

  it('criterion 40: an id set by another plugin for an object the map does not hold, and a selected object that leaves the area, stay selected through area changes and a snapshot; a delete removes the id', () => {
    const { engine, clock, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62)], sequenceNo: 1 });
    map.selection.set([uuid(10), uuid(98), uuid(99)]);
    controller.listener.area?.({ sequenceNo: 2, entered: [], left: [uuid(10)] });
    controller.listener.changes([event(3, symbolObject(11, A.id, 16, 61))]);
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(11, A.id, 16, 61)], sequenceNo: 4 });
    clock.advance(1000);
    expect(map.selection.value).toEqual([uuid(10), uuid(98), uuid(99)]);
    expect(engine.highlighted).toEqual([]);
    controller.listener.changes([event(5, null, { id: uuid(99), type: 'object' })]);
    expect(map.selection.value).toEqual([uuid(10), uuid(98)]);
  });

  it('criterion 40: a click with the add key beyond 1 000 adds nothing and shows the notice', () => {
    const { engine, controller, map, ctx } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62)], sequenceNo: 1 });
    const full = Array.from({ length: 1000 }, (_, i) => uuid(2000 + i));
    map.selection.set(full);
    engine.pointer('click', engine.pixelOf([15, 62]), 'add');
    expect(map.selection.value).toEqual(full);
    expect(ctx.notifications.at(-1)?.message).toBe('A selection holds at most 1,000 objects; this object was not added.');
  });

  it('criterion 41: while pickPoint runs, a click does not select and a box is ignored; Escape cancels it first, and only a second Escape clears the selection', async () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62), symbolObject(11, A.id, 16, 61)], sequenceNo: 1 });
    map.selection.set([uuid(11)]);
    const picked = map.pickPoint();
    engine.selectBox(...whole);
    expect(map.selection.value).toEqual([uuid(11)]);
    engine.escape();
    expect(await picked).toBeNull();
    expect(map.selection.value).toEqual([uuid(11)]);
    engine.escape();
    expect(map.selection.value).toEqual([]);
    const again = map.pickPoint();
    engine.pointer('click', engine.pixelOf([15, 62]));
    expect(await again).not.toBeNull();
    expect(map.selection.value).toEqual([]);
  });

  it('criterion 41: while a drawing runs, clicks and boxes do not select', () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62)], sequenceNo: 1 });
    void map.draw('polygon');
    engine.pointer('click', engine.pixelOf([15, 62]));
    engine.pointer('click', engine.pixelOf([15, 62]), 'add');
    engine.selectBox(...whole);
    expect(map.selection.value).toEqual([]);
    engine.escape();
  });

  it('a click still selects while dragObject waits, and so does a box (brief function 14)', () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62), symbolObject(11, A.id, 16, 61)], sequenceNo: 1 });
    map.selection.set([uuid(10)]);
    void map.dragObject(uuid(10));
    engine.pointer('click', engine.pixelOf([16, 61]));
    expect(map.selection.value).toEqual([uuid(11)]);
    engine.selectBox(...whole);
    expect(new Set(map.selection.value)).toEqual(new Set([uuid(10), uuid(11)]));
  });
});

describe('map controller: right-click menus (brief function 15)', () => {
  it('criterion 29: a right click on a selected object of a selection of 3 opens the object actions for all 3, where the pointer is', () => {
    const { engine, controller, map, ctx } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62), symbolObject(11, A.id, 16, 61), symbolObject(12, A.id, 17, 60)], sequenceNo: 1 });
    map.selection.set([uuid(10), uuid(11), uuid(12)]);
    const pixel = engine.pixelOf([16, 61]);
    engine.menu(pixel);
    expect(ctx.openedMenus.at(-1)).toEqual({ at: [pixel[0] + 100, pixel[1] + 50], target: { objects: [uuid(10), uuid(11), uuid(12)] } });
    expect(map.selection.value).toEqual([uuid(10), uuid(11), uuid(12)]);
  });

  it('criterion 29: a right click on an object that is not selected makes it the selection first; on overlapping ones the shell lets the user choose', () => {
    const { engine, controller, map, ctx } = setup();
    controller.listener.snapshot({ layers: [A, B], objects: [symbolObject(10, A.id, 15, 62), symbolObject(11, A.id, 18, 61), symbolObject(12, B.id, 18, 61)], sequenceNo: 1 });
    map.selection.set([uuid(11)]);
    engine.menu(engine.pixelOf([15, 62]));
    expect(map.selection.value).toEqual([uuid(10)]);
    expect(ctx.openedMenus.at(-1)?.target).toEqual({ objects: [uuid(10)] });
    engine.menu(engine.pixelOf([18, 61]));
    expect(ctx.openedMenus.at(-1)?.target).toEqual({ choose: [uuid(12), uuid(11)] }); // topmost first
    expect(map.selection.value).toEqual([uuid(10)]); // the shell selects the chosen one
  });

  it('criterion 30: a right click on empty map or on a cluster offers the map actions at its position in lon/lat', () => {
    const { engine, controller, ctx } = setup();
    // A cluster is drawn above the objects: a right click on it is on the cluster, also with an object under it.
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62), symbolObject(11, A.id, 14, 61)], sequenceNo: 1 });
    controller.listener.clusters?.({ level: 6, full: true, remove: [], upsert: [{ cell: 'c1', position: [14, 61], count: 5, byLayer: { [A.id]: 5 }, byIdentity: { friend: 5, hostile: 0, neutral: 0, unknown: 0 } }] });
    for (const at of [[17.5, 60.25], [14, 61]] as const) {
      engine.menu(engine.pixelOf(at));
      const target = ctx.openedMenus.at(-1)?.target as { position: Position };
      expect(target.position[0]).toBeCloseTo(at[0], 6);
      expect(target.position[1]).toBeCloseTo(at[1], 6);
    }
  });

  it('opens no menu while pickPoint, a drawing or an edit runs (owner, 2026-10-17), but does while dragObject waits', async () => {
    const { engine, controller, map, ctx } = setup();
    const area = object(11, A.id, 'core.shape', { type: 'Polygon', coordinates: [[[16, 60], [17, 60], [17, 61], [16, 60]]] });
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62), area], sequenceNo: 1 });
    void map.pickPoint();
    engine.menu(engine.pixelOf([15, 62]));
    void map.draw('line');
    engine.menu(engine.pixelOf([15, 62]));
    const edited = map.edit(area.id);
    engine.menu(engine.pixelOf([15, 62]));
    expect(ctx.openedMenus).toHaveLength(0);
    engine.escape();
    expect(await edited).toBeNull();
    void map.dragObject(uuid(10));
    engine.menu(engine.pixelOf([15, 62]));
    expect(ctx.openedMenus.at(-1)?.target).toEqual({ objects: [uuid(10)] });
  });
});

describe('map controller: right-click while placing and drawing (brief function 27, criteria 52 and 53)', () => {
  it('criterion 52: a right click ends pickPoint with null and opens no menu; with nothing running the next one opens the menu as before', async () => {
    const { engine, controller, map, ctx } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62)], sequenceNo: 1 });
    map.selection.set([uuid(10)]);
    const placing = map.pickPoint();
    engine.menu(engine.pixelOf([15, 62]));
    expect(await placing).toBeNull();
    expect(ctx.openedMenus).toHaveLength(0);
    expect(engine.interaction).toBe('none');
    expect(map.selection.value).toEqual([uuid(10)]); // back to selection, which Escape would not have cleared either
    engine.menu(engine.pixelOf([20, 50]));
    expect(ctx.openedMenus).toHaveLength(1);
    // A pickPoint that follows is not touched by the one before.
    const again = map.pickPoint();
    engine.pointer('click', engine.pixelOf([16, 61]));
    expect(await again).not.toBeNull();
  });

  it('criterion 53: a line with three points has two after a right click; three more remove the other two and then end it with null', async () => {
    const { engine, map, ctx } = setup();
    let result: unknown = 'running';
    void map.draw('line').then((geometry) => {
      result = geometry;
    });
    engine.drawingPoints = 3;
    const rightClick = () => {
      engine.menu(engine.pixelOf([15, 62]));
    };
    rightClick();
    expect(engine.drawingPoints).toBe(2);
    expect(engine.drawing).not.toBeNull();
    rightClick();
    rightClick();
    expect(engine.drawingPoints).toBe(0);
    expect(engine.drawing).not.toBeNull(); // the last point is gone, the drawing still runs
    expect(result).toBe('running');
    rightClick();
    await Promise.resolve();
    expect(result).toBeNull();
    expect(engine.drawing).toBeNull();
    expect(ctx.openedMenus).toHaveLength(0);
  });

  it('criterion 53: a polygon takes back its points the same way', async () => {
    const { engine, map } = setup();
    let result: unknown = 'running';
    void map.draw('polygon').then((geometry) => {
      result = geometry;
    });
    engine.drawingPoints = 1;
    engine.menu([100, 100]);
    expect(engine.drawingPoints).toBe(0);
    engine.menu([100, 100]);
    await Promise.resolve();
    expect(result).toBeNull();
  });

  it('criterion 53: before the press of a circle, an ellipse, a square or a rectangle a right click ends it with null; during the press and drag it changes nothing', async () => {
    for (const kind of ['circle', 'ellipse', 'square', 'rectangle'] as const) {
      const { engine, map } = setup();
      let result: unknown = 'running';
      void map.draw(kind).then((geometry) => {
        result = geometry;
      });
      engine.pressing = true;
      engine.menu([100, 100]);
      await Promise.resolve();
      expect(result, kind).toBe('running');
      expect(engine.drawing, kind).not.toBeNull();
      engine.pressing = false;
      engine.menu([100, 100]);
      await Promise.resolve();
      expect(result, kind).toBeNull();
    }
  });

  it('criterion 53: during an Edit a right click changes nothing and opens no menu', async () => {
    const { engine, controller, map, ctx } = setup();
    const area = object(11, A.id, 'core.shape', { type: 'Polygon', coordinates: [[[16, 60], [17, 60], [17, 61], [16, 60]]] });
    controller.listener.snapshot({ layers: [A], objects: [area], sequenceNo: 1 });
    let result: unknown = 'running';
    void map.edit(area.id).then((geometry) => {
      result = geometry;
    });
    engine.menu(engine.pixelOf([16.5, 60.3]));
    await Promise.resolve();
    expect(result).toBe('running');
    expect(engine.editing).not.toBeNull();
    expect(ctx.openedMenus).toHaveLength(0);
  });

  it('a grabbed dragObject is left alone by a right click, a dragObject that only waits opens the menu (brief function 15)', () => {
    const { engine, controller, map, ctx } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 62)], sequenceNo: 1 });
    void map.dragObject(uuid(10));
    engine.menu(engine.pixelOf([15, 62]));
    expect(ctx.openedMenus).toHaveLength(1); // waiting: the menu
    engine.pointer('down', engine.pixelOf([15, 62])); // the press grabs it
    engine.menu(engine.pixelOf([15, 62]));
    expect(ctx.openedMenus).toHaveLength(1); // grabbed: nothing
    expect(engine.interaction).toBe('drag-object');
  });
});

describe('map controller: Centre on and Zoom to (brief function 16)', () => {
  const metresAcross = (map: ReturnType<typeof setup>['map'], engine: FakeEngine) => map.viewport.resolution * (engine.view?.width ?? 0);

  it('criterion 31: Centre on several objects centres on the middle of their extent in map coordinates and keeps the zoom', async () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 10, 50), symbolObject(11, A.id, 20, 70)], sequenceNo: 1 });
    const before = engine.view?.resolution;
    expect(await map.centreOn([uuid(10), uuid(11)])).toEqual({ missing: [] });
    // The middle in Web Mercator: 15° E, but not 60° N (the mean latitude); about 61.6° N.
    const [x1, y1] = engine.projection.forward([10, 50]) ?? [0, 0];
    const [x2, y2] = engine.projection.forward([20, 70]) ?? [0, 0];
    const middle = engine.projection.inverse([(x1 + x2) / 2, (y1 + y2) / 2]) ?? [0, 0];
    expect(map.viewport.center[0]).toBeCloseTo(15, 6);
    expect(map.viewport.center[1]).toBeCloseTo(middle[1], 6);
    expect(middle[1]).toBeGreaterThan(61.5);
    expect(engine.view?.resolution).toBe(before);
  });

  it('criterion 31: Zoom to one object shows a view 10 km wide (± 10 %), at 60° N and at 20° N', async () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60), symbolObject(11, A.id, -40, 20)], sequenceNo: 1 });
    for (const id of [uuid(10), uuid(11)]) {
      await map.zoomTo([id]);
      expect(Math.abs(metresAcross(map, engine) - 10_000)).toBeLessThan(1_000);
    }
    expect(map.viewport.center[0]).toBeCloseTo(-40, 6);
    expect(map.viewport.center[1]).toBeCloseTo(20, 6);
  });

  it('criterion 31: Zoom to one object follows the setting zoomToWidthMetres (brief settings table)', async () => {
    const { engine, controller, map } = setup();
    const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
    controller.setSettings({ ...DEFAULT_SETTINGS, zoomToWidthMetres: 20_000 }, projections);
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    await map.zoomTo([uuid(10)]);
    expect(Math.abs(metresAcross(map, engine) - 20_000)).toBeLessThan(2_000);
  });

  it('criterion 31: Zoom to several objects fits them with a margin, and two close together still give 10 km (owner, 2026-10-17)', async () => {
    const { engine, controller, map } = setup();
    const far = [symbolObject(10, A.id, 14, 60), symbolObject(11, A.id, 18, 61), symbolObject(12, A.id, 16, 59)];
    const close = [symbolObject(13, A.id, 15, 60), symbolObject(14, A.id, 15.001, 60)];
    controller.listener.snapshot({ layers: [A], objects: [...far, ...close], sequenceNo: 1 });
    await map.zoomTo(far.map((o) => o.id));
    for (const o of far) {
      const [x, y] = engine.pixelOf(o.geometry.type === 'Point' ? o.geometry.coordinates : [0, 0]);
      expect(x).toBeGreaterThanOrEqual(800 * 0.1 - 1e-6);
      expect(x).toBeLessThanOrEqual(800 * 0.9 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(600 * 0.1 - 1e-6);
      expect(y).toBeLessThanOrEqual(600 * 0.9 + 1e-6);
    }
    const pixels = far.map((o) => engine.pixelOf(o.geometry.type === 'Point' ? o.geometry.coordinates : [0, 0]));
    const span = (i: 0 | 1) => Math.max(...pixels.map((p) => p[i])) - Math.min(...pixels.map((p) => p[i]));
    // The side that limits fills the view but the margins (here the height: 2° of latitude at 60° N).
    expect(Math.max(span(0) / (800 * 0.8), span(1) / (600 * 0.8))).toBeCloseTo(1, 3);
    await map.zoomTo(close.map((o) => o.id));
    expect(Math.abs(metresAcross(map, engine) - 10_000)).toBeLessThan(1_000);
  });

  it('criterion 31: works for ids the map does not hold, read from the server; a circle counts by its outline', async () => {
    const { engine, map, ctx } = setup();
    const circle = { ...symbolObject(20, A.id, 15, 60), type: 'core.shape', geometry: { type: 'Circle', center: [15, 60], radius: 50_000 }, style: {} } as const;
    ctx.setServerObjects([symbolObject(21, A.id, -30, 40), circle]);
    expect(await map.centreOn([uuid(21)])).toEqual({ missing: [] });
    expect(map.viewport.center[0]).toBeCloseTo(-30, 6);
    expect(map.viewport.center[1]).toBeCloseTo(40, 6);
    await map.zoomTo([uuid(20)]);
    // 100 km across fill the view's height but the margins: 100 km / (0.8 × 600 px) per pixel, × 800 px.
    expect(metresAcross(map, engine) / ((100_000 / (0.8 * 600)) * 800)).toBeCloseTo(1, 1);
  });

  it('criterion 42: objects with no position this projection can show leave the map where it is, with the notice; gone ones too', async () => {
    const { engine, controller, map, ctx } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 80), symbolObject(11, A.id, 16, 61)], sequenceNo: 1 });
    controller.setProjection('EPSG:3031');
    const before = engine.view?.center;
    expect(await map.centreOn([uuid(10), uuid(99)])).toEqual({ missing: [uuid(10), uuid(99)] });
    expect(await map.zoomTo([uuid(10)])).toEqual({ missing: [uuid(10)] });
    expect(engine.view?.center).toEqual(before);
    expect(ctx.notifications.at(-1)).toEqual({ severity: 'warning', message: 'Nothing to show: the object is gone or has no position this map projection can show.' });
    // With one left, the others are reported missing and the map moves.
    controller.setProjection('EPSG:3857');
    expect(await map.centreOn([uuid(11), uuid(99)])).toEqual({ missing: [uuid(99)] });
    expect(map.viewport.center[1]).toBeCloseTo(61, 6);
  });

  it('takes objects on both sides of the antimeridian as close together, not the world apart', async () => {
    const { controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 179, 60), symbolObject(11, A.id, -177, 62)], sequenceNo: 1 });
    await map.zoomTo([uuid(10), uuid(11)]);
    expect(map.viewport.center[0]).toBeCloseTo(-179, 6);
    expect(map.viewport.resolution).toBeLessThan(1_000);
    await map.centreOn([uuid(11), uuid(10)]);
    expect(map.viewport.center[0]).toBeCloseTo(-179, 6);
  });

  it('does nothing for no ids: no move, no notice', async () => {
    const { engine, map, ctx } = setup();
    const before = engine.view?.center;
    expect(await map.centreOn([])).toEqual({ missing: [] });
    expect(await map.zoomTo([])).toEqual({ missing: [] });
    expect(engine.view?.center).toEqual(before);
    expect(ctx.notifications).toHaveLength(0);
  });

  it('takes the narrowest extent around the world whatever the order of the objects: 170° W, 0° and 170° E span 190°, not 340°', async () => {
    const { controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, -170, 10), symbolObject(11, A.id, 0, 12), symbolObject(12, A.id, 170, 14)], sequenceNo: 1 });
    for (const order of [[10, 11, 12], [12, 10, 11], [11, 12, 10]]) {
      await map.centreOn(order.map((n) => uuid(n)));
      // The span from 0° east over 170° E to 170° W: its middle is at 95° E.
      expect(map.viewport.center[0]).toBeCloseTo(95, 6);
    }
  });

  it('counts objects it could not read as missing when the server does not answer, with a log line', async () => {
    const { map, ctx } = setup();
    ctx.setServerObjects([symbolObject(21, A.id, -30, 40)]);
    ctx.failObjectQueries(true);
    expect(await map.centreOn([uuid(21)])).toEqual({ missing: [uuid(21)] });
    expect(ctx.logs.some((l) => l.level === 'warn' && l.message === 'the objects to show could not be read from the server')).toBe(true);
  });
});

describe('map controller: drawing a polygon (brief function 17; T-054 prototype)', () => {
  /** A ring as OpenLayers' draw interaction reports it: in map coordinates, closed. */
  function drawn(engine: FakeEngine, points: readonly Position[]): DrawnShape {
    const ring = points.map((p) => {
      const xy = engine.projection.forward(p);
      if (xy === null) throw new Error('not in this projection');
      return [xy[0], xy[1]] as [number, number];
    });
    return { kind: 'polygon', points: [...ring, ring[0] as [number, number]] };
  }
  const triangle: Position[] = [[15, 60], [17, 61], [16, 62.5]];
  const expectRing = (ring: readonly Position[] | undefined, points: readonly Position[]) => {
    expect(ring).toHaveLength(points.length + 1);
    [...points, points[0] as Position].forEach((p, i) => {
      expect(ring?.[i]?.[0]).toBeCloseTo(p[0], 9);
      expect(ring?.[i]?.[1]).toBeCloseTo(p[1], 9);
    });
  };

  it('criterion 32: every kind reaches the engine with the preview style; a dragged circle comes back in metres', async () => {
    const { engine, map } = setup();
    const style = { strokeColor: '#C0392B', fillPattern: 'hatch' } as const;
    for (const kind of ['circle', 'ellipse', 'square', 'rectangle', 'polygon', 'line'] as const) {
      const drawing = map.draw(kind, { style });
      expect(engine.drawing).toMatchObject({ kind, style });
      engine.escape();
      expect(await drawing).toBeNull();
    }
    const center = engine.projection.forward([15, 60]);
    const edge = engine.projection.forward(destination([15, 60], 45, 5_000));
    if (center === null || edge === null) throw new Error('not on the map');
    const drawing = map.draw('circle');
    engine.finishDrawing({ kind: 'circle', center, edge });
    const circle = await drawing;
    expect(circle?.type).toBe('Circle');
    expect(circle?.type === 'Circle' ? circle.radius : 0).toBeCloseTo(5_000, 3);
  });

  it('criterion 32: a shape that cannot be drawn (released where the projection cannot show it) gives null and a log line (owner, 2026-10-16)', async () => {
    const { engine, controller, map, ctx } = setup();
    controller.setProjection('EPSG:3413');
    const inside = engine.projection.forward([15, 70]);
    const south = engine.projection.forward([15, 20]);
    if (inside === null || south === null) throw new Error('not on the map');
    const drawing = map.draw('rectangle');
    engine.finishDrawing({ kind: 'rectangle', from: inside, to: south });
    expect(await drawing).toBeNull();
    expect(ctx.logs.some((entry) => /nothing drawn/.test(entry.message))).toBe(true);
  });

  it('criterion 32: returns the drawn polygon in lon/lat, closed, and turns off double-click zoom while drawing (EPSG:3857)', async () => {
    const { engine, map } = setup();
    const drawing = map.draw('polygon');
    expect(engine.drawing?.kind).toBe('polygon');
    expect(engine.interaction).toBe('draw');
    engine.finishDrawing(drawn(engine, triangle));
    const geometry = await drawing;
    expect(geometry?.type).toBe('Polygon');
    expectRing(geometry?.type === 'Polygon' ? geometry.coordinates[0] : undefined, triangle);
    expect(engine.interaction).toBe('none');
  });

  it('criterion 34: in EPSG:3413 too, around the pole', async () => {
    const { engine, controller, map } = setup();
    controller.setProjection('EPSG:3413');
    const aroundThePole: Position[] = [[0, 80], [120, 82], [-120, 85]];
    const drawing = map.draw('polygon');
    engine.finishDrawing(drawn(engine, aroundThePole));
    const geometry = await drawing;
    expectRing(geometry?.type === 'Polygon' ? geometry.coordinates[0] : undefined, aroundThePole);
  });

  it('criteria 32 and 41: Escape and a new interaction cancel it with null; fewer than three points give null', async () => {
    const { engine, map } = setup();
    const first = map.draw('polygon');
    engine.escape();
    expect(await first).toBeNull();
    expect(engine.drawing).toBeNull();
    const second = map.draw('polygon');
    const picking = map.pickPoint();
    expect(await second).toBeNull();
    expect(engine.drawing).toBeNull();
    expect(engine.interaction).toBe('pick-point');
    engine.escape();
    expect(await picking).toBeNull();
    const third = map.draw('polygon');
    engine.finishDrawing(drawn(engine, triangle.slice(0, 2)));
    expect(await third).toBeNull();
  });

  it('starting a drawing ends a waiting pickPoint with null', async () => {
    const { engine, map } = setup();
    const picking = map.pickPoint();
    const drawing = map.draw('polygon');
    expect(await picking).toBeNull();
    expect(engine.drawing).not.toBeNull();
    engine.escape();
    expect(await drawing).toBeNull();
  });
});

describe('map controller: editing a shape (brief function 17; criteria 33 and 41)', () => {
  const xy = (engine: FakeEngine, p: Position) => {
    const result = engine.projection.forward(p);
    if (result === null) throw new Error('not on the map');
    return result;
  };
  const square = (n: number, layerId: string, style?: Record<string, unknown>) => object(n, layerId, 'core.shape', { type: 'Polygon', coordinates: [[[15, 60], [16, 60], [16, 61], [15, 61], [15, 60]]] }, style === undefined ? {} : { style });

  it('criterion 33: moving a shape and dragging one corner return the new geometry; the object itself is unchanged', async () => {
    const { engine, controller, map } = setup();
    const area = square(10, A.id, { strokeColor: '#ff0000' });
    controller.listener.snapshot({ layers: [A], objects: [area], sequenceNo: 1 });
    const editing = map.edit(area.id);
    expect(engine.interaction).toBe('edit');
    expect(engine.editing?.shape.kind).toBe('polygon');
    expect(engine.editing?.style).toEqual({ strokeColor: '#ff0000' }); // the object's own style, without one given
    // The user moved one corner: [16, 61] to [16.5, 61.5].
    const moved: Position[] = [[15, 60], [16, 60], [16.5, 61.5], [15, 61], [15, 60]];
    engine.finishEditing({ kind: 'polygon', rings: [moved.map((p) => xy(engine, p))] });
    const geometry = await editing;
    expect(geometry?.type).toBe('Polygon');
    const ring = geometry?.type === 'Polygon' ? geometry.coordinates[0] : [];
    moved.forEach((p, i) => {
      expect(ring?.[i]?.[0]).toBeCloseTo(p[0], 9);
      expect(ring?.[i]?.[1]).toBeCloseTo(p[1], 9);
    });
    expect(area.geometry).toEqual({ type: 'Polygon', coordinates: [[[15, 60], [16, 60], [16, 61], [15, 61], [15, 60]]] });
    expect(engine.interaction).toBe('none');
  });

  it("criterion 33: a circle comes back with its radius from the dragged handle, an ellipse with its axes and rotation; a minor axis dragged past the major swaps them", async () => {
    const { engine, controller, map } = setup();
    const circle = object(11, A.id, 'core.shape', { type: 'Circle', center: [15, 60], radius: 5_000 });
    const ellipse = object(12, A.id, 'core.shape', { type: 'Ellipse', center: [16, 61], semiMajorAxis: 8_000, semiMinorAxis: 3_000, rotation: 30 });
    controller.listener.snapshot({ layers: [A], objects: [circle, ellipse], sequenceNo: 1 });
    const editingCircle = map.edit(circle.id);
    const start = engine.editing?.shape;
    expect(start?.kind).toBe('circle');
    if (start?.kind !== 'circle') return;
    engine.finishEditing({ ...start, edge: xy(engine, destination([15, 60], 90, 7_000)) });
    const newCircle = await editingCircle;
    expect(newCircle?.type === 'Circle' ? newCircle.radius : 0).toBeCloseTo(7_000, 0);
    const editingEllipse = map.edit(ellipse.id);
    const e = engine.editing?.shape;
    if (e?.kind !== 'ellipse') throw new Error('not an ellipse');
    // The handles start at the axis ends (the major along 30°).
    expect(distance([16, 61], engine.projection.inverse(e.major) ?? [0, 0])).toBeCloseTo(8_000, 0);
    const fitted = engine.editing?.reshape({ ...e, minor: xy(engine, destination([16, 61], 120, 12_000)) });
    expect(fitted?.outline.length).toBeGreaterThan(32);
    engine.finishEditing({ ...e, minor: xy(engine, destination([16, 61], 120, 12_000)) });
    const swapped = await editingEllipse;
    if (swapped?.type !== 'Ellipse') throw new Error('not an ellipse');
    expect(swapped.semiMajorAxis).toBeCloseTo(12_000, 0);
    expect(swapped.semiMinorAxis).toBeCloseTo(8_000, 0);
    expect(swapped.rotation).toBeCloseTo(120, 0);
  });

  it('rejects at once with NotOnMapError for an object the map does not draw (not held, in a hidden layer, outside this projection) or with a point it cannot show; a geometry it does not edit is refused', async () => {
    const { controller, map } = setup();
    const arctic = object(13, A.id, 'core.shape', { type: 'Polygon', coordinates: [[[0, 80], [120, 82], [-120, 85], [0, 80]]] });
    const southern = object(14, A.id, 'core.shape', { type: 'Circle', center: [15, -40], radius: 5_000 });
    // Drawn whole although one point lies outside EPSG:3413 (function 4), but that point cannot be dragged there.
    const partly = object(16, A.id, 'core.shape', { type: 'LineString', coordinates: [[15, 60], [15, -40]] });
    const multi = object(17, A.id, 'core.shape', { type: 'MultiPoint', coordinates: [[15, 60], [16, 61]] });
    controller.listener.snapshot({ layers: [A], objects: [arctic, southern, partly, multi], sequenceNo: 1 });
    await expect(map.edit(uuid(99))).rejects.toBeInstanceOf(NotOnMapError);
    await expect(map.edit(multi.id)).rejects.toThrow(/MultiPoint cannot be edited/);
    controller.setProjection('EPSG:3413');
    await expect(map.edit(southern.id)).rejects.toBeInstanceOf(NotOnMapError);
    await expect(map.edit(partly.id)).rejects.toBeInstanceOf(NotOnMapError);
    map.setLayerVisible(A.id, false);
    await expect(map.edit(arctic.id)).rejects.toBeInstanceOf(NotOnMapError);
  });

  it('criterion 41: Escape, a new interaction and the object being deleted end an edit with null; a shape that cannot be kept gives null', async () => {
    const { engine, controller, map } = setup();
    const area = square(15, A.id);
    controller.listener.snapshot({ layers: [A], objects: [area], sequenceNo: 1 });
    const first = map.edit(area.id);
    engine.escape();
    expect(await first).toBeNull();
    expect(engine.editing).toBeNull();
    const second = map.edit(area.id);
    const drawing = map.draw('polygon');
    expect(await second).toBeNull();
    engine.escape();
    expect(await drawing).toBeNull();
    const third = map.edit(area.id);
    controller.listener.changes([event(2, null, { id: area.id, type: 'object' })]);
    expect(await third).toBeNull();
    controller.listener.changes([event(3, { ...area, version: 3 })]);
    const fourth = map.edit(area.id);
    engine.finishEditing({ kind: 'polygon', rings: [[xy(engine, [15, 60]), xy(engine, [16, 60]), xy(engine, [15, 60])]] });
    expect(await fourth).toBeNull();
  });
});

describe('map controller: continuing a line (brief function 44, criterion 105)', () => {
  const xy = (engine: FakeEngine, p: Position) => {
    const result = engine.projection.forward(p);
    if (result === null) throw new Error('not on the map');
    return result;
  };
  const OWN: Position[] = [[14, 60], [15.5, 60.5], [16, 61.5]]; // longitude and latitude differ everywhere
  const line = (n: number, layerId: string) => object(n, layerId, 'core.shape', { type: 'LineString', coordinates: OWN }, { style: { strokeColor: '#00ff00' } });

  it("starts a drawing of a line that extends the line's own points, in its style, and highlights the line while it runs, selected or not", () => {
    const { engine, controller, map } = setup();
    const shape = line(10, A.id);
    controller.listener.snapshot({ layers: [A], objects: [shape], sequenceNo: 1 });
    void map.append(shape.id);
    expect(engine.interaction).toBe('draw');
    expect(engine.drawing?.kind).toBe('line');
    expect(engine.drawing?.style).toEqual({ strokeColor: '#00ff00' }); // the object's own style, without one given
    expect(engine.drawing?.options?.extend).toEqual(OWN.map((p) => xy(engine, p)));
    expect(engine.highlighted).toEqual([shape.id]);
    expect(map.selection.value).toEqual([]); // not selected by it
    engine.escape();
    expect(engine.highlighted).toEqual([]);
    void map.append(shape.id, { style: { strokeColor: '#ff0000' } });
    expect(engine.drawing?.style).toEqual({ strokeColor: '#ff0000' });
  });

  it("criterion 105: finishing resolves with the line's points, exactly as they were, followed by the added ones; the object is unchanged", async () => {
    const { engine, controller, map } = setup();
    const shape = line(11, A.id);
    controller.listener.snapshot({ layers: [A], objects: [shape], sequenceNo: 1 });
    const added: Position[] = [[17, 62], [18.5, 62.5]];
    const run = map.append(shape.id);
    engine.finishDrawing({ kind: 'line', points: [...OWN, ...added].map((p) => xy(engine, p)) });
    const result = await run;
    expect(result?.type).toBe('LineString');
    expect(result?.coordinates).toHaveLength(5);
    expect(result?.coordinates.slice(0, 3)).toEqual(OWN);
    added.forEach((p, i) => {
      expect(result?.coordinates[3 + i]?.[0]).toBeCloseTo(p[0], 9);
      expect(result?.coordinates[3 + i]?.[1]).toBeCloseTo(p[1], 9);
    });
    expect(controller.store.objects.get(shape.id)?.geometry).toEqual({ type: 'LineString', coordinates: OWN });
    expect(engine.interaction).toBe('none');
    expect(engine.highlighted).toEqual([]);
  });

  it('the double-click that ends an append does not clear the selection: its second click reaches the map after the line is finished (SF A)', async () => {
    const { engine, clock, controller, map } = setup();
    const shape = line(13, A.id);
    controller.listener.snapshot({ layers: [A], objects: [shape], sequenceNo: 1 });
    map.selection.set([shape.id]);
    const run = map.append(shape.id);
    engine.finishDrawing({ kind: 'line', points: [...OWN, [17, 62] as Position].map((p) => xy(engine, p)) }); // OpenLayers ends the drawing on the second click's release
    engine.pointer('click', [3, 3]); // and then sends that click, on empty map
    expect((await run)?.coordinates).toHaveLength(4);
    expect(map.selection.value).toEqual([shape.id]);
    clock.advance(1000);
    engine.pointer('click', [3, 3]); // a click of its own, later, still clears it
    expect(map.selection.value).toEqual([]);
  });

  it('the click that ends a drawing or an edit does not clear the selection either; Enter and Escape never sent one', async () => {
    const { engine, clock, controller, map } = setup();
    const shape = line(14, A.id);
    controller.listener.snapshot({ layers: [A], objects: [shape], sequenceNo: 1 });
    map.selection.set([shape.id]);
    const drawing = map.draw('line');
    engine.finishDrawing({ kind: 'line', points: OWN.map((p) => xy(engine, p)) });
    engine.pointer('click', [3, 3]);
    expect((await drawing)?.type).toBe('LineString');
    expect(map.selection.value).toEqual([shape.id]);
    clock.advance(1000);
    const edit = map.edit(shape.id);
    engine.finishEditing({ kind: 'line', points: OWN.map((p) => xy(engine, p)) });
    engine.pointer('click', [3, 3]);
    expect((await edit)?.type).toBe('LineString');
    expect(map.selection.value).toEqual([shape.id]);
  });

  it('resolves null with none added, and when a point lies where the projection cannot show one', async () => {
    const { engine, controller, map } = setup();
    const shape = line(12, A.id);
    controller.listener.snapshot({ layers: [A], objects: [shape], sequenceNo: 1 });
    const none = map.append(shape.id);
    engine.finishDrawing({ kind: 'line', points: OWN.map((p) => xy(engine, p)) });
    expect(await none).toBeNull();
    const twice = map.append(shape.id); // the same point twice in a row is one
    const clicked = xy(engine, [17, 62]);
    engine.finishDrawing({ kind: 'line', points: [...OWN.map((p) => xy(engine, p)), clicked, clicked] });
    expect((await twice)?.coordinates).toHaveLength(4);
    const outside = map.append(shape.id);
    engine.finishDrawing({ kind: 'line', points: [...OWN.map((p) => xy(engine, p)), [1e12, 1e12]] });
    expect(await outside).toBeNull();
  });

  it('criterion 105: Escape, an abort, another interaction, the right click with none added and the line being deleted give null', async () => {
    const { engine, controller, map } = setup();
    const shape = line(13, A.id);
    controller.listener.snapshot({ layers: [A], objects: [shape], sequenceNo: 1 });
    const escaped = map.append(shape.id);
    engine.escape();
    expect(await escaped).toBeNull();
    const abort = new AbortController();
    const aborted = map.append(shape.id, { signal: abort.signal });
    abort.abort();
    expect(await aborted).toBeNull();
    expect(engine.drawing).toBeNull();
    const replaced = map.append(shape.id);
    const next = map.pickPoint();
    expect(await replaced).toBeNull();
    engine.escape();
    expect(await next).toBeNull();
    const right = map.append(shape.id);
    engine.menu(engine.pixelOf([15, 60])); // the fake has no point added: as Escape, and no menu
    expect(await right).toBeNull();
    const gone = map.append(shape.id);
    controller.listener.changes([event(2, null, { id: shape.id, type: 'object' })]);
    expect(await gone).toBeNull();
    expect(engine.drawing).toBeNull();
    const done = new AbortController();
    done.abort();
    expect(await map.append(shape.id, { signal: done.signal })).toBeNull(); // already aborted: null first, whatever the object
  });

  it('criterion 105: rejects at once with NotALineError for any other geometry and NotOnMapError for an object the map does not draw', async () => {
    const { controller, map } = setup();
    const area = object(14, A.id, 'core.shape', { type: 'Polygon', coordinates: [[[15, 60], [16, 60], [16, 61], [15, 60]]] });
    const point = symbolObject(15, A.id, 15, 60);
    const hidden = object(16, layer(2).id, 'core.shape', { type: 'LineString', coordinates: OWN });
    const partly = object(17, A.id, 'core.shape', { type: 'LineString', coordinates: [[15, 60], [15, -40]] });
    controller.listener.snapshot({ layers: [A, layer(2)], objects: [area, point, hidden, partly], sequenceNo: 1 });
    await expect(map.append(area.id)).rejects.toBeInstanceOf(NotALineError);
    await expect(map.append(point.id)).rejects.toBeInstanceOf(NotALineError);
    await expect(map.append(uuid(99))).rejects.toBeInstanceOf(NotOnMapError);
    map.setLayerVisible(layer(2).id, false);
    await expect(map.append(hidden.id)).rejects.toBeInstanceOf(NotOnMapError);
    controller.setProjection('EPSG:3413');
    await expect(map.append(partly.id)).rejects.toBeInstanceOf(NotOnMapError); // a point this projection cannot show
  });

  it("a line of a display class that is switched off is not drawn, so it is not appended to", async () => {
    const { controller, map } = setup();
    const shape = { ...line(18, A.id), displayClass: 'dwell-area' as const };
    controller.listener.snapshot({ layers: [A], objects: [shape], sequenceNo: 1 });
    controller.setDisplay({ ...DEFAULT_DISPLAY, classes: { 'dwell-area': false, 'sensor-coverage': true } });
    await expect(map.append(shape.id)).rejects.toBeInstanceOf(NotOnMapError);
  });
});

describe('map controller: text objects (brief function 45, criterion 106)', () => {
  const text = (n: number, layerId: string, lon: number, lat: number) => object(n, layerId, 'core.text', { type: 'Point', coordinates: [lon, lat] }, { text: { value: 'Alpha', rotation: 30, size: 20 } });

  it('is a draw item of the layer, picked, selected by a click and a box, and highlighted when selected', () => {
    const { engine, controller, map } = setup();
    const alpha = text(10, A.id, 15.2, 58.4);
    controller.listener.snapshot({ layers: [A], objects: [alpha, symbolObject(11, A.id, 16.5, 59)], sequenceNo: 1 });
    expect(engine.items.get(A.id)?.get(alpha.id)).toMatchObject({ kind: 'textobject', text: 'Alpha', size: 20, rotation: 30, position: [15.2, 58.4] });
    const at = engine.pixelOf([15.2, 58.4]);
    expect(map.pick(at)).toEqual([alpha.id]);
    engine.pointer('click', at);
    expect(map.selection.value).toEqual([alpha.id]);
    expect(engine.highlight.map((item) => item.kind)).toEqual(['textobject']);
    engine.selectBox([0, 0], [1600, 1200]);
    expect([...map.selection.value].sort()).toEqual([alpha.id, uuid(11)].sort());
  });

  it('is dragged by dragObject: the drop position is where the point goes, the object itself is unchanged, and the preview is the text', async () => {
    const { engine, controller, map } = setup();
    const alpha = text(12, A.id, 15, 60);
    controller.listener.snapshot({ layers: [A], objects: [alpha], sequenceNo: 1 });
    const result = map.dragObject(alpha.id);
    const from = engine.pixelOf([15, 60]);
    const to = engine.pixelOf([16, 61]);
    engine.pointer('down', from);
    engine.pointer('move', [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
    expect(engine.dragPreview).toMatchObject({ kind: 'textobject', text: 'Alpha' });
    engine.pointer('up', to);
    const position = await result;
    expect(position?.[0]).toBeCloseTo(16, 6);
    expect(position?.[1]).toBeCloseTo(61, 6);
    expect(controller.store.objects.get(alpha.id)).toBe(alpha);
  });

  it('is edited by its point only: edit gives a Point, and an object that is not on a point is a marker', async () => {
    const { engine, controller, map } = setup();
    const alpha = text(13, A.id, 15, 60);
    controller.listener.snapshot({ layers: [A], objects: [alpha], sequenceNo: 1 });
    const editing = map.edit(alpha.id);
    expect(engine.editing?.shape.kind).toBe('point');
    const moved = engine.projection.forward([17, 61]);
    if (moved === null || engine.editing?.shape.kind !== 'point') throw new Error('no edit');
    engine.finishEditing({ kind: 'point', at: moved });
    const geometry = await editing;
    expect(geometry?.type).toBe('Point');
    expect(geometry?.type === 'Point' ? geometry.coordinates[0] : 0).toBeCloseTo(17, 9);
    expect(geometry?.type === 'Point' ? geometry.coordinates[1] : 0).toBeCloseTo(61, 9);
  });

  it('is faded with its object by a fade list, and goes with a hidden layer or a display class that is switched off', () => {
    const { engine, controller, map } = setup();
    const alpha = text(14, A.id, 15, 60);
    controller.listener.snapshot({ layers: [A], objects: [alpha], sequenceNo: 1 });
    const list = map.createFadeList();
    list.set([alpha.id]);
    expect(engine.items.get(A.id)?.get(alpha.id)).toMatchObject({ faded: true });
    list.clear();
    expect(engine.items.get(A.id)?.get(alpha.id)).not.toHaveProperty('faded');
    expect(engine.layers.find((l) => l.id === A.id)?.visible).toBe(true);
    map.setLayerVisible(A.id, false);
    expect(engine.layers.find((l) => l.id === A.id)?.visible).toBe(false); // the whole layer, its text with it
    expect(map.pick(engine.pixelOf([15, 60]))).toEqual([]);
  });
});

describe('map controller: interactions (brief function 8, criterion 7)', () => {
  it('criterion 7: pick a point returns lon/lat of the next click', async () => {
    const { engine, map } = setup();
    const result = map.pickPoint();
    expect(engine.interaction).toBe('pick-point');
    engine.pointer('click', engine.pixelOf([15, 60]));
    const position = await result;
    expect(position?.[0]).toBeCloseTo(15, 9);
    expect(position?.[1]).toBeCloseTo(60, 9);
    expect(engine.interaction).toBe('none');
  });

  it('Escape cancels; a new interaction cancels the one before', async () => {
    const { engine, map } = setup();
    const first = map.pickPoint();
    const second = map.pickPoint();
    expect(await first).toBeNull();
    engine.escape();
    expect(await second).toBeNull();
    expect(engine.interaction).toBe('none');
  });

  it('criterion 7: drag an object returns the drop position and does not change the object', async () => {
    const { engine, controller, map, ctx } = setup();
    const original = symbolObject(10, A.id, 15, 60);
    controller.listener.snapshot({ layers: [A], objects: [original], sequenceNo: 1 });
    const result = map.dragObject(uuid(10));
    expect(engine.interaction).toBe('drag-object');
    // Grab the symbol 5 pixels off its centre and drop it where 16° E 61° N is (plus the same offset).
    const from = engine.pixelOf([15, 60]);
    const to = engine.pixelOf([16, 61]);
    engine.pointer('down', [from[0] + 5, from[1]]);
    engine.pointer('move', [(from[0] + to[0]) / 2 + 5, (from[1] + to[1]) / 2]);
    expect(engine.dragPreview?.kind).toBe('symbol');
    engine.pointer('up', [to[0] + 5, to[1]]);
    const position = await result;
    expect(position?.[0]).toBeCloseTo(16, 6);
    expect(position?.[1]).toBeCloseTo(61, 6);
    expect(engine.dragPreview).toBeNull();
    expect(controller.store.objects.get(uuid(10))).toBe(original);
    expect(ctx.submitted).toEqual([]);
  });

  it('criteria 24 and 41: Escape while a drag only waits ends it with null and clears the selection at once; while dragging, it cancels the drag first (owner, 2026-10-20)', async () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    map.selection.set([uuid(10)]);
    const waiting = map.dragObject(uuid(10)); // as draw-symbols keeps it armed for the selected symbol
    engine.escape();
    expect(await waiting).toBeNull();
    expect(map.selection.value).toEqual([]);
    expect(engine.interaction).toBe('none');

    map.selection.set([uuid(10)]);
    const dragging = map.dragObject(uuid(10));
    const from = engine.pixelOf([15, 60]);
    engine.pointer('down', from);
    engine.pointer('move', [from[0] + 30, from[1]]);
    engine.escape();
    expect(await dragging).toBeNull();
    expect(map.selection.value).toEqual([uuid(10)]);
    engine.escape();
    expect(map.selection.value).toEqual([]);
  });

  it("criterion 41 with draw-symbols' placing: pickPoint replaces the waiting drag, the first Escape ends it, the re-armed wait and the selection go with the second (owner, 2026-10-20)", async () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    map.selection.set([uuid(10)]);
    const waiting = map.dragObject(uuid(10));
    const placing = map.pickPoint();
    expect(await waiting).toBeNull(); // one interaction at a time
    engine.escape();
    expect(await placing).toBeNull();
    expect(map.selection.value).toEqual([uuid(10)]);
    const rearmed = map.dragObject(uuid(10)); // draw-symbols arms the wait again for the selected symbol
    engine.escape();
    expect(await rearmed).toBeNull();
    expect(map.selection.value).toEqual([]);
  });

  it('a press beside the object does not start the drag', async () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    const result = map.dragObject(uuid(10));
    const away = engine.pixelOf([25, 65]);
    engine.pointer('down', away);
    engine.pointer('up', [away[0] + 50, away[1]]);
    expect(engine.interaction).toBe('drag-object');
    engine.escape();
    expect(await result).toBeNull();
  });

  it('ends the drag with null when the object is deleted meanwhile, or does not exist', async () => {
    const { controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    const result = map.dragObject(uuid(10));
    controller.listener.changes([event(2, null, { id: uuid(10), type: 'object' })]);
    expect(await result).toBeNull();
    expect(await map.dragObject(uuid(77))).toBeNull();
  });
});

describe('map controller: panning while an object can be dragged (MCA review B1)', () => {
  function armed() {
    const ctx = setup();
    ctx.controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    const result = ctx.map.dragObject(uuid(10));
    return { ...ctx, result, object: ctx.engine.pixelOf([15, 60]), empty: ctx.engine.pixelOf([25, 65]) };
  }

  it('with dragObject armed, a press on the empty map pans', () => {
    const { engine, empty } = armed();
    expect(engine.pansOnPress(empty)).toBe(true);
  });

  it('a press on the object drags it and does not pan', async () => {
    const { engine, object, result } = armed();
    expect(engine.pansOnPress(object)).toBe(false);
    engine.pointer('down', object);
    engine.pointer('move', [object[0] + 20, object[1]]);
    engine.pointer('up', [object[0] + 40, object[1]]);
    expect(await result).not.toBeNull();
  });

  it('a pan on the empty map neither drags nor ends the interaction', () => {
    const { engine, empty } = armed();
    engine.pointer('down', empty);
    engine.pointer('move', [empty[0] + 50, empty[1]]);
    engine.pointer('up', [empty[0] + 80, empty[1]]);
    expect(engine.dragPreview).toBeNull();
    expect(engine.interaction).toBe('drag-object');
  });

  it('pans everywhere again after the drop', async () => {
    const { engine, object, result } = armed();
    engine.pointer('down', object);
    engine.pointer('move', [object[0] + 20, object[1]]);
    engine.pointer('up', [object[0] + 20, object[1]]);
    await result;
    expect(engine.pansOnPress(object)).toBe(true);
    expect(engine.grabTest).toBeNull();
  });

  it('pans everywhere again after Escape, a new interaction, the deletion, a projection change and dispose', async () => {
    const endings: ((c: ReturnType<typeof armed>) => void)[] = [
      (c) => {
        c.engine.escape();
      },
      (c) => void c.map.pickPoint(),
      (c) => {
        c.controller.listener.changes([event(2, null, { id: uuid(10), type: 'object' })]);
      },
      (c) => {
        c.controller.setProjection('EPSG:3413');
      },
      (c) => {
        c.controller.dispose();
      },
    ];
    for (const end of endings) {
      const c = armed();
      c.engine.pointer('down', c.object); // a grab in progress
      end(c);
      expect(await c.result).toBeNull();
      expect(c.engine.grabTest).toBeNull();
      expect(c.engine.dragPreview).toBeNull();
    }
  });

  it('a release without a move, or a cancelled pointer, drops nothing and keeps the object draggable', async () => {
    const { engine, object, result } = armed();
    engine.pointer('down', object);
    engine.pointer('up', object);
    engine.pointer('down', object);
    engine.pointer('move', [object[0] + 20, object[1]]);
    engine.pointer('cancel', [object[0] + 20, object[1]]);
    expect(engine.dragPreview).toBeNull();
    expect(engine.interaction).toBe('drag-object');
    engine.pointer('down', object);
    engine.pointer('move', [object[0] + 30, object[1]]);
    engine.pointer('up', [object[0] + 30, object[1]]);
    expect(await result).not.toBeNull();
  });
});

describe('map controller: dragging an object that moved since the drag was prepared (ACA bug, 2026-10-09)', () => {
  function drag(engine: FakeEngine, from: Position, to: Position): void {
    engine.pointer('down', engine.pixelOf(from));
    engine.pointer('move', engine.pixelOf(to));
    engine.pointer('up', engine.pixelOf(to));
  }

  function near(actual: Position | null, expected: Position): void {
    expect(actual?.[0]).toBeCloseTo(expected[0], 6);
    expect(actual?.[1]).toBeCloseTo(expected[1], 6);
  }

  it('takes the object where it is at the press, not where it was when the drag was prepared', async () => {
    const { engine, clock, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    const result = map.dragObject(uuid(10));
    // The object moves (as the live picture reports it) before the user presses on it.
    controller.listener.changes([event(2, { ...symbolObject(10, A.id, 17, 61), version: 2 })]);
    clock.advance(0);
    drag(engine, [17, 61], [18, 61.5]); // grabbed at its new place, dragged by a delta
    near(await result, [18, 61.5]);
  });

  it('criterion 7: two drags in a row land where they are dropped (draw-symbols prepares the second drag before the first update arrives)', async () => {
    const { engine, clock, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    const first = map.dragObject(uuid(10));
    drag(engine, [15, 60], [16, 60]);
    const dropped = await first;
    near(dropped, [16, 60]);
    // draw-symbols arms the next drag at once, then sends its update; the change event follows.
    const second = map.dragObject(uuid(10));
    controller.listener.changes([event(2, { ...symbolObject(10, A.id, dropped?.[0] ?? 0, dropped?.[1] ?? 0), version: 2 })]);
    clock.advance(1000);
    drag(engine, [16, 60], [16.5, 60]);
    near(await second, [16.5, 60]);
  });
});

describe("map controller: the symbol size is the user's (brief function 35, criterion 77)", () => {
  it("starts with the shell's display settings, follows a change, and keeps the size through a change of settings", () => {
    const { engine, controller } = setup();
    const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
    expect(engine.symbolOptions).toEqual({ symbolSize: DEFAULT_DISPLAY.symbolSize, textThreshold: DEFAULT_SETTINGS.textThreshold });
    expect(engine.displayOptions).toEqual({ labelPlaces: DEFAULT_DISPLAY.labelPlaces, directionArrow: true, speedVectorSeconds: 0 });
    controller.setDisplay({ symbolSize: 22, speedVectorMinutes: 5, speedVectorSeconds: 300, labels: ['name', 'direction'], labelPlaces: { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null, below: 'name' }, directionArrow: true, relations: {}, classes: DEFAULT_DISPLAY.classes });
    expect(engine.symbolOptions?.symbolSize).toBe(22);
    // The shell's places and arrow: name below, the arrow on.
    expect(engine.displayOptions).toEqual({ labelPlaces: { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null, below: 'name' }, directionArrow: true, speedVectorSeconds: 300 });
    const places = { topLeft: 'type', topRight: null, bottomLeft: null, bottomRight: 'speed', below: null } as const;
    controller.setDisplay({ symbolSize: 22, speedVectorMinutes: 5, speedVectorSeconds: 300, labels: ['type', 'speed'], labelPlaces: places, directionArrow: false, relations: {}, classes: DEFAULT_DISPLAY.classes });
    expect(engine.displayOptions).toEqual({ labelPlaces: places, directionArrow: false, speedVectorSeconds: 300 });
    // A new text threshold keeps the user's size.
    controller.setSettings({ ...DEFAULT_SETTINGS, textThreshold: 500 }, projections);
    expect(engine.symbolOptions).toEqual({ symbolSize: 22, textThreshold: 500 });
  });
});

describe('map controller: overlays (brief function 8)', () => {
  it('draws each plugin overlay as data, lines densified, and clears it', () => {
    const { engine, map } = setup();
    const one = map.createOverlay();
    const two = map.createOverlay();
    one.set([
      { kind: 'point', position: [15, 60] },
      { kind: 'line', positions: [[10, 60], [30, 62]] },
      { kind: 'symbol', position: [16, 61], symbol: INFANTRY },
    ]);
    two.set([{ kind: 'point', position: [1, 2] }]);
    expect(engine.overlays.size).toBe(2);
    const items = [...engine.overlays.values()][0] ?? [];
    expect(items.map((i) => i.kind)).toEqual(['point', 'line', 'symbol']);
    const line = items[1];
    expect(line?.kind === 'line' ? line.positions.length : 0).toBeGreaterThan(2);
    one.clear();
    expect(engine.overlays.size).toBe(1);
  });

  it('leaves out invalid items, and draws nothing of an overlay the SDK refuses (part 6)', () => {
    const { engine, map, ctx } = setup();
    const overlay = map.createOverlay();
    overlay.set([{ kind: 'point', position: [15, 95] }, { kind: 'line', positions: [[1, 2]] }, { kind: 'point', position: [15, 60] }]);
    expect([...engine.overlays.values()][0]).toHaveLength(1);
    overlay.set(Array.from({ length: OVERLAY_MAX_ITEMS + 1 }, () => ({ kind: 'point' as const, position: [15, 60] as const })));
    expect(engine.overlays.size).toBe(0); // nothing drawn, not the first 20 000
    expect(ctx.logs.filter((l) => l.level === 'warn')).toHaveLength(2);
    overlay.set([{ kind: 'point', position: [15, 60] }]);
    expect([...engine.overlays.values()][0]).toHaveLength(1); // the next `set` draws again
  });

  it('draws an area with its holes as a polygon, and a label as text (part 6)', () => {
    const { engine, map } = setup();
    const LABEL_TEXT = ['Range 12 km', 'bearing 45'].join('\n'); // a line break starts a new line
    const outer: Position[] = [[10, 58], [12, 58], [12, 60], [10, 60], [10, 58]];
    const hole: Position[] = [[10.5, 58.5], [10.5, 59.5], [11.5, 59.5], [11.5, 58.5], [10.5, 58.5]];
    const style = { fillColor: '#3366ff', fillOpacity: 0.4, fillPattern: 'hatch' } as const;
    map.createOverlay().set([
      { kind: 'area', rings: [outer, hole], style },
      { kind: 'label', position: [11, 59], text: LABEL_TEXT, style: { color: '#ff0000', size: 20, haloColor: '#000000' } },
    ]);
    const [area, label] = [...engine.overlays.values()][0] ?? [];
    expect(area?.kind).toBe('polygon');
    if (area?.kind === 'polygon') {
      expect(area.rings).toHaveLength(2);
      expect(area.rings[0]?.length).toBeGreaterThan(5); // the edges are densified
      expect(area.rings[0]?.at(-1)).toEqual(area.rings[0]?.[0]);
      expect(area.style).toBe(style);
    }
    expect(label).toMatchObject({ kind: 'text', position: [11, 59], text: LABEL_TEXT, style: { size: 20 } });
  });

  it('refuses an area ring that is not closed, a label without text, and a label size out of range', () => {
    const { engine, map, ctx } = setup();
    const overlay = map.createOverlay();
    const open: Position[] = [[10, 58], [12, 58], [12, 60], [10, 60]];
    const refused: OverlayItem[][] = [
      [{ kind: 'area', rings: [open] }],
      [{ kind: 'area', rings: [] }],
      [{ kind: 'label', position: [11, 59], text: '' }],
      [{ kind: 'label', position: [11, 59], text: 'x', style: { size: 40 } }],
    ];
    for (const items of refused) {
      overlay.set(items);
      expect(engine.overlays.size).toBe(0);
    }
    expect(ctx.logs.filter((l) => l.level === 'warn')).toHaveLength(4);
  });
});

describe('map controller: shared state (brief function 8)', () => {
  it('shares the selection and the active layer, telling listeners only about changes', () => {
    const { map } = setup();
    const selection = vi.fn();
    const active = vi.fn();
    map.selection.onChange(selection);
    map.activeLayer.onChange(active);
    map.selection.set([uuid(1), uuid(2)]);
    map.selection.set([uuid(1), uuid(2)]);
    map.activeLayer.set(A.id);
    map.activeLayer.set(A.id);
    expect(selection).toHaveBeenCalledTimes(1);
    expect(active).toHaveBeenCalledTimes(1);
    expect(map.activeLayer.value).toBe(A.id);
  });

  it('removes deleted objects from the selection; leaves the active layer to its owner (layer panel)', () => {
    const { controller, map } = setup();
    controller.listener.snapshot({ layers: [A, B], objects: [symbolObject(10, A.id, 15, 60), symbolObject(11, A.id, 15, 60)], sequenceNo: 1 });
    map.selection.set([uuid(10), uuid(11)]);
    map.activeLayer.set(B.id);
    controller.listener.changes([event(2, null, { id: uuid(10), type: 'object' }), event(3, null, { id: B.id, type: 'layer' })]);
    expect(map.selection.value).toEqual([uuid(11)]);
    expect(map.activeLayer.value).toBe(B.id);
  });

  it('a listener that throws is logged and the others still run', () => {
    const { map, ctx } = setup();
    const second = vi.fn();
    map.selection.onChange(() => {
      throw new Error('bad listener');
    });
    map.selection.onChange(second);
    map.selection.set([uuid(1)]);
    expect(second).toHaveBeenCalled();
    expect(ctx.logs.some((l) => l.level === 'error')).toBe(true);
  });
});

describe('map controller: projections (brief function 2, criterion 4)', () => {
  it('switches projection keeping the centre and the metres per pixel', () => {
    const { controller, map } = setup();
    map.goTo([15, 75], 1000);
    controller.setProjection('EPSG:3413');
    expect(map.viewport.projection).toBe('EPSG:3413');
    expect(map.viewport.center[0]).toBeCloseTo(15, 6);
    expect(map.viewport.center[1]).toBeCloseTo(75, 6);
    expect(map.viewport.resolution).toBeCloseTo(1000, 0);
  });

  it('moves the centre into the new projection when it is outside (60° E 15° N → 30° N in EPSG:3413, then into its extent)', () => {
    const { engine, controller, map } = setup();
    map.goTo([60, 15]);
    controller.setProjection('EPSG:3413');
    // 30° N 60° E is in the world extent but beyond the extent on x: the nearest point the map can show.
    const [, ey] = textbook.polarStereographic3413(60, 30);
    expect(engine.view?.center[0]).toBeCloseTo(4_194_304, 3);
    expect(engine.view?.center[1]).toBeCloseTo(ey, 2);
    const shown = engine.projection.inverse(engine.view?.center ?? [0, 0]);
    expect(map.viewport.center[0]).toBeCloseTo(shown?.[0] ?? Number.NaN, 9);
    expect(map.viewport.center[1]).toBeCloseTo(shown?.[1] ?? Number.NaN, 9);
    expect(map.viewport.center[1]).toBeGreaterThan(30);
  });

  it('ignores an unknown projection', () => {
    const { controller } = setup();
    controller.setProjection('EPSG:9999');
    expect(controller.projectionCode).toBe('EPSG:3857');
    expect(controller.projectionCodes).toEqual(['EPSG:3857', 'EPSG:3413', 'EPSG:3031']);
  });
});

describe('map controller: background maps (brief function 3)', () => {
  it('shows the first compatible provider and none when the projection has none', () => {
    const { engine, controller } = setup();
    const osm = provider('basemap-osm', ['EPSG:3857']);
    controller.setProviders([osm]);
    expect(engine.background).toBe(osm);
    expect(controller.backgrounds).toEqual([osm]);
    controller.setProjection('EPSG:3413');
    expect(engine.background).toBeNull();
    controller.setProjection('EPSG:3857');
    expect(engine.background).toBe(osm);
  });

  it('follows the user choice, including "none"', () => {
    const { engine, controller } = setup();
    const a = provider('a', ['EPSG:3857']);
    const b = provider('b', ['EPSG:3857']);
    controller.setProviders([a, b]);
    controller.chooseBackground('b');
    expect(engine.background).toBe(b);
    controller.chooseBackground(null);
    expect(engine.background).toBeNull();
    expect(controller.background).toBeNull();
  });

  function memoryChoices(initial: BackgroundChoices = {}): ChoiceStore & { kept: BackgroundChoices } {
    const store = {
      kept: initial,
      load: () => store.kept,
      save: (choices: BackgroundChoices) => {
        store.kept = choices;
      },
    };
    return store;
  }
  const osm = { ...provider('basemap-osm', ['EPSG:3857']), name: 'OpenStreetMap' };
  const naturalEarth = createFakeVectorBackground([], { id: 'basemap-naturalearth', name: 'Natural Earth' });

  it('criterion 18: OpenStreetMap chosen in EPSG:3857, Natural Earth in EPSG:3413, OpenStreetMap again on return', () => {
    const { engine, controller } = setup();
    controller.setProviders([naturalEarth, osm]);
    controller.chooseBackground('basemap-osm');
    expect(engine.background).toBe(osm);
    controller.setProjection('EPSG:3413');
    expect(controller.background).toBe(naturalEarth); // chosen; drawn once loaded (function 11)
    controller.setProjection('EPSG:3857');
    expect(engine.background).toBe(osm); // Natural Earth fits EPSG:3857 too, but the user chose OpenStreetMap
  });

  it('function 3: starts with the preferred order, and with Natural Earth where OpenStreetMap is not installed', () => {
    const first = setup();
    first.controller.setProviders([naturalEarth, osm]);
    expect(first.engine.background).toBe(osm);
    const disconnected = setup();
    disconnected.controller.setProviders([naturalEarth]);
    expect(disconnected.controller.background).toBe(naturalEarth);
  });

  it('function 3: takes the last choice made in the projection switched to, kept per browser across page loads', () => {
    const arctic = provider('arctic', ['EPSG:3413']);
    const choices = memoryChoices();
    const { engine, controller } = setup({ choices });
    controller.setProviders([naturalEarth, osm, arctic]);
    controller.setProjection('EPSG:3413');
    controller.chooseBackground('arctic');
    controller.setProjection('EPSG:3857');
    controller.chooseBackground('basemap-osm');
    controller.setProjection('EPSG:3413');
    expect(engine.background).toBe(arctic);
    expect(choices.kept).toEqual({ 'EPSG:3413': 'arctic', 'EPSG:3857': 'basemap-osm' });

    // A new page in this browser.
    const again = setup({ choices });
    again.controller.setProviders([naturalEarth, osm, arctic]);
    again.controller.setProjection('EPSG:3413');
    expect(again.engine.background).toBe(arctic);
  });

  const land = { layer: 'land', geometry: { type: 'Polygon' as const, coordinates: [[[0, 50], [10, 50], [10, 60], [0, 60], [0, 50]] as Position[]] } };

  it('function 11: loads a vector background once, when it is first shown, and draws it once it has arrived', async () => {
    const { engine, controller } = setup();
    const background = createFakeVectorBackground([land], { id: 'basemap-naturalearth', name: 'Natural Earth' });
    controller.setProviders([osm, background]);
    expect(background.loadCalls).toBe(0); // OpenStreetMap is shown: Natural Earth is not loaded
    controller.chooseBackground('basemap-naturalearth');
    expect(background.loadCalls).toBe(1);
    expect(engine.backgroundShown).toBeNull(); // the graticule while it loads
    controller.setProjection('EPSG:3413'); // switching while it loads does not load it again
    controller.setProjection('EPSG:3857');
    expect(background.loadCalls).toBe(1);
    await vi.waitFor(() => {
      expect(engine.backgroundShown?.kind).toBe('vector');
    });
    const shown = engine.backgroundShown;
    if (shown?.kind !== 'vector') throw new Error('no vector background');
    expect(shown.data.projection).toBe('EPSG:3857');
    expect(shown.data.layers.find((l) => l.id === 'land')?.polygons).toHaveLength(1);
    expect(controller.backgroundProblem).toBeNull();
  });

  it('function 11: a projection switch projects the vector data again without loading it again, and reuses it on return', async () => {
    const { engine, controller } = setup();
    const background = createFakeVectorBackground([land], { id: 'basemap-naturalearth', name: 'Natural Earth' });
    controller.setProviders([background]);
    await vi.waitFor(() => {
      expect(engine.backgroundShown?.kind).toBe('vector');
    });
    const inMercator = engine.backgroundShown?.kind === 'vector' ? engine.backgroundShown.data : null;
    controller.setProjection('EPSG:3413');
    expect(engine.backgroundShown?.kind === 'vector' && engine.backgroundShown.data.projection).toBe('EPSG:3413');
    controller.setProjection('EPSG:3031');
    expect(engine.backgroundShown?.kind === 'vector' && engine.backgroundShown.data.projection).toBe('EPSG:3031');
    controller.setProjection('EPSG:3857');
    expect(engine.backgroundShown?.kind === 'vector' && engine.backgroundShown.data).toBe(inMercator); // prepared once per projection
    expect(background.loadCalls).toBe(1);
  });

  it('function 11: a rejected load() shows "background unavailable" and the graticule, without breaking the map, and is not tried again', async () => {
    const { engine, controller, ctx } = setup();
    let calls = 0;
    const broken: BackgroundMapProvider = {
      ...naturalEarth,
      source: { ...(naturalEarth.source as VectorSource), load: () => { calls++; return Promise.reject(new Error('404')); } },
    };
    controller.setProviders([broken]);
    await vi.waitFor(() => {
      expect(controller.backgroundProblem).toBe('Background unavailable: Natural Earth');
    });
    expect(engine.backgroundShown).toBeNull();
    expect(ctx.logs.some((l) => l.level === 'warn' && l.message.includes('could not be loaded'))).toBe(true);
    controller.setProjection('EPSG:3413');
    controller.setProjection('EPSG:3857');
    expect(calls).toBe(1);
    controller.chooseBackground(null);
    expect(controller.backgroundProblem).toBeNull();
  });

  it('function 11: a load() that throws, or resolves to something else, is a failed load too', async () => {
    for (const load of [() => { throw new Error('boom'); }, () => Promise.resolve({ nothing: true })]) {
      const { controller } = setup();
      const odd = { ...naturalEarth, source: { ...(naturalEarth.source as VectorSource), load } } as unknown as BackgroundMapProvider;
      controller.setProviders([odd]);
      await vi.waitFor(() => {
        expect(controller.backgroundProblem).toBe('Background unavailable: Natural Earth');
      });
    }
  });

  it('function 3: "None" chosen by the user stays when switching', () => {
    const { engine, controller } = setup();
    controller.setProviders([naturalEarth, osm]);
    controller.chooseBackground(null);
    controller.setProjection('EPSG:3413');
    expect(engine.background).toBeNull();
  });

  it('criterion 11: refuses a provider whose tiles are not on the emc2 server, and says so once', () => {
    const { engine, controller, ctx } = setup();
    const external = provider('evil', ['EPSG:3857'], 'https://tile.example.org/{z}/{x}/{y}.png');
    controller.setProviders([external]);
    controller.setProviders([external]);
    expect(engine.calls.setBackground).toBe(0); // stays at the neutral background it starts with
    expect(controller.backgrounds).toEqual([]);
    expect(ctx.logs.filter((l) => l.level === 'warn' && l.message.includes('evil'))).toHaveLength(1);
  });

  it('tells the Map Pane controls about changes', () => {
    const { controller } = setup();
    const changes = vi.fn();
    controller.onStateChange(changes);
    controller.setProjection('EPSG:3413');
    expect(changes).toHaveBeenCalled();
  });
});

describe('map controller: large live pictures (criterion 8, logic only; frame rates are the ITA browser tests)', () => {
  it('criterion 8: hands all 100 000 symbols of a snapshot to the engine in one go, as one shared appearance', () => {
    const { engine, controller } = setup({ mode: 'software' });
    const objects = Array.from({ length: 100_000 }, (_, i) => symbolObject(1000 + i, A.id, 5 + (i % 250) / 10, 55 + Math.floor(i / 250) / 30));
    controller.listener.snapshot({ layers: [A], objects, sequenceNo: 1 });
    expect(engine.calls.replaceItems).toBe(1);
    const items = [...(engine.items.get(A.id)?.values() ?? [])];
    expect(items).toHaveLength(100_000); // without a GPU too: nothing is dropped
    expect(new Set(items.map((i) => (i.kind === 'symbol' ? i.appearance : i.kind))).size).toBe(1);
  });
});

describe('map controller: rendering (brief function 9)', () => {
  it('tells other plugins how the map is drawn', () => {
    const { map } = setup({ mode: 'software' });
    expect(map.renderingMode).toBe('software');
    expect(map.renderer).toBe('Test GPU');
  });
});

describe('map controller: the MapView service', () => {
  it('criterion 12: offers exactly the SDK members, as plain data and functions', () => {
    const { map } = setup();
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.keys(map).sort()).toEqual([
      'activeLayer', 'append', 'centreOn', 'createFadeList', 'createOverlay', 'dragObject', 'draw', 'edit', 'goTo', 'isLayerVisible', 'mapType', 'onLayerVisibilityChange',
      'onMapTypeChange', 'onPointer', 'onViewportChange', 'pick', 'pickPoint', 'renderer', 'renderingMode', 'selection', 'setLayerVisible',
      'setMapType', 'viewport', 'zoomTo',
    ]);
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
    expect(plain(map.viewport)).toEqual(map.viewport);
    expect(Object.getPrototypeOf(map.viewport)).toBe(Object.prototype);
    expect(plain(map.mapType)).toEqual(map.mapType);
    expect(Object.getPrototypeOf(map.mapType)).toBe(Object.prototype);
  });

  it('stops listening to the engine when disposed', async () => {
    const { engine, controller, map } = setup();
    const pending = map.pickPoint();
    controller.dispose();
    expect(await pending).toBeNull();
    expect(engine.listenerCount).toBe(0);
  });
});

describe('map controller: area of interest and clusters (brief function 12)', () => {
  function cluster(cell: string, position: Position, byLayer: Record<string, number>, byIdentity = { friend: 0, hostile: 0, neutral: 0, unknown: 0 }): Cluster {
    const count = Object.values(byLayer).reduce((a, b) => a + b, 0);
    const identity = Object.values(byIdentity).some((n) => n > 0) ? byIdentity : { ...byIdentity, unknown: count };
    return { cell, position, count, byLayer, byIdentity: identity };
  }

  it('criteria 20 and 40: objects that left the area disappear from the map and the highlight but stay selected; objects that entered appear', () => {
    const { engine, clock, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60), symbolObject(11, A.id, 16, 61)], sequenceNo: 1 });
    map.selection.set([uuid(10), uuid(11)]);
    controller.listener.area?.({ sequenceNo: 2, entered: [symbolObject(12, A.id, 17, 62)], left: [uuid(10)] });
    clock.advance(1000);
    expect(engine.idsIn(A.id).sort()).toEqual([uuid(11), uuid(12)]);
    expect(map.selection.value).toEqual([uuid(10), uuid(11)]);
    expect(engine.highlighted).toEqual([uuid(11)]);
    expect(controller.store.objects.has(uuid(10))).toBe(false);
    // Back in the area, it is highlighted again.
    controller.listener.area?.({ sequenceNo: 3, entered: [symbolObject(10, A.id, 15, 60)], left: [] });
    clock.advance(1000);
    expect(engine.highlighted.sort()).toEqual([uuid(10), uuid(11)]);
  });

  it('criterion 20: an object that leaves while it is dragged ends the drag with null, as a deleted one does', async () => {
    const { controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    const drop = map.dragObject(uuid(10));
    controller.listener.area?.({ sequenceNo: 2, entered: [], left: [uuid(10)] });
    expect(await drop).toBeNull();
  });

  it('in area mode, a change for an object it does not hold adds it, and a delete for one it does not hold changes nothing', () => {
    const { engine, clock, controller } = setup();
    controller.listener.snapshot({ layers: [A], objects: [], sequenceNo: 1 });
    controller.listener.changes([event(2, symbolObject(10, A.id, 15, 60)), event(3, null, { id: uuid(99), type: 'object' })]);
    clock.advance(1000);
    expect(engine.idsIn(A.id)).toEqual([uuid(10)]);
  });

  it('criterion 21: draws the clusters with their counts, split by identity', () => {
    const { engine, controller } = setup();
    controller.listener.snapshot({ layers: [A, B], objects: [], sequenceNo: 1 });
    controller.listener.clusters?.({ level: 6, full: true, upsert: [cluster('c1', [15, 60], { [A.id]: 30, [B.id]: 10 }, { friend: 20, hostile: 10, neutral: 5, unknown: 5 })], remove: [] });
    expect(engine.clusters).toEqual([{ cell: 'c1', position: [15, 60], count: 40, identity: { friend: 20, hostile: 10, neutral: 5, unknown: 5 } }]);
  });

  it('criterion 21: hiding a layer locally lowers the counts at once, without asking the server; an emptied cluster goes', () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A, B], objects: [], sequenceNo: 1 });
    controller.listener.clusters?.({
      level: 6, full: true, remove: [],
      upsert: [cluster('c1', [15, 60], { [A.id]: 30, [B.id]: 10 }, { friend: 20, hostile: 20, neutral: 0, unknown: 0 }), cluster('c2', [20, 62], { [B.id]: 7 })],
    });
    map.setLayerVisible(B.id, false);
    expect(engine.clusters.map((c) => [c.cell, c.count])).toEqual([['c1', 30]]);
    // The identity split is scaled in proportion (owner, 2026-10-11): byLayer and byIdentity are separate totals.
    expect(engine.clusters[0]?.identity).toEqual({ friend: 15, hostile: 15, neutral: 0, unknown: 0 });
    map.setLayerVisible(B.id, true);
    expect(engine.clusters.map((c) => [c.cell, c.count])).toEqual([['c1', 40], ['c2', 7]]);
  });

  it('criterion 21: applies changed and removed clusters, replaces them on a full set or a new level, and drops them on a snapshot', () => {
    const { engine, controller } = setup();
    controller.listener.snapshot({ layers: [A], objects: [], sequenceNo: 1 });
    const send = (update: Partial<ClusterUpdate>) => controller.listener.clusters?.({ level: 6, full: false, upsert: [], remove: [], ...update });
    const cells = () => engine.clusters.map((c) => `${c.cell}:${String(c.count)}`);
    send({ full: true, upsert: [cluster('a', [15, 60], { [A.id]: 5 }), cluster('b', [16, 60], { [A.id]: 6 })] });
    send({ upsert: [cluster('a', [15, 60], { [A.id]: 9 }), cluster('c', [17, 60], { [A.id]: 4 })], remove: ['b'] });
    expect(cells()).toEqual(['a:9', 'c:4']);
    send({ full: true, upsert: [cluster('d', [18, 60], { [A.id]: 3 })] });
    expect(cells()).toEqual(['d:3']);
    send({ level: 7, upsert: [cluster('e', [18, 60], { [A.id]: 2 })] });
    expect(cells()).toEqual(['e:2']);
    controller.listener.snapshot({ layers: [A], objects: [], sequenceNo: 9 });
    expect(engine.clusters).toEqual([]);
  });

  it('a cluster outside the projection\'s world extent is not drawn there, nor clicked; it is again in a projection that shows it (owner, 2026-10-12)', () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [], sequenceNo: 1 });
    // As in the browser check: zoomed out in EPSG:3413, the area reaches far into the south.
    controller.listener.clusters?.({ level: 3, full: true, upsert: [cluster('north', [15, 61], { [A.id]: 40 }), cluster('south', [18, -29], { [A.id]: 900 })], remove: [] });
    expect(engine.clusters.map((c) => c.cell)).toEqual(['north', 'south']); // EPSG:3857 shows both
    controller.setProjection('EPSG:3413');
    expect(engine.clusters.map((c) => c.cell)).toEqual(['north']);
    const before = map.viewport.resolution;
    engine.pointer('click', engine.pixelOf([18, -29]));
    expect(map.viewport.resolution).toBeCloseTo(before, 6); // nothing there to zoom in on
    controller.listener.clusters?.({ level: 3, full: false, upsert: [cluster('south2', [20, -40], { [A.id]: 5 })], remove: [] });
    expect(engine.clusters.map((c) => c.cell)).toEqual(['north']);
    engine.pointer('click', engine.pixelOf([15, 61])); // the cluster it shows is still clicked
    expect(map.viewport.resolution).toBeCloseTo(before / 4, 0);
    controller.setProjection('EPSG:3857');
    expect(engine.clusters.map((c) => c.cell).sort()).toEqual(['north', 'south', 'south2']);
  });

  it('criterion 21: a click on a cluster zooms in on it; it is never picked, and while a point is picked it does not zoom', async () => {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [], sequenceNo: 1 });
    controller.listener.clusters?.({ level: 6, full: true, upsert: [cluster('c1', [16, 61], { [A.id]: 500 })], remove: [] });
    const before = map.viewport.resolution;
    const pixel = engine.pixelOf([16, 61]);
    expect(map.pick(pixel)).toEqual([]);
    const picking = map.pickPoint();
    engine.pointer('click', [pixel[0] + 3, pixel[1]]);
    expect(await picking).not.toBeNull();
    expect(map.viewport.resolution).toBeCloseTo(before, 6);
    engine.pointer('click', [pixel[0] + 3, pixel[1]]);
    expect(map.viewport.resolution).toBeCloseTo(before / 4, 0);
    expect(map.viewport.center[0]).toBeCloseTo(16, 6);
    expect(map.viewport.center[1]).toBeCloseTo(61, 6);
  });

  it('criterion 21: a double-click on a cluster zooms in on it once (owner, 2026-10-13, review R2)', () => {
    const { engine, clock, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [], sequenceNo: 1 });
    // At the centre, so the cluster is still under the pointer after the first zoom.
    const [lon, lat] = map.viewport.center;
    expect(lat).not.toBeCloseTo(lon, 0);
    controller.listener.clusters?.({ level: 6, full: true, upsert: [cluster('c1', [lon, lat], { [A.id]: 500 })], remove: [] });
    const before = map.viewport.resolution;
    const pixel = engine.pixelOf([lon, lat]);
    engine.pointer('click', pixel);
    expect(map.viewport.resolution).toBeCloseTo(before / CLUSTER_ZOOM_FACTOR, 0);
    expect(engine.doubleClickZoomPauses).toBe(1); // OpenLayers' double-click zoom does not add to it
    clock.advance(CLUSTER_CLICK_GRACE_MS - 1);
    engine.pointer('click', pixel); // the second click of the double-click
    expect(map.viewport.resolution).toBeCloseTo(before / CLUSTER_ZOOM_FACTOR, 0);
    expect(engine.doubleClickZoomPauses).toBe(1);
    clock.advance(1);
    engine.pointer('click', pixel); // a click of its own
    expect(map.viewport.resolution).toBeCloseTo(before / CLUSTER_ZOOM_FACTOR ** 2, 0);
    expect(engine.doubleClickZoomPauses).toBe(2);
  });

  it('criterion 22: draws the single objects and the clusters it gets, never the clustered objects one by one (200 000 objects, budget 10 000)', () => {
    const { engine, clock, controller } = setup({ mode: 'software' });
    // As spike S3 measured at 200 000 objects zoomed out: about 4 100 drawn items, singles and clusters.
    const singles = Array.from({ length: 1000 }, (_, i) => symbolObject(1000 + i, A.id, 5 + (i % 50) / 5, 55 + Math.floor(i / 50) / 5));
    const clusters = Array.from({ length: 3100 }, (_, i) => cluster(`c${String(i)}`, [-170 + (i % 100) * 3.4, -60 + Math.floor(i / 100) * 4], { [A.id]: 64 }));
    controller.listener.snapshot({ layers: [A], objects: singles, sequenceNo: 1 });
    controller.listener.clusters?.({ level: 6, full: true, upsert: clusters, remove: [] });
    clock.advance(1000);
    const represented = singles.length + clusters.reduce((sum, c) => sum + c.count, 0);
    expect(represented).toBeGreaterThanOrEqual(199_000);
    const drawn = (engine.items.get(A.id)?.size ?? 0) + engine.clusters.length;
    expect(drawn).toBe(4100);
    expect(drawn).toBeLessThanOrEqual(DEFAULT_SETTINGS.softwareBudget);
  });
});

describe('map controller: expired objects (brief function 13)', () => {
  const fadedIn = (engine: FakeEngine, id: string) => engine.items.get(A.id)?.get(id)?.faded === true;

  it('criterion 23: an object expiring in 2 s is drawn normally, then faded within 1 s after its expiry, without any change event', () => {
    const { engine, clock, controller } = setup({ dataTypes: [cotDataType()] });
    controller.listener.snapshot({ layers: [A], objects: [cotObject(10, A.id, 15, 60, 2000)], sequenceNo: 1 });
    expect(fadedIn(engine, uuid(10))).toBe(false);
    clock.advance(1999);
    expect(fadedIn(engine, uuid(10))).toBe(false);
    clock.advance(1000); // at most 1 s after the expiry
    expect(fadedIn(engine, uuid(10))).toBe(true);
    expect(engine.calls.replaceItems).toBe(1); // no change event: only that object was drawn again
  });

  it('criterion 23: switching fadeWhenExpired off draws it normally again at once, and on again fades it at once', () => {
    const { engine, controller } = setup({ dataTypes: [cotDataType()] });
    controller.listener.snapshot({ layers: [A], objects: [cotObject(10, A.id, 15, 60, -1000)], sequenceNo: 1 });
    expect(fadedIn(engine, uuid(10))).toBe(true);
    controller.setDataTypes([cotDataType({ fadeWhenExpired: false })]);
    expect(fadedIn(engine, uuid(10))).toBe(false);
    controller.setDataTypes([cotDataType()]);
    expect(fadedIn(engine, uuid(10))).toBe(true);
  });

  it('criterion 23: a core.general object (no expiry) is never faded, nor is one whose data type is not available', () => {
    const { engine, clock, controller } = setup({ dataTypes: [cotDataType()] });
    const orphan = { ...cotObject(11, A.id, 16, 60, -1000), dataType: 'removed-plugin.track' };
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60), orphan], sequenceNo: 1 });
    clock.advance(3_600_000);
    expect(fadedIn(engine, uuid(10))).toBe(false);
    expect(fadedIn(engine, uuid(11))).toBe(false);
  });

  it('fades the highlight alike, and a faded object stays pickable and selectable', () => {
    const { engine, clock, controller, map } = setup({ dataTypes: [cotDataType()] });
    controller.listener.snapshot({ layers: [A], objects: [cotObject(10, A.id, 15, 60, 500)], sequenceNo: 1 });
    map.selection.set([uuid(10)]);
    expect(engine.highlight[0]?.faded).toBeUndefined();
    clock.advance(1000);
    expect(engine.highlight[0]?.faded).toBe(true);
    expect(map.pick(engine.pixelOf([15, 60]))).toEqual([uuid(10)]);
  });

  it('a change that moves the expiry later draws the object normally again', () => {
    const { engine, clock, controller } = setup({ dataTypes: [cotDataType()] });
    controller.listener.snapshot({ layers: [A], objects: [cotObject(10, A.id, 15, 60, -1000)], sequenceNo: 1 });
    controller.listener.changes([event(2, { ...cotObject(10, A.id, 15, 60, 60_000), version: 2 })]);
    clock.advance(1000);
    expect(fadedIn(engine, uuid(10))).toBe(false);
  });
});

describe('map controller: the fade in steps (brief function 46, criterion 107; SDK 1.7.0, CR-0042 A)', () => {
  const FADE: SteppedFade = { fromSeconds: 10, stepPercent: 5, invisibleAtSeconds: 100 };
  const fading = (fade: SteppedFade | null = FADE, behaviour: DataTypeDefaults = { fadeWhenExpired: true }): DataType => ({ ...cotDataType(behaviour), ...(fade === null ? {} : { fade }) });
  /** A track observed when the clock starts and expiring 60 s later. */
  const track = (n: number, lon = 15, extra: Partial<MapObject> = {}): MapObject => ({
    ...cotObject(n, A.id, lon, 60, 60_000),
    time: { observed: new Date(WALL_START).toISOString(), expires: new Date(WALL_START + 60_000).toISOString() },
    ...extra,
  });
  const item = (engine: FakeEngine, id: string) => engine.items.get(A.id)?.get(id);
  const opacityIn = (engine: FakeEngine, id: string) => {
    const drawn = item(engine, id);
    return drawn === undefined ? undefined : itemOpacity(drawn);
  };

  it('is drawn fully when new, at 95 % from 14.5 s, at 50 % from 55 s, without a change event', () => {
    const { engine, clock, controller } = setup({ dataTypes: [fading()] });
    controller.listener.snapshot({ layers: [A], objects: [track(10)], sequenceNo: 1 });
    expect(opacityIn(engine, uuid(10))).toBe(1);
    expect(item(engine, uuid(10))).not.toHaveProperty('opacity');
    clock.advance(14_000);
    expect(opacityIn(engine, uuid(10))).toBe(1);
    clock.advance(1_000); // 15 s: the first tick after 14.5 s
    expect(opacityIn(engine, uuid(10))).toBe(0.95);
    clock.advance(40_000);
    expect(opacityIn(engine, uuid(10))).toBe(0.5);
    expect(engine.calls.replaceItems).toBe(1); // no change event: only that object was drawn again
  });

  it('is neither drawn nor picked from 100 s, and stays held and selected', () => {
    const { engine, clock, controller, map } = setup({ dataTypes: [fading()] });
    controller.listener.snapshot({ layers: [A], objects: [track(10)], sequenceNo: 1 });
    map.selection.set([uuid(10)]);
    clock.advance(98_000);
    expect(opacityIn(engine, uuid(10))).toBe(0.05);
    expect(map.pick(engine.pixelOf([15, 60]))).toEqual([uuid(10)]);
    expect(engine.highlight[0]?.opacity).toBe(0.05);
    clock.advance(2_000);
    expect(item(engine, uuid(10))).toBeUndefined();
    expect(map.pick(engine.pixelOf([15, 60]))).toEqual([]);
    expect(engine.highlight).toEqual([]);
    expect(map.selection.value).toEqual([uuid(10)]);
    clock.advance(60_000); // nothing more to do for it, and nothing draws it again
    expect(item(engine, uuid(10))).toBeUndefined();
  });

  it('its expiry at 60 s does not fade it to 40 % on top: it is at its step, 45 %', () => {
    const { engine, clock, controller } = setup({ dataTypes: [fading()] });
    controller.listener.snapshot({ layers: [A], objects: [track(10)], sequenceNo: 1 });
    clock.advance(61_000);
    expect(item(engine, uuid(10))).toMatchObject({ opacity: 0.45 });
    expect(item(engine, uuid(10))).not.toHaveProperty('faded');
  });

  it('an object with no time.observed is not faded, and an object of a type with no fade keeps the expiry fade', () => {
    const { engine, clock, controller } = setup({ dataTypes: [fading(), { ...cotDataType(), id: 'other.type' }] });
    const unobserved = { ...track(10), time: { expires: new Date(WALL_START + 60_000).toISOString() } };
    const other = { ...track(11, 16), dataType: 'other.type' };
    controller.listener.snapshot({ layers: [A], objects: [unobserved, other], sequenceNo: 1 });
    clock.advance(70_000);
    expect(opacityIn(engine, uuid(10))).toBe(1); // no step, and no expiry fade on top of a fade in steps either
    expect(item(engine, uuid(11))).toMatchObject({ faded: true });
    expect(item(engine, uuid(11))).not.toHaveProperty('opacity');
  });

  it('on a fade list it takes the lower opacity of its step and the list\'s', () => {
    const { engine, clock, controller, map } = setup({ dataTypes: [fading()] });
    controller.listener.snapshot({ layers: [A], objects: [track(10)], sequenceNo: 1 });
    const list = map.createFadeList();
    list.set([uuid(10)]);
    expect(opacityIn(engine, uuid(10))).toBe(0.4); // the step is 1
    clock.advance(82_000);
    expect(opacityIn(engine, uuid(10))).toBe(0.2); // the step is lower
    list.clear();
    expect(opacityIn(engine, uuid(10))).toBe(0.2);
    clock.advance(1_000);
    list.set([uuid(10)]);
    expect(opacityIn(engine, uuid(10))).toBe(0.2);
    list.clear();
    expect(opacityIn(engine, uuid(10))).toBe(0.2);
  });

  it('a changed fade applies at once: shorter hides it, none gives it its expiry fade, on again its step', () => {
    const { engine, clock, controller } = setup({ dataTypes: [fading()] });
    controller.listener.snapshot({ layers: [A], objects: [track(10)], sequenceNo: 1 });
    clock.advance(55_000);
    expect(opacityIn(engine, uuid(10))).toBe(0.5);
    controller.setDataTypes([fading({ ...FADE, invisibleAtSeconds: 50 })]);
    expect(item(engine, uuid(10))).toBeUndefined();
    controller.setDataTypes([fading({ ...FADE, invisibleAtSeconds: 200 })]);
    expect(opacityIn(engine, uuid(10))).toBe(0.8); // 45 s into 10 to 200 s, 9.5 s steps: 4 steps
    controller.setDataTypes([fading(null)]);
    expect(opacityIn(engine, uuid(10))).toBe(1); // not expired yet
    clock.advance(6_000);
    expect(item(engine, uuid(10))).toMatchObject({ faded: true }); // expired at 60 s
    controller.setDataTypes([fading()]);
    expect(item(engine, uuid(10))).toMatchObject({ opacity: 0.45 });
    expect(item(engine, uuid(10))).not.toHaveProperty('faded');
  });

  it('an update of the object counts its new time.observed', () => {
    const { engine, clock, controller } = setup({ dataTypes: [fading()] });
    controller.listener.snapshot({ layers: [A], objects: [track(10)], sequenceNo: 1 });
    clock.advance(50_000);
    expect(opacityIn(engine, uuid(10))).toBe(0.6);
    controller.listener.changes([event(2, { ...track(10), version: 2, time: { observed: new Date(WALL_START + 50_000).toISOString() } })]);
    clock.advance(1_000);
    expect(opacityIn(engine, uuid(10))).toBe(1);
  });

  it('is checked about once a second and draws again only the objects whose step has changed (10 000 objects of different ages)', () => {
    const { engine, clock, controller } = setup({ dataTypes: [fading()] });
    const objects = Array.from({ length: 10_000 }, (_, i) => track(1000 + i, 5 + (i % 100) / 10, { time: { observed: new Date(WALL_START - i * 9).toISOString() } }));
    controller.listener.snapshot({ layers: [A], objects, sequenceNo: 1 });
    const updates: number[] = [];
    const update = engine.updateItems.bind(engine);
    engine.updateItems = (layerId, changes) => {
      updates.push(changes.size);
      update(layerId, changes);
    };
    clock.advance(10_000);
    expect(updates.length).toBeLessThanOrEqual(10); // one batch a second at most
    expect(updates.reduce((sum, n) => sum + n, 0)).toBeLessThan(10_000 * 4); // each object only when its step changed: about a step in 4.5 s
    expect(updates.every((n) => n < 10_000)).toBe(true);
  });
});

describe('map controller: settings changed while it runs (design pattern section 7)', () => {
  it('redraws at the new cadence', () => {
    const { engine, clock, controller } = setup();
    controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60)], sequenceNo: 1 });
    const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
    controller.setSettings({ ...DEFAULT_SETTINGS, updateCadenceMs: 5000 }, projections);
    controller.listener.changes([event(2, { ...symbolObject(10, A.id, 16, 60), version: 2 })]);
    clock.advance(0); // the first change after a quiet period is drawn at once
    controller.listener.changes([event(3, { ...symbolObject(10, A.id, 17, 60), version: 3 })]);
    clock.advance(1000);
    expect(engine.calls.updateItems).toBe(1); // the second waits for the 5 s cadence
    clock.advance(4000);
    expect(engine.calls.updateItems).toBe(2);
  });

  it('keeps unchanged projections, so nothing is projected again; a changed definition is switched to', () => {
    const { engine, controller } = setup();
    const before = engine.projection;
    controller.setSettings(DEFAULT_SETTINGS, registerProjections(DEFAULT_SETTINGS.projections).projections);
    expect(engine.projection).toBe(before);
    const [mercator, ...rest] = DEFAULT_SETTINGS.projections;
    if (mercator === undefined) throw new Error('no default');
    const narrower = { ...mercator, worldExtent: [-180, -80, 180, 80] as const };
    controller.setSettings({ ...DEFAULT_SETTINGS, projections: [narrower, ...rest] }, registerProjections([narrower, ...rest]).projections);
    expect(engine.projection).not.toBe(before);
    expect(engine.projection.def.worldExtent).toEqual([-180, -80, 180, 80]);
  });
});

describe('map controller: goTo beyond what the projection can show (MCA and owner, 2026-10-12)', () => {
  it('centres on the nearest point it can show, gives that centre in the viewport at once, and logs it', () => {
    const { engine, controller, map, ctx } = setup();
    controller.setProjection('EPSG:3413');
    map.goTo([18, 31], 500);
    const shown = engine.projection.inverse(engine.view?.center ?? [0, 0]);
    expect(map.viewport.center[0]).toBeCloseTo(shown?.[0] ?? Number.NaN, 9);
    expect(map.viewport.center[1]).toBeCloseTo(shown?.[1] ?? Number.NaN, 9);
    expect(distance(map.viewport.center, [18, 31])).toBeGreaterThan(1_000_000); // not where it was asked to go
    const infos = ctx.logs.filter((l) => l.level === 'info' && l.message.includes('goTo'));
    expect(infos).toHaveLength(1);
    expect(infos[0]?.message).toContain('[18.0000, 31.0000] is beyond what EPSG:3413 can show');
  });

  it('a centre it can show is not logged: 61° N 15° E, also at the North Pole', () => {
    const { controller, map, ctx } = setup();
    controller.setProjection('EPSG:3413');
    map.goTo([15, 61], 500);
    expect(map.viewport.center[0]).toBeCloseTo(15, 6);
    expect(map.viewport.center[1]).toBeCloseTo(61, 6);
    map.goTo([0, 90], 500); // every longitude is the pole
    expect(ctx.logs.some((l) => l.level === 'info' && l.message.includes('goTo'))).toBe(false);
  });

  it('gives the new centre before the map is shown, too', () => {
    const { map } = setup({ mounted: false });
    map.goTo([18, 59]);
    expect(map.viewport.center[0]).toBeCloseTo(18, 6);
    expect(map.viewport.center[1]).toBeCloseTo(59, 6);
  });
});

describe('map controller: the cancel signal (SDK 1.2.0, CR-0020)', () => {
  const area = (n: number) => object(n, A.id, 'core.shape', { type: 'Polygon', coordinates: [[[16, 60], [17, 60], [17, 61], [16, 60]]] });
  function running() {
    const s = setup();
    s.controller.listener.snapshot({ layers: [A], objects: [symbolObject(10, A.id, 15, 60), area(11)], sequenceNo: 1 });
    s.map.selection.set([uuid(10)]);
    return s;
  }

  it('an abort ends pickPoint, draw and edit as Escape does, with null and the tools stopped, and keeps the selection', async () => {
    const { engine, map } = running();
    for (const begin of [
      (signal: AbortSignal) => map.pickPoint({ signal }),
      (signal: AbortSignal) => map.draw('polygon', { signal }),
      (signal: AbortSignal) => map.edit(uuid(11), { signal }),
    ]) {
      const tool = new AbortController();
      const result = begin(tool.signal);
      expect(engine.interaction).not.toBe('none');
      tool.abort();
      expect(await result).toBeNull();
      expect(engine.interaction).toBe('none');
      expect([engine.drawing, engine.editing]).toEqual([null, null]);
      expect(map.selection.value).toEqual([uuid(10)]);
    }
  });

  it('an abort ends dragObject while it waits and once the object is grabbed (the preview goes), and keeps the selection, unlike Escape on a waiting drag', async () => {
    const { engine, map } = running();
    const waiting = new AbortController();
    const first = map.dragObject(uuid(10), { signal: waiting.signal });
    waiting.abort();
    expect(await first).toBeNull();
    expect(engine.interaction).toBe('none');
    expect(map.selection.value).toEqual([uuid(10)]);

    const grabbed = new AbortController();
    const second = map.dragObject(uuid(10), { signal: grabbed.signal });
    const from = engine.pixelOf([15, 60]);
    engine.pointer('down', from);
    engine.pointer('move', [from[0] + 30, from[1]]);
    expect(engine.dragPreview).not.toBeNull();
    grabbed.abort();
    expect(await second).toBeNull();
    expect(engine.dragPreview).toBeNull();
    expect(map.selection.value).toEqual([uuid(10)]);
  });

  it("a signal already aborted resolves with null at once, starts nothing and does not end another interaction that runs", async () => {
    const { engine, map } = running();
    const other = map.pickPoint();
    const aborted = AbortSignal.abort();
    expect(await map.pickPoint({ signal: aborted })).toBeNull();
    expect(await map.dragObject(uuid(10), { signal: aborted })).toBeNull();
    expect(await map.draw('line', { signal: aborted })).toBeNull();
    expect(await map.edit(uuid(11), { signal: aborted })).toBeNull();
    expect(engine.interaction).toBe('pick-point');
    expect(engine.drawing).toBeNull();
    engine.pointer('click', engine.pixelOf([15, 62]));
    expect(await other).not.toBeNull();
  });

  it('a signal already aborted wins over NotOnMapError for edit, and over an object that cannot be dragged (no warning)', async () => {
    const { map, ctx } = running();
    await expect(map.edit(uuid(99))).rejects.toBeInstanceOf(NotOnMapError);
    expect(await map.edit(uuid(99), { signal: AbortSignal.abort() })).toBeNull();
    const warnings = () => ctx.logs.filter((l) => l.level === 'warn' && l.message.includes('dragObject')).length;
    expect(await map.dragObject(uuid(99), { signal: AbortSignal.abort() })).toBeNull();
    expect(warnings()).toBe(0);
    expect(await map.dragObject(uuid(99))).toBeNull();
    expect(warnings()).toBe(1);
  });

  it('an abort after the interaction ended, or after another replaced it, changes nothing; the listener goes when it ends', async () => {
    const { engine, map } = running();
    const finished = new AbortController();
    const removed = vi.spyOn(finished.signal, 'removeEventListener');
    const picked = map.pickPoint({ signal: finished.signal });
    engine.pointer('click', engine.pixelOf([15, 62]));
    expect(await picked).not.toBeNull();
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    const next = map.pickPoint();
    finished.abort();
    expect(engine.interaction).toBe('pick-point');

    const replaced = new AbortController();
    const drawing = map.draw('polygon', { signal: replaced.signal });
    expect(await next).toBeNull(); // the drawing replaced the pick
    const editing = map.edit(uuid(11));
    expect(await drawing).toBeNull(); // the edit replaced the drawing
    replaced.abort();
    expect(engine.interaction).toBe('edit');
    expect(engine.editing).not.toBeNull();
    engine.escape();
    expect(await editing).toBeNull();
  });
});

describe('map controller: dragging a shape (brief function 26, criterion 51, T-066)', () => {
  const polygon = object(20, A.id, 'core.shape', { type: 'Polygon', coordinates: [[[16, 60], [17, 60.5], [16.5, 61.2], [16, 60]]] });
  const line = object(21, A.id, 'core.shape', { type: 'LineString', coordinates: [[14, 58], [15, 58.7], [15.6, 59.1]] });
  const route = object(22, A.id, 'core.shape', { type: 'LineString', coordinates: [[12, 57], [12.8, 57.6], [13.5, 57.4]] }, { style: { pointMarkers: 'circle' } });
  const circle = object(23, A.id, 'core.shape', { type: 'Circle', center: [18, 62], radius: 20_000 });

  /** Grabs the shape where the fake draws it (its first drawn position), drags it by 40 px right and 25 px up, and releases. */
  async function drag(shape: typeof polygon) {
    const { engine, controller, map } = setup();
    controller.listener.snapshot({ layers: [A], objects: [polygon, line, route, circle], sequenceNo: 1 });
    const drawn = engine.items.get(A.id)?.get(shape.id);
    if (drawn === undefined) throw new Error('not drawn');
    const first = drawn.kind === 'line' ? drawn.positions[0] : drawn.kind === 'polygon' ? drawn.rings[0]?.[0] : undefined;
    if (first === undefined) throw new Error('no first position');
    const result = map.dragObject(shape.id);
    const from = engine.pixelOf(first);
    engine.pointer('down', from);
    engine.pointer('move', [from[0] + 40, from[1] - 25]);
    const preview = engine.dragPreview;
    engine.pointer('up', [from[0] + 40, from[1] - 25]);
    const drop = await result;
    if (drop === null || preview === null) throw new Error('no drop');
    return { drawn, preview, drop, store: controller.store };
  }

  const anchorOf = (shape: typeof polygon): Position => {
    const g = shape.geometry;
    if (g.type === 'Circle') return g.center;
    if (g.type === 'Polygon') return g.coordinates[0]?.[0] as Position;
    if (g.type === 'LineString') return g.coordinates[0] as Position;
    throw new Error('no anchor');
  };

  for (const shape of [polygon, line, route, circle]) {
    it(`drops the ${shape.geometry.type === 'LineString' && shape.style?.pointMarkers === 'circle' ? 'route' : shape.geometry.type}'s first position moved by the drag, previews every position moved by the same difference, and leaves the object unchanged`, async () => {
      const { drawn, preview, drop, store } = await drag(shape);
      const anchor = anchorOf(shape);
      const [dLon, dLat] = [drop[0] - anchor[0], drop[1] - anchor[1]];
      expect(dLon).toBeGreaterThan(0);
      expect(dLat).toBeGreaterThan(0);
      expect(Math.abs(dLon - dLat)).toBeGreaterThan(0.01); // not the same in longitude and latitude
      const moved = (p: Position) => [p[0] + dLon, Math.max(-90, Math.min(90, p[1] + dLat))];
      const close = (a: readonly Position[], b: readonly number[][]) => { a.forEach((p, i) => {
        expect(p[0]).toBeCloseTo(b[i]?.[0] ?? Number.NaN, 9);
        expect(p[1]).toBeCloseTo(b[i]?.[1] ?? Number.NaN, 9);
      }); };
      if (drawn.kind === 'line' && preview.kind === 'line') {
        close(preview.positions, drawn.positions.map(moved));
        close(preview.vertices ?? [], (drawn.vertices ?? []).map(moved)); // a route's point markers follow the line
        expect(preview.vertices).toHaveLength(drawn.vertices?.length ?? -1);
      } else if (drawn.kind === 'polygon' && preview.kind === 'polygon') {
        preview.rings.forEach((ring, r) => { close(ring, (drawn.rings[r] ?? []).map(moved)); });
      } else {
        throw new Error(`unexpected preview ${preview.kind}`);
      }
      expect(store.objects.get(shape.id)).toBe(shape);
    });
  }

  /** A route as the map view draws it: its own points and the drawn path (here the same). */
  const routeItem = (points: Position[]): DrawItem => ({ id: uuid(30), layerId: A.id, kind: 'line', positions: points, vertices: points, style: { pointMarkers: 'circle' } });
  const pathsOf = (item: DrawItem) => (item.kind === 'line' ? [item.positions, item.vertices] : null);

  it("clamps the preview at ±90 latitude, the route's points too", () => {
    expect(pathsOf(translated(routeItem([[0, 89], [5, 89.5]]), [0, 89], [3, 90.4]))).toEqual([[[3, 90], [8, 90]], [[3, 90], [8, 90]]]);
  });

  it('does not wrap longitudes past 180: the preview is drawn one world away, as the brief allows (the plugin wraps its update)', () => {
    const moved = pathsOf(translated(routeItem([[178, 61], [179.5, 61.5]]), [178, 61], [182, 61.2]));
    expect(moved?.[0]?.[1]?.[0]).toBeCloseTo(183.5, 9);
    expect(moved?.[1]?.[0]).toEqual([182, 61.2]);
  });
});

describe('map controller: dragging an arc band and a corridor (brief functions 26 and 36)', () => {
  const band = object(30, A.id, 'core.shape', { type: 'ArcBand', center: [18, 62], innerRadius: 20_000, outerRadius: 40_000, startBearing: 300, endBearing: 60 });
  const corridor = object(31, A.id, 'core.shape', { type: 'Corridor', coordinates: [[14, 58], [15, 58.7], [15.6, 59.1]], width: 6_000 });

  for (const shape of [band, corridor]) {
    it(`draws the ${shape.geometry.type} as an area, previews a drag as a marker at the pointer, and drops the first position moved`, async () => {
      const { engine, controller, map } = setup();
      controller.listener.snapshot({ layers: [A], objects: [band, corridor], sequenceNo: 1 });
      const drawn = engine.items.get(A.id)?.get(shape.id);
      expect(drawn?.kind).toBe('polygon');
      const first = drawn?.kind === 'polygon' ? drawn.rings[0]?.[0] : undefined;
      if (first === undefined) throw new Error('no first position');
      const result = map.dragObject(shape.id);
      const from = engine.pixelOf(first);
      engine.pointer('down', from);
      engine.pointer('move', [from[0] + 40, from[1] - 25]);
      const preview = engine.dragPreview;
      engine.pointer('up', [from[0] + 40, from[1] - 25]);
      const drop = await result;
      if (drop === null) throw new Error('no drop');
      const anchor = shape.geometry.type === 'ArcBand' ? shape.geometry.center : (shape.geometry.type === 'Corridor' ? shape.geometry.coordinates[0] : undefined) as Position;
      expect(drop[0] - anchor[0]).toBeGreaterThan(0);
      expect(drop[1] - anchor[1]).toBeGreaterThan(0);
      expect(preview?.kind).toBe('fallback');
      expect(preview?.kind === 'fallback' ? preview.position : null).toEqual(drop);
      // The object is unchanged, and still drawn as an area.
      expect(controller.store.objects.get(shape.id)?.geometry).toEqual(shape.geometry);
      expect(engine.items.get(A.id)?.get(shape.id)?.kind).toBe('polygon');
    });
  }
});
