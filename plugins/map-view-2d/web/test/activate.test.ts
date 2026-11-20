import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicableObjectActions, BACKGROUND_MAP, MAP_VIEW, SYMBOLS, type BackgroundMapProvider, type JsonValue, type ObjectAction, type Position } from '@emc2/plugin-sdk';
import { DEFAULT_SETTINGS } from '../src/core/settings.ts';
import { createFakeContext, createFakeSymbolService, FAKE_TOKEN_VALUES } from '@emc2/plugin-sdk/testing';
import { textLookFrom } from '../src/core/look.ts';
import { cotDataType, cotObject, layer, object, symbolObject } from './fixtures.ts';
import { activate } from './harness.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const osm: BackgroundMapProvider = {
  id: 'basemap-osm', name: 'OpenStreetMap', projections: ['EPSG:3857'],
  source: { type: 'xyz', url: '/api/plugins/basemap-osm/tiles/{z}/{x}/{y}.png', minZoom: 0, maxZoom: 19, tileSize: 256 },
  attribution: { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
};

describe('activate', () => {
  it('provides MapView, takes the Map Pane and subscribes to the live picture', async () => {
    const { ctx, engine } = activate();
    const map = await ctx.services.get(MAP_VIEW);
    expect(map.renderingMode).toBe('hardware');
    expect(ctx.mapViewMount).not.toBeNull();
    const element = document.createElement('div');
    ctx.mapViewMount?.mount(element);
    expect(engine?.mounted).toBe(element);
    const L = layer(1);
    ctx.live.snapshot({ layers: [L], objects: [symbolObject(10, L.id, 15, 60)] });
    expect(engine?.idsIn(L.id)).toHaveLength(1);
  });

  it('criterion 13: with a GPU, reports hardware and logs it once', () => {
    const { ctx } = activate({ mode: 'hardware' });
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'drawn with a GPU (NVIDIA GeForce RTX 4070)' });
    expect(ctx.logs.filter((l) => l.message.startsWith('rendering:'))).toEqual([{ level: 'info', message: 'rendering: hardware (NVIDIA GeForce RTX 4070)', args: [] }]);
  });

  it('criterion 13: without hardware acceleration, reports software through the status and the log', async () => {
    const { ctx } = activate({ mode: 'software' });
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.statusHistory.at(-1)?.detail).toContain('without a GPU (Google SwiftShader)');
    expect(ctx.logs.some((l) => l.message === 'rendering: software (Google SwiftShader)')).toBe(true);
    expect((await ctx.services.get(MAP_VIEW)).renderingMode).toBe('software');
  });

  it('criterion 13: without WebGL, the Map Pane says the map cannot be drawn, and MapView is still there', async () => {
    const { ctx, engine } = activate({ mode: 'none' });
    expect(engine).toBeNull(); // the drawing engine is never created
    const element = document.createElement('div');
    ctx.mapViewMount?.mount(element);
    expect(element.querySelector('[role="alert"]')?.textContent).toBe('This browser cannot draw the map: WebGL is not available.');
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'FAILED', detail: 'WebGL is not available: the map cannot be drawn' });
    expect((await ctx.services.get(MAP_VIEW)).renderingMode).toBe('none');
  });

  it('uses the symbology service when it comes', async () => {
    const { ctx, engine } = activate();
    expect(engine?.symbols).toBeNull();
    const symbols = createFakeSymbolService();
    ctx.provideAs(SYMBOLS, symbols);
    await vi.waitFor(() => {
      expect(engine?.symbols).toBe(symbols);
    });
  });

  it('criterion 20: subscribes with the area in view and the budget of the rendering mode', () => {
    expect(activate().ctx.liveSubscriptions).toEqual([{ area: 'viewport', budget: 100_000 }]);
    expect(activate({ mode: 'software' }).ctx.liveSubscriptions).toEqual([{ area: 'viewport', budget: 10_000 }]);
    expect(activate({ mode: 'hardware', settings: { hardwareBudget: 50_000 } }).ctx.liveSubscriptions).toEqual([{ area: 'viewport', budget: 50_000 }]);
  });

  it('criterion 20 and 21: objects leave and enter, and clusters arrive, through the shell', () => {
    const { ctx, engine } = activate();
    const L = layer(1);
    ctx.live.snapshot({ layers: [L], objects: [symbolObject(10, L.id, 15, 60)] });
    ctx.live.area({ sequenceNo: 5, entered: [symbolObject(11, L.id, 16, 61)], left: [symbolObject(10, L.id, 15, 60).id] });
    ctx.live.clusters({ level: 6, full: true, upsert: [{ cell: 'c', position: [18, 62], count: 9, byLayer: { [L.id]: 9 }, byIdentity: { friend: 9, hostile: 0, neutral: 0, unknown: 0 } }], remove: [] });
    expect(engine?.clusters.map((c) => c.count)).toEqual([9]);
  });

  it('criterion 23: takes the data types from the shell, and applies a changed behaviour at once', () => {
    const ctx = createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], dataTypes: [cotDataType()] });
    const { engine } = activate({ ctx });
    const L = layer(1);
    ctx.live.snapshot({ layers: [L], objects: [cotObject(10, L.id, 15, 60, -60_000)] });
    expect(engine?.items.get(L.id)?.get(cotObject(10, L.id, 15, 60, 0).id)?.faded).toBe(true);
    ctx.changeDataTypeBehaviour('cot.cot', { fadeWhenExpired: false });
    expect(engine?.items.get(L.id)?.get(cotObject(10, L.id, 15, 60, 0).id)?.faded === true).toBe(false);
  });

  it('works without the symbology plugin (a uses key without a provider, CR-0011): markers, and the status says so', async () => {
    const ctx = createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], uses: ['emc2.symbols'] });
    const { engine } = activate({ ctx });
    await vi.waitFor(() => {
      expect(ctx.statusHistory.at(-1)?.detail).toContain('symbology is not available');
    });
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(engine?.symbols).toBeNull(); // symbols are drawn as markers
  });

  it('reports a failure while setting up the symbols instead of losing it (MCA review N1)', async () => {
    const { ctx, engine } = activate();
    if (engine === null) throw new Error('no engine');
    engine.setSymbols = () => {
      throw new Error('atlas broken');
    };
    ctx.provideAs(SYMBOLS, createFakeSymbolService());
    await vi.waitFor(() => {
      expect(ctx.statusHistory.at(-1)?.detail).toContain('the symbols could not be set up');
    });
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.logs.some((l) => l.level === 'error' && l.message.includes('symbols could not be set up'))).toBe(true);
  });

  it('criterion 1: shows a background map provider that supports the projection, also one that comes later', () => {
    const { ctx, engine } = activate();
    expect(engine?.background).toBe('unset');
    ctx.provideAs(BACKGROUND_MAP, osm);
    expect(engine?.background).toBe(osm);
  });

  it('reports unusable settings and still starts with the defaults', () => {
    const { ctx } = activate({ settings: { textThreshold: -1, projections: [] } });
    expect(ctx.logs.filter((l) => l.level === 'warn')).toHaveLength(2);
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.statusHistory.at(-1)?.detail).toContain('2 settings are not usable');
  });

  it('criteria 10 and 11: never sends change requests and fetches nothing itself', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { ctx } = activate();
    ctx.provideAs(BACKGROUND_MAP, osm);
    const L = layer(1);
    ctx.live.snapshot({ layers: [L], objects: [symbolObject(10, L.id, 15, 60)] });
    expect(ctx.submitted).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the look (brief function 21, criterion 43)', () => {
  it("draws labels and cluster counts in the shell's current look, and follows a change of look, light or dark at once", () => {
    const { ctx, engine } = activate();
    expect(engine?.textLook).toEqual(textLookFrom(FAKE_TOKEN_VALUES));
    ctx.changeTheme({ look: 'chart-room', scheme: 'light' }, { colorText: '#1c2830', colorGround: '#ecefea' });
    expect(engine?.textLook).toMatchObject({ text: [28, 40, 48, 1], halo: [236, 239, 234, 1] });
    ctx.changeTheme({ scheme: 'dark' }, { colorText: '#e4ebee', colorGround: '#0e151a' });
    expect(engine?.textLook).toMatchObject({ text: [228, 235, 238, 1], halo: [14, 21, 26, 1] });
  });
});

describe('settings changed while the map runs (design pattern section 7)', () => {
  it('subscribes again when the object budget of the rendering mode changes, and only then', () => {
    const { ctx } = activate();
    ctx.changeSettings({ softwareBudget: 5000 }); // not the hardware mode's budget
    expect(ctx.liveSubscriptions).toEqual([{ area: 'viewport', budget: 100_000 }]);
    ctx.changeSettings({ hardwareBudget: 60_000 });
    expect(ctx.liveSubscriptions).toEqual([{ area: 'viewport', budget: 60_000 }]);
    const L = layer(1);
    ctx.live.snapshot({ layers: [L], objects: [symbolObject(10, L.id, 15, 60)] }); // the new subscription gets its snapshot
  });

  it('applies the text threshold and the preferred backgrounds at once, and leaves the view where it is; the size comes from the display settings (brief function 35)', async () => {
    const { ctx, engine, result } = activate();
    const { controller } = result;
    const osm: BackgroundMapProvider = {
      id: 'basemap-osm', name: 'OpenStreetMap', projections: ['EPSG:3857'], attribution: { text: 'OSM' },
      source: { type: 'xyz', url: '/api/plugins/basemap-osm/tiles/{z}/{x}/{y}.png', minZoom: 0, maxZoom: 19, tileSize: 256 },
    };
    const other: BackgroundMapProvider = { ...osm, id: 'other', name: 'Other' };
    ctx.provideAs(BACKGROUND_MAP, other);
    ctx.provideAs(BACKGROUND_MAP, osm);
    expect(engine?.background).toBe(osm);
    const view = engine?.view;
    ctx.changeSettings({ textThreshold: 500, preferredBackgrounds: ['Other'], initialCenter: [100, 10], initialZoom: 2 });
    // The shell gives the size (`ctx.display`); there is no setting for it.
    expect(engine?.symbolOptions).toEqual({ symbolSize: 30, textThreshold: 500 });
    expect(engine?.background).toBe(other);
    expect(engine?.view).toEqual(view); // initial values only matter at start
    expect(controller.currentSettings.textThreshold).toBe(500);
    await Promise.resolve();
  });

  it('reports bad new values in the log and the status, and uses their defaults', () => {
    const { ctx, result: { controller } } = activate();
    ctx.changeSettings({ textThreshold: 500_000 });
    expect(controller.currentSettings.textThreshold).toBe(2000);
    expect(ctx.logs.some((l) => l.level === 'warn' && l.message.includes('textThreshold'))).toBe(true);
    expect(ctx.statusHistory.at(-1)?.detail).toContain('setting');
  });

  it('switches to the first projection left when the current one is no longer configured', () => {
    const { ctx, engine, result: { controller } } = activate();
    const [, arctic] = DEFAULT_SETTINGS.projections;
    ctx.changeSettings({ projections: [arctic] as unknown as JsonValue });
    expect(engine?.projection.def.code).toBe('EPSG:3413');
    expect(controller.projectionCodes).toEqual(['EPSG:3413']);
    expect(engine?.registered.map((p) => p.def.code)).toEqual(['EPSG:3413']);
  });
});

describe('the drawing and editing service changes nothing itself (ADR-0033 point 3)', () => {
  it('criteria 32 and 33: drawing every kind and editing a shape send no change request; the caller does', async () => {
    const { ctx, engine } = activate();
    const map = await ctx.services.get(MAP_VIEW);
    const L = layer(1);
    const area = object(20, L.id, 'core.shape', { type: 'Polygon', coordinates: [[[15, 60], [16, 60], [16, 61], [15, 60]]] });
    ctx.live.snapshot({ layers: [L], objects: [area] });
    if (engine === null) throw new Error('no engine');
    const at = (lon: number, lat: number) => engine.projection.forward([lon, lat]) ?? [0, 0];
    const shapes = {
      circle: { kind: 'circle', center: at(15, 60), edge: at(15.1, 60) },
      ellipse: { kind: 'ellipse', from: at(15, 60), to: at(15.2, 60.05) },
      square: { kind: 'square', from: at(15, 60), to: at(15.2, 60.05) },
      rectangle: { kind: 'rectangle', from: at(15, 60), to: at(15.2, 60.05) },
      polygon: { kind: 'polygon', points: [at(15, 60), at(16, 60), at(16, 61)] },
      line: { kind: 'line', points: [at(15, 60), at(16, 61)] },
    } as const;
    for (const [kind, shape] of Object.entries(shapes)) {
      const drawing = map.draw(kind as keyof typeof shapes);
      engine.finishDrawing(shape);
      expect((await drawing)?.type).toBeDefined();
    }
    const editing = map.edit(area.id);
    engine.finishEditing({ kind: 'polygon', rings: [[at(15, 60), at(16.5, 60), at(16, 61), at(15, 60)]] });
    expect((await editing)?.type).toBe('Polygon');
    expect(ctx.submitted).toEqual([]);
  });
});

describe("activate: the map view's own actions and its menu (brief functions 15 and 16)", () => {
  function shown() {
    const { ctx, engine } = activate();
    ctx.mapViewMount?.mount(document.createElement('div'));
    if (engine === null) throw new Error('no engine');
    return { ctx, engine };
  }

  it('registers Centre map as a map action, and Centre on and Zoom to as object actions for every object, one or several', () => {
    const { ctx } = shown();
    expect(ctx.mapActions.map((a) => [a.id, a.label, a.group])).toEqual([['centre-map', 'Centre map', 'view']]);
    expect(ctx.objectActions.map((a) => [a.id, a.label, a.group, a.multiple, a.permission])).toEqual([
      ['centre-on', 'Centre on object(s)', 'view', true, undefined],
      ['zoom-to', 'Zoom to object(s)', 'view', true, undefined],
    ]);
    for (const action of [...ctx.mapActions, ...ctx.objectActions]) expect(action.icon).toBeDefined();
  });

  it('criterion 30: a right click on empty map opens the map menu at its position, and Centre map centres there, keeping the zoom', async () => {
    const { ctx, engine } = shown();
    ctx.live.snapshot({ layers: [layer(1)], objects: [] });
    const resolution = engine.view?.resolution;
    engine.menu(engine.pixelOf([17.5, 60.25]));
    const target = ctx.openedMenus.at(-1)?.target as { position: Position };
    await ctx.runMapAction('centre-map', target.position);
    expect(engine.view?.resolution).toBe(resolution);
    const map = await ctx.services.get(MAP_VIEW);
    expect(map.viewport.center[0]).toBeCloseTo(17.5, 6);
    expect(map.viewport.center[1]).toBeCloseTo(60.25, 6);
  });

  it('criterion 29: on a selection of 3 the menu has the object actions for the 3 ids and not an action that takes one; the action gets the 3 ids', async () => {
    const { ctx, engine } = shown();
    const L = layer(1);
    const objects = [symbolObject(10, L.id, 15, 60), symbolObject(11, L.id, 16, 61), symbolObject(12, L.id, 17, 62)];
    ctx.live.snapshot({ layers: [L], objects });
    ctx.setServerObjects(objects);
    const map = await ctx.services.get(MAP_VIEW);
    map.selection.set(objects.map((o) => o.id));
    engine.menu(engine.pixelOf([16, 61]));
    expect(ctx.openedMenus.at(-1)?.target).toEqual({ objects: objects.map((o) => o.id) });
    const edit: ObjectAction = { id: 'edit', label: 'Edit', appliesTo: {}, multiple: false, run: () => undefined };
    expect(applicableObjectActions([...ctx.objectActions, edit], objects, () => true).map((a) => a.label)).toEqual(['Centre on object(s)', 'Zoom to object(s)']);
    await ctx.runObjectAction('zoom-to', objects.map((o) => o.id));
    for (const o of objects) {
      const [x, y] = engine.pixelOf(o.geometry.type === 'Point' ? o.geometry.coordinates : [0, 0]);
      expect(x > 0 && x < (engine.view?.width ?? 0) && y > 0 && y < (engine.view?.height ?? 0)).toBe(true);
    }
  });
});

describe('activate: the share of the setup (brief function 20)', () => {
  it('criterion 38: registers its share with the shell, which saves and restores it, and tells the shell when it changed', async () => {
    const { ctx, engine } = activate();
    ctx.mapViewMount?.mount(document.createElement('div'));
    const L = layer(1);
    ctx.live.snapshot({ layers: [L], objects: [] });
    const map = await ctx.services.get(MAP_VIEW);
    map.setLayerVisible(L.id, false);
    expect(ctx.setupChanges).toBeGreaterThan(0);
    const saved = ctx.saveSetup();
    expect(saved).toMatchObject({ v: 1, projection: 'EPSG:3857', layers: { [L.id]: false } });
    map.setLayerVisible(L.id, true);
    map.goTo([30, 50]);
    ctx.restoreSetup(saved);
    expect(map.isLayerVisible(L.id)).toBe(false);
    expect(map.viewport.center[0]).toBeCloseTo(15, 6);
    expect(engine?.dim).toBe(0);
  });

  it('a share it cannot read changes nothing and shows in the status; the next good one clears it', () => {
    const { ctx } = activate();
    ctx.restoreSetup({ v: 99 });
    expect(ctx.statusHistory.at(-1)?.detail).toContain('the saved setup could not be read');
    ctx.restoreSetup(ctx.saveSetup());
    expect(ctx.statusHistory.at(-1)?.detail).not.toContain('the saved setup could not be read');
  });
});
