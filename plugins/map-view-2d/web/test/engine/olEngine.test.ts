/**
 * The real OpenLayers engine as far as jsdom can show it (no rendering, but layers, sources and
 * interactions exist): pan handling (MCA review B1), and the selection highlight's layer, its place
 * in the layer stack, and the cursor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY } from '@emc2/plugin-sdk';
import type OlMap from 'ol/Map.js';
import type Point from 'ol/geom/Point.js';
import OlLineString from 'ol/geom/LineString.js';
import OlMultiPoint from 'ol/geom/MultiPoint.js';
import OlPoint from 'ol/geom/Point.js';
import type VectorSource from 'ol/source/Vector.js';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom.js';
import DragPan from 'ol/interaction/DragPan.js';
import DragBox, { DragBoxEvent } from 'ol/interaction/DragBox.js';
import DragZoom from 'ol/interaction/DragZoom.js';
import { boxAt } from '../../src/core/pick.ts';
import Draw, { DrawEvent } from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Translate, { TranslateEvent } from 'ol/interaction/Translate.js';
import Collection from 'ol/Collection.js';
import { editedGeometry, editShapeOf, moveRound, reshape, type EditShape } from '../../src/core/drawing.ts';
import { always } from 'ol/events/condition.js';
import OlFeature from 'ol/Feature.js';
import OlMultiPolygon from 'ol/geom/MultiPolygon.js';
import OlPolygon from 'ol/geom/Polygon.js';
import { get as getOlProjection, transform as olTransform } from 'ol/proj.js';
import type { BackgroundMapProvider, DataType, MapObject, MilSymbol, Pixel, Position, SymbolImage, SymbolService, VectorSource as SdkVectorSource } from '@emc2/plugin-sdk';
import { createFakeSymbolService, createFakeVectorBackground, fakeGraphicImage, FAKE_GRAPHIC_IMAGE_SVG, FAKE_SENSOR_REPORT_SYMBOL } from '@emc2/plugin-sdk/testing';
import type BaseLayer from 'ol/layer/Base.js';
import Graticule from 'ol/layer/Graticule.js';
import ImageLayer from 'ol/layer/Image.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorImageLayer from 'ol/layer/VectorImage.js';
import VectorLayer from 'ol/layer/Vector.js';
import OlStyle from 'ol/style/Style.js';
import type Icon from 'ol/style/Icon.js';
import { prepareVector } from '../../src/core/vectorBackground.ts';
import { toDrawItem, type DrawItem } from '../../src/core/drawData.ts';
import { initialView, MapController } from '../../src/core/controller.ts';
import { destination, distance } from '../../src/core/geodesic.ts';
import { mapToPixel } from '../../src/core/viewport.ts';
import { northOnScreen } from '../../src/core/appearance.ts';
import type { DisplayOptions } from '../../src/core/engine.ts';
import type { LabelPlaces } from '@emc2/plugin-sdk';
import { NO_PLACED_LABELS } from '../../src/core/labelPlaces.ts';
import { event, FakeClock, INFANTRY, layer, object, symbolObject, textbook, uuid, WALL_START } from '../fixtures.ts';
import { registerProjections, type Projection } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { IDENTITY_COLOURS } from '../../src/core/clusters.ts';
import { textLookFrom, type TextLook } from '../../src/core/look.ts';
import { FAKE_TOKEN_VALUES } from '@emc2/plugin-sdk/testing';
import { DOUBLE_CLICK_GRACE_MS, IMAGE_LOAD_TIMEOUT_MS, OpenLayersEngine, registerWithOpenLayers } from '../../src/engine/olEngine.ts';
import { KIND, layerStyle, P } from '../../src/engine/styles.ts';
import { DashPatterns, dashPattern, MAX_DASH_PATTERNS } from '../../src/engine/graphicFeatures.ts';

const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
registerWithOpenLayers(projections);
const mercator = projections[0] as Projection;
const polar = projections[1] as Projection;

/** Display options with no label placed and the arrow on, as the shell's defaults leave a symbol with nothing to show. */
const options = (over: Partial<DisplayOptions> = {}): DisplayOptions => ({ ...NO_PLACED_LABELS, speedVectorSeconds: 0, ...over });
/** The name below the symbol, as the user's default places it. */
const NAME_BELOW = { ...NO_PLACED_LABELS.labelPlaces, below: 'name' } as const;

beforeEach(() => {
  // jsdom has no canvas: the engine's images (atlas, arrow) are not needed here.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,');
  // Nor ResizeObserver, which OpenLayers' map uses for its target.
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function engine() {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const e = new OpenLayersEngine({ projection: mercator, center: [0, 0], resolution: 1000, symbolSize: 30, textThreshold: 2000, log, styleSwapIntervalMs: 0 });
  const map = (e as unknown as { map: OlMap }).map;
  const pans = map.getInteractions().getArray().filter((i): i is DragPan => i instanceof DragPan);
  expect(pans).toHaveLength(1);
  const dragPan = pans[0] as DragPan;
  /** Whether a plain left-button press at this pixel starts a pan. */
  const pansAt = (pixel: Pixel) =>
    dragPan.getActive() &&
    (dragPan as unknown as { condition_: (e: unknown) => boolean }).condition_({
      pixel: [...pixel],
      originalEvent: { pointerId: 1, isPrimary: true, button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
    });
  return { e, map, pansAt };
}

/** The engine's private Canvas sources, to look at what it draws. */
function sources(e: OpenLayersEngine) {
  return e as unknown as { labels: VectorSource; highlightSource: VectorSource; overlaySource: VectorSource; previewSource: VectorSource };
}

describe('OpenLayers engine: without a 2D canvas (review note 5, T-054 part A)', () => {
  it('logs that symbol images, arrows, hatched fills and arrowheads stay blank', () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    new OpenLayersEngine({ projection: mercator, center: [0, 0], resolution: 1000, symbolSize: 30, textThreshold: 2000, log, styleSwapIntervalMs: 0 });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('hatched fills'));
  });
});

describe('OpenLayers engine: the Canvas paths draw the 1.1.0 line styles too (brief function 18)', () => {
  it("criterion 35: a line's drag preview and overlay get its arrowhead and route markers", () => {
    const { e } = engine();
    const route = toDrawItem(object(60, uuid(1), 'core.shape', { type: 'LineString', coordinates: [[15, 60], [16, 61], [17, 61.5]] }, { style: { arrowhead: 'end', pointMarkers: 'circle' } }));
    if (route === null) throw new Error('no item');
    e.setDragPreview(route);
    e.setOverlay('test', [route]);
    for (const source of [sources(e).previewSource, sources(e).overlaySource]) {
      const style = source.getFeatures()[0]?.getStyle();
      const styles = Array.isArray(style) ? style : [];
      const extras = styles.filter((s) => s.getGeometry() !== null);
      expect(extras).toHaveLength(2); // the arrowhead at the tip and the markers on the points
    }
  });
});

describe('OpenLayers engine: an overlay\'s area and label (SDK 1.4.0 part 6)', () => {
  it('draws an area with its hole as one polygon with the style\'s stroke and fill, and a label as centred text', () => {
    const { e } = engine();
    const area = toDrawItem(object(70, uuid(1), 'core.shape', { type: 'Polygon', coordinates: [[[10, 58], [12, 58], [12, 60], [10, 60], [10, 58]], [[10.5, 58.5], [10.5, 59.5], [11.5, 59.5], [11.5, 58.5], [10.5, 58.5]]] }, { style: { strokeColor: '#ff0000', strokeWidth: 3, fillColor: '#00ff00', fillOpacity: 0.5 } }));
    if (area === null) throw new Error('no item');
    const label: DrawItem = { id: 'overlay-1/1', layerId: 'overlay-1', kind: 'text', position: [11, 59], text: 'Range\n12 km', style: { color: '#123456', size: 20, haloColor: '#abcdef' } };
    e.setOverlay('test', [area, label]);
    const [areaFeature, labelFeature] = sources(e).overlaySource.getFeatures();
    const polygon = areaFeature?.getGeometry() as OlPolygon;
    expect(polygon.getLinearRings()).toHaveLength(2);
    const areaStyle = areaFeature?.getStyle() as OlStyle[];
    expect(areaStyle[0]?.getStroke()?.getWidth()).toBe(3);
    expect(areaStyle[0]?.getFill()).not.toBeNull();
    const text = (labelFeature?.getStyle() as OlStyle).getText();
    expect(text?.getText()).toBe('Range\n12 km');
    expect(text?.getFont()).toContain('20px');
    expect(text?.getFill()?.getColor()).toBe('#123456');
    expect(text?.getStroke()?.getColor()).toBe('#abcdef');
    const at = olTransform((labelFeature?.getGeometry() as Point).getCoordinates(), 'EPSG:3857', 'EPSG:4326');
    expect(at[0]).toBeCloseTo(11, 6);
    expect(at[1]).toBeCloseTo(59, 6); // latitude differs from longitude
  });

  it('takes the look\'s colours and the shape label\'s size where the plugin gives none, and follows a change of look', () => {
    const { e } = engine();
    const label: DrawItem = { id: 'overlay-1/0', layerId: 'overlay-1', kind: 'text', position: [11, 59], text: 'x', style: undefined };
    e.setOverlay('test', [label]);
    const textOf = () => (sources(e).overlaySource.getFeatures()[0]?.getStyle() as OlStyle).getText();
    expect(textOf()?.getFont()).toContain('12px');
    const look = textLookFrom({ ...FAKE_TOKEN_VALUES, colorText: '#ff00ff', colorGround: '#00ffff' });
    e.setTextLook(look);
    expect(textOf()?.getFill()?.getColor()).toBe('rgba(255, 0, 255, 1)');
  });
});

describe('OpenLayers engine: panning while an object can be dragged', () => {
  it('a press on the empty map pans in drag mode', () => {
    const { e, pansAt } = engine();
    e.setInteraction('drag-object');
    e.setGrabTest(([x]) => x < 50);
    expect(pansAt([200, 10])).toBe(true);
  });

  it('a press the grab test claims (on the object) does not pan', () => {
    const { e, pansAt } = engine();
    e.setInteraction('drag-object');
    e.setGrabTest(([x]) => x < 50);
    expect(pansAt([10, 10])).toBe(false);
  });

  it('pans everywhere again when the grab test is cleared (drop, Escape, end)', () => {
    const { e, pansAt } = engine();
    e.setInteraction('drag-object');
    e.setGrabTest(() => true);
    e.setGrabTest(null);
    e.setInteraction('none');
    expect(pansAt([10, 10])).toBe(true);
  });
});

describe('OpenLayers engine: selection highlight (owner, 2026-10-09)', () => {
  const point: DrawItem = { id: 'p', layerId: 'L', kind: 'point', position: [15, 60], style: undefined };
  const marker: DrawItem = { id: 'f', layerId: 'L', kind: 'fallback', position: [18, 59] };

  it('draws one feature per highlighted item, and removes them with an empty list', () => {
    const { e } = engine();
    e.setHighlight([point, marker]);
    const source = sources(e).highlightSource;
    expect(source.getFeatures()).toHaveLength(2);
    expect(source.getFeatures().every((f) => Array.isArray(f.getStyle()) && (f.getStyle() as unknown[]).length > 0)).toBe(true);
    e.setHighlight([]);
    expect(source.getFeatures()).toHaveLength(0);
  });

  it('keeps the highlight through a projection switch, in the new projection', () => {
    const { e } = engine();
    e.setHighlight([point]);
    e.setProjection(polar, [0, 0], 1000);
    const features = sources(e).highlightSource.getFeatures();
    expect(features).toHaveLength(1);
    const xy = (features[0]?.getGeometry() as Point).getCoordinates();
    const expected = polar.forward([15, 60]);
    expect(xy[0]).toBeCloseTo(expected?.[0] ?? Number.NaN, 3);
    expect(xy[1]).toBeCloseTo(expected?.[1] ?? Number.NaN, 3);
  });

  it('stacks the layers: WebGL layers (one group), then text symbols, highlight, overlays, drag preview', () => {
    const { e, map } = engine();
    e.setLayers([{ id: 'a', stack: 0, visible: true }, { id: 'b', stack: 1, visible: true }]);
    const s = sources(e);
    const zOf = (source: VectorSource) => map.getLayers().getArray().find((l) => (l as unknown as { getSource(): unknown }).getSource() === source)?.getZIndex() ?? Number.NaN;
    const webgl = map.getLayers().getArray().filter((l) => l.getClassName() === 'map-view-2d-layer').map((l) => l.getZIndex() ?? Number.NaN);
    expect(webgl).toHaveLength(2);
    const order = [Math.max(...webgl), zOf(s.labels), zOf(s.highlightSource), zOf(s.overlaySource), zOf(s.previewSource)];
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(new Set(order).size).toBe(order.length);
  });
});

describe('OpenLayers engine: cursor', () => {
  it('shows "move" over the object that can be dragged, and keeps the crosshair while picking a point', () => {
    const { e, map } = engine();
    const cursor = () => map.getViewport().style.cursor;
    e.setInteraction('drag-object');
    e.setDragHover(true);
    expect(cursor()).toBe('move');
    e.setDragHover(false);
    expect(cursor()).toBe('');
    e.setInteraction('pick-point');
    e.setDragHover(true);
    expect(cursor()).toBe('crosshair');
  });
});

describe('OpenLayers engine: no double-click zoom while placing or dragging (T-032, criterion 16)', () => {
  /** The real engine behind the real controller, as the plugin runs them. */
  function mapView() {
    const start = initialView(DEFAULT_SETTINGS, projections);
    if (start === null) throw new Error('no initial view');
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const e = new OpenLayersEngine({ ...start, symbolSize: 30, textThreshold: 2000, log, styleSwapIntervalMs: 0 });
    const controller = new MapController({
    display: DEFAULT_DISPLAY,
      engine: e, settings: DEFAULT_SETTINGS, projections, clock: new FakeClock(), origin: 'http://127.0.0.1:8080', log,
      rendering: { mode: 'software', renderer: null },
    });
    const L = layer(1);
    controller.listener.snapshot({ layers: [L], objects: [symbolObject(10, L.id, 15, 60)], sequenceNo: 1 });
    const map = (e as unknown as { map: OlMap }).map;
    const zooms = map.getInteractions().getArray().filter((i): i is DoubleClickZoom => i instanceof DoubleClickZoom);
    expect(zooms).toHaveLength(1);
    // These tests check the interaction's active flag: OpenLayers hands map events only to active
    // interactions, so an inactive one cannot zoom. A real dblclick cannot be sent in jsdom, because
    // OpenLayers drops map events until the map has rendered a frame (WebGL).
    const zoomsOnDoubleClick = () => zooms[0]?.getActive() === true;
    map.setSize([800, 600]); // a size, so clicks have a position
    /** A click as OpenLayers reports it (its dblclick follows right after, in the same call). */
    const click = (lon: number, lat: number) => {
      const xy = e.projection.forward([lon, lat]);
      const view = e.view;
      if (xy === null || view === null) throw new Error('not on the map');
      (e as unknown as { emitPointer(type: string, pixel: Pixel): void }).emitPointer('click', mapToPixel(view, xy));
    };
    return { e, controller, service: controller.service, zoomsOnDoubleClick, click };
  }

  it('criterion 16: double-click zoom is off during pickPoint', () => {
    const { service, zoomsOnDoubleClick } = mapView();
    void service.pickPoint();
    expect(zoomsOnDoubleClick()).toBe(false);
  });

  it('criterion 16: double-click zoom is off during dragObject', () => {
    const { service, zoomsOnDoubleClick } = mapView();
    void service.dragObject(uuid(10));
    expect(zoomsOnDoubleClick()).toBe(false);
  });

  it('criterion 16: double-click zoom is on with no interaction active, also once the window after one has passed', async () => {
    vi.useFakeTimers();
    try {
      const { controller, service, zoomsOnDoubleClick } = mapView();
      expect(zoomsOnDoubleClick()).toBe(true);
      const picking = service.pickPoint();
      controller.dispose(); // ends the interaction, as Escape or a drop would
      expect(await picking).toBeNull();
      vi.advanceTimersByTime(DOUBLE_CLICK_GRACE_MS);
      expect(zoomsOnDoubleClick()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('criterion 16: double-click zoom stays off when the second click of a double-click places the point (OpenLayers sends dblclick right after that click)', async () => {
    vi.useFakeTimers();
    try {
      const { service, zoomsOnDoubleClick, click } = mapView();
      const picking = service.pickPoint();
      click(15, 60); // completes pickPoint: the interaction ends ...
      expect(zoomsOnDoubleClick()).toBe(false); // ... and the dblclick that follows at once must not zoom
      expect(await picking).not.toBeNull();
      vi.advanceTimersByTime(DOUBLE_CLICK_GRACE_MS - 1);
      expect(zoomsOnDoubleClick()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(zoomsOnDoubleClick()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('criterion 21: a click that zooms in on a cluster turns double-click zoom off for the window, so a double-click zooms in once (owner, 2026-10-13, review R2)', () => {
    vi.useFakeTimers();
    try {
      const { controller, zoomsOnDoubleClick, click } = mapView();
      const unknown = { friend: 0, hostile: 0, neutral: 0, unknown: 500 };
      controller.listener.clusters?.({ level: 6, full: true, upsert: [{ cell: 'c1', position: [16, 61], count: 500, byLayer: { [layer(1).id]: 500 }, byIdentity: unknown }], remove: [] });
      click(16, 61);
      expect(zoomsOnDoubleClick()).toBe(false);
      vi.advanceTimersByTime(DOUBLE_CLICK_GRACE_MS - 1);
      expect(zoomsOnDoubleClick()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(zoomsOnDoubleClick()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('criterion 16: pausing double-click zoom while a point is picked does not turn it on after the window', () => {
    vi.useFakeTimers();
    try {
      const { e, service, zoomsOnDoubleClick } = mapView();
      void service.pickPoint();
      e.pauseDoubleClickZoom();
      vi.advanceTimersByTime(DOUBLE_CLICK_GRACE_MS * 2);
      expect(zoomsOnDoubleClick()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('criterion 41: while a polygon is drawn, OpenLayers draws it and double-click zoom is off; a new interaction removes the drawing (T-054 prototype)', async () => {
    const { e, service, zoomsOnDoubleClick } = mapView();
    const map = (e as unknown as { map: OlMap }).map;
    const draws = () => map.getInteractions().getArray().filter((i) => i instanceof Draw);
    const drawing = service.draw('polygon');
    expect(draws()).toHaveLength(1);
    expect(draws()[0]?.getActive()).toBe(true);
    expect(zoomsOnDoubleClick()).toBe(false);
    void service.pickPoint();
    expect(await drawing).toBeNull();
    expect(draws()[0]?.getActive() ?? false).toBe(false);
    await Promise.resolve(); // removed after the event that ended it
    expect(draws()).toHaveLength(0);
  });

  it("criterion 32: OpenLayers' end of a drawing reaches the caller as lon/lat; Enter finishes and Backspace removes the last point", async () => {
    const { e, service } = mapView();
    const map = (e as unknown as { map: OlMap }).map;
    const finish = vi.spyOn(Draw.prototype, 'finishDrawing');
    const removeLast = vi.spyOn(Draw.prototype, 'removeLastPoint');
    const drawing = service.draw('polygon');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(removeLast).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    const draw = map.getInteractions().getArray().find((i): i is Draw => i instanceof Draw);
    const points: [number, number][] = [[15, 60], [17, 61], [16, 62.5]];
    const ring = points.map((p) => [...(e.projection.forward(p) ?? [0, 0])]);
    draw?.dispatchEvent(new DrawEvent('drawend', new OlFeature(new OlPolygon([[...ring, ring[0] ?? [0, 0]]]))));
    const geometry = await drawing;
    const coordinates = geometry?.type === 'Polygon' ? geometry.coordinates[0] : [];
    expect(coordinates).toHaveLength(4);
    points.forEach((p, i) => {
      expect(coordinates?.[i]?.[0]).toBeCloseTo(p[0], 9);
      expect(coordinates?.[i]?.[1]).toBeCloseTo(p[1], 9);
    });
  });

  it('review finding 1: unmounting the map ends a drawing with null and leaves Enter and Backspace to the page (owner, 2026-10-16)', async () => {
    const { e, service } = mapView();
    const map = (e as unknown as { map: OlMap }).map;
    const unmount = e.mount(document.createElement('div'));
    const drawing = service.draw('polygon');
    unmount();
    expect(await drawing).toBeNull();
    await Promise.resolve();
    expect(map.getInteractions().getArray().some((i) => i instanceof Draw)).toBe(false);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.body.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('criterion 32: draws each kind with the right OpenLayers mode, dragged kinds by pressing and dragging; the dragged preview is the result\'s outline', () => {
    const { e, service } = mapView();
    const map = (e as unknown as { map: OlMap }).map;
    const drawOf = () => map.getInteractions().getArray().find((i): i is Draw => i instanceof Draw && i.getActive());
    for (const [kind, type, freehand] of [['polygon', 'Polygon', false], ['line', 'LineString', false], ['circle', 'Circle', true], ['ellipse', 'Circle', true], ['square', 'Circle', true], ['rectangle', 'Circle', true]] as const) {
      void service.draw(kind);
      // OpenLayers 10.10 turns the freehand option into an always-true freehand condition.
      const draw = drawOf() as unknown as { type_: string; freehandCondition_: unknown; geometryFunction_: (c: number[][], g: unknown) => OlPolygon };
      expect([kind, draw.type_, draw.freehandCondition_ === always]).toEqual([kind, type, freehand]);
      if (kind === 'circle') {
        // The preview of a dragged circle is its geodesic ring: every point about 5 km from the centre.
        const center = e.projection.forward([15, 60]) ?? [0, 0];
        const edge = e.projection.forward(destination([15, 60], 90, 5_000)) ?? [0, 0];
        const ring = draw.geometryFunction_([[...center], [...edge]], undefined).getCoordinates()[0] ?? [];
        expect(ring.length).toBeGreaterThan(32);
        for (const c of ring) expect(distance([15, 60], e.projection.inverse([c[0] ?? 0, c[1] ?? 0]) ?? [0, 0])).toBeCloseTo(5_000, 0);
      }
    }
    void service.pickPoint();
  });

  it('sets no point for a click with a modifier key, as OpenLayers does by default (review finding 6, part C)', () => {
    const { e, service } = mapView();
    const map = (e as unknown as { map: OlMap }).map;
    void service.draw('polygon');
    const draw = map.getInteractions().getArray().find((i): i is Draw => i instanceof Draw && i.getActive()) as unknown as { condition_: (event: unknown) => boolean };
    const click = (keys: Record<string, boolean>) => ({ coordinate: [...(e.projection.forward([15, 60]) ?? [0, 0])], originalEvent: { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...keys } });
    expect(draw.condition_(click({}))).toBe(true);
    expect(draw.condition_(click({ shiftKey: true }))).toBe(false);
    expect(draw.condition_(click({ ctrlKey: true }))).toBe(false);
    void service.pickPoint();
  });

  it('criterion 16: a new interaction within the window keeps double-click zoom off', () => {
    vi.useFakeTimers();
    try {
      const { service, zoomsOnDoubleClick, click } = mapView();
      void service.pickPoint();
      click(15, 60);
      void service.pickPoint(); // draw-symbols arms the next placing at once
      vi.advanceTimersByTime(DOUBLE_CLICK_GRACE_MS * 2);
      expect(zoomsOnDoubleClick()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Every value reachable from `root` that is neither plain data (plain objects, arrays, primitives)
 * nor a function or a promise, with its path. An OpenLayers object (map, feature, geometry, view)
 * is always a class instance, so it shows up here.
 */
function nonPlain(root: unknown, path: string, seen = new Set<unknown>()): string[] {
  if (root === null || (typeof root !== 'object' && typeof root !== 'function') || seen.has(root)) return [];
  seen.add(root);
  if (root instanceof Promise) return [];
  const proto: unknown = Object.getPrototypeOf(root);
  if (typeof root === 'object' && proto !== Object.prototype && proto !== Array.prototype && proto !== null) {
    return [`${path}: ${(proto as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'unknown'}`];
  }
  return Object.entries(root).flatMap(([key, value]) => nonPlain(value, `${path}.${key}`, seen));
}

describe('criterion 12: nothing of OpenLayers in what the MapView hands out (review remark N5)', () => {
  it('the check itself finds an OpenLayers object', () => {
    expect(nonPlain({ a: [{ b: new OlPoint([0, 0]) }] }, 'x')).toEqual(['x.a.0.b: Point']);
  });

  it('the service, its state, results and events are plain data, with the real OpenLayers engine behind it', async () => {
    const start = initialView(DEFAULT_SETTINGS, projections);
    if (start === null) throw new Error('no initial view');
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const e = new OpenLayersEngine({ ...start, symbolSize: 30, textThreshold: 2000, log, styleSwapIntervalMs: 0 });
    const controller = new MapController({
    display: DEFAULT_DISPLAY,
      engine: e, settings: DEFAULT_SETTINGS, projections, clock: new FakeClock(), origin: 'http://127.0.0.1:8080', log,
      rendering: { mode: 'software', renderer: null },
    });
    const L = layer(1);
    controller.listener.snapshot({ layers: [L], objects: [symbolObject(10, L.id, 15, 60)], sequenceNo: 1 });
    const map = controller.service;

    const handedOut: Record<string, unknown> = { map };
    const viewports: unknown[] = [];
    const pointerEvents: unknown[] = [];
    map.onViewportChange((v) => viewports.push(v));
    map.onPointer((event) => pointerEvents.push(event));
    (e as unknown as { map: OlMap }).map.setSize([800, 600]); // the engine reports the new viewport
    const view = e.view;
    const xy = e.projection.forward([15, 60]);
    if (view === null || xy === null) throw new Error('not on the map');
    const pixel = mapToPixel(view, xy);
    const emitPointer = (type: string) => {
      (e as unknown as { emitPointer(t: string, p: Pixel): void }).emitPointer(type, pixel);
    };
    const picked = map.pickPoint();
    emitPointer('move');
    emitPointer('click');
    map.selection.set([uuid(10)]);
    map.activeLayer.set(L.id);
    Object.assign(handedOut, {
      viewport: map.viewport, viewports, pointerEvents, picked: await picked, pick: map.pick(pixel), overlay: map.createOverlay(),
      selection: map.selection.value, activeLayer: map.activeLayer.value, visible: map.isLayerVisible(L.id),
    });

    expect(viewports.length).toBeGreaterThan(0);
    expect(pointerEvents.length).toBeGreaterThan(0);
    expect(handedOut['picked']).not.toBeNull();
    expect(nonPlain(handedOut, 'handedOut')).toEqual([]);
  });
});

describe('OpenLayers engine: listeners that go with the map (review remark N6)', () => {
  function mounted() {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const e = new OpenLayersEngine({ projection: mercator, center: [0, 0], resolution: 1000, symbolSize: 30, textThreshold: 2000, log, styleSwapIntervalMs: 0 });
    const pane = document.createElement('div');
    document.body.append(pane);
    const escapes = vi.fn();
    e.onEscape(escapes);
    const unmount = e.mount(pane);
    const escape = (target: EventTarget = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { e, pane, escapes, unmount, escape };
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('reports Escape while the map is shown, and no longer after it is unmounted', () => {
    const { escapes, unmount, escape } = mounted();
    escape();
    expect(escapes).toHaveBeenCalledTimes(1);
    unmount();
    escape();
    expect(escapes).toHaveBeenCalledTimes(1);
  });

  it('does not report Escape typed in a text field', () => {
    const { escapes, escape } = mounted();
    const field = document.createElement('input');
    document.body.append(field);
    escape(field);
    expect(escapes).not.toHaveBeenCalled();
  });

  it('ends a grab when the map is unmounted while the pointer is held', () => {
    const { e, unmount } = mounted();
    const events: string[] = [];
    e.onPointer((event) => events.push(event.type));
    e.setInteraction('drag-object');
    e.setGrabTest(() => true);
    const router = (e as unknown as { pointers: { grabbing: boolean } }).pointers;
    const viewport = (e as unknown as { map: OlMap }).map.getViewport();
    viewport.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(router.grabbing).toBe(true);
    unmount();
    expect(router.grabbing).toBe(false);
    expect(events).toEqual(['down', 'cancel']);
  });
});

describe('OpenLayers engine: vector backgrounds (brief function 11)', () => {
  const provider = createFakeVectorBackground([], { id: 'basemap-naturalearth', name: 'Natural Earth' });
  const data = prepareVector(
    provider.source as SdkVectorSource,
    [
      { layer: 'land', geometry: { type: 'Polygon', coordinates: [[[0, 50], [10, 50], [10, 60], [0, 60], [0, 50]]] } },
      { layer: 'coastline', geometry: { type: 'LineString', coordinates: [[0, 50], [10, 50]] } },
    ],
    mercator,
  );
  const backgroundLayer = (e: OpenLayersEngine) => (e as unknown as { backgroundLayer: BaseLayer | null }).backgroundLayer;

  it('draws it as one image layer under everything, with its water colour, its layers in order and its attribution', () => {
    const { e } = engine();
    e.setBackground({ kind: 'vector', provider, data });
    const layer = backgroundLayer(e);
    expect(layer).toBeInstanceOf(VectorImageLayer);
    if (!(layer instanceof VectorImageLayer)) throw new Error('not a vector image layer');
    expect(layer.getZIndex()).toBe(0);
    expect(layer.getBackground()).toBe('rgba(201, 219, 232, 1)');
    const source = layer.getSource() as VectorSource | null;
    const features = source?.getFeatures() ?? [];
    expect(features.map((f) => f.getGeometry()?.getType())).toEqual(['MultiPolygon', 'MultiLineString']);
    const styles = features.map((f) => f.getStyle() as OlStyle);
    expect(styles.map((st) => st.getZIndex())).toEqual([0, 1]);
    // The land is only filled: its outline in the fill colour covers the cuts at 180°.
    expect(styles[0]?.getStroke()?.getColor()).toBe(styles[0]?.getFill()?.getColor());
    const attributions = source?.getAttributions();
    expect(typeof attributions === 'function' ? attributions({} as never) : attributions).toEqual(['Fake data']);
  });

  it('draws a wms background as tiles or one image under everything, only in the projections it lists (brief function 3, criteria 55 to 58)', () => {
    const { e } = engine();
    const wms = (mode?: 'image'): BackgroundMapProvider => ({
      id: 'topo', name: 'topo', projections: ['EPSG:3857'], attribution: { text: 'WMS data' },
      source: { type: 'wms', url: '/api/plugins/basemap-wms/map/topo', layers: ['relief'], version: '1.3.0', format: 'image/png', ...(mode === undefined ? {} : { mode }) },
    });
    e.setBackground({ kind: 'tiles', provider: wms() });
    expect(backgroundLayer(e)).toBeInstanceOf(TileLayer);
    expect(backgroundLayer(e)?.getZIndex()).toBe(0);
    e.setBackground({ kind: 'tiles', provider: wms('image') });
    expect(backgroundLayer(e)).toBeInstanceOf(ImageLayer);
    e.setProjection(polar, [0, 0], 1000); // not listed: never redrawn in another projection
    expect(backgroundLayer(e)).toBeInstanceOf(Graticule);
    e.setBackground({ kind: 'tiles', provider: { ...wms(), projections: ['EPSG:3413'] } });
    expect(backgroundLayer(e)).toBeInstanceOf(TileLayer);
  });

  it('shows the graticule after a projection change until the background for the new projection comes', () => {
    const { e } = engine();
    e.setBackground({ kind: 'vector', provider, data });
    e.setProjection(polar, [0, 0], 1000);
    expect(backgroundLayer(e)).toBeInstanceOf(Graticule);
    e.setBackground({ kind: 'vector', provider, data: { ...data, projection: 'EPSG:3413' } });
    expect(backgroundLayer(e)).toBeInstanceOf(VectorImageLayer);
  });
});

describe('OpenLayers engine: clusters (brief function 12)', () => {
  it('draws each cluster as a disc split by identity with its count, above the object layers and below the symbols with text', () => {
    const { e, map } = engine();
    e.setClusters([{ cell: 'c', position: [15, 60], count: 1500, identity: { friend: 750, hostile: 500, neutral: 0, unknown: 250 } }]);
    const source = (e as unknown as { clusterSource: VectorSource }).clusterSource;
    const clusterLayer = map.getLayers().getArray().find((l) => (l as unknown as { getSource(): unknown }).getSource() === source);
    expect(clusterLayer?.getZIndex()).toBe(999_999);
    const feature = source.getFeatures()[0];
    const [x, y] = (feature?.getGeometry() as Point).getCoordinates();
    expect(x).toBeCloseTo((15 * Math.PI * 6378137) / 180, 3);
    expect(y).toBeGreaterThan(0);
    const calls: string[] = [];
    const ctx = new Proxy({}, {
      get: (_t, name: string) => (name === 'fillText' ? (text: string) => calls.push(`text ${text}`) : name === 'arc' ? () => calls.push('arc') : () => undefined),
      set: () => true,
    });
    const renderer = (feature?.getStyle() as OlStyle).getRenderer();
    renderer?.([100, 100], { context: ctx, pixelRatio: 1 } as unknown as Parameters<NonNullable<typeof renderer>>[1]);
    expect(calls).toEqual(['arc', 'arc', 'arc', 'arc', 'text 1.5k']); // three sectors (no neutral), the rim, the count
    e.setClusters([]);
    expect(source.getFeatures()).toHaveLength(0);
  });

  it("criterion 43: the count in the look's text colour on a halo in its ground colour, in its data font; a new look draws it again at once, the fills stay fixed (owner, 2026-10-20)", () => {
    const { e } = engine();
    const source = (e as unknown as { clusterSource: VectorSource }).clusterSource;
    const drawn = () => {
      const calls: string[] = [];
      const state: Record<string, unknown> = {};
      const ctx = new Proxy({}, {
        get: (_t, name: string) => (name === 'fillText' ? (text: string) => calls.push(`fill ${text} ${String(state.fillStyle)} ${String(state.font)}`)
          : name === 'strokeText' ? (text: string) => calls.push(`halo ${text} ${String(state.strokeStyle)} ${String(state.lineWidth)}`)
            : name === 'fill' ? () => calls.push(`sector ${String(state.fillStyle)}`) : () => undefined),
        set: (_t, name: string, value: unknown) => {
          state[name] = value;
          return true;
        },
      });
      const renderer = (source.getFeatures()[0]?.getStyle() as OlStyle).getRenderer();
      renderer?.([100, 100], { context: ctx, pixelRatio: 2 } as unknown as Parameters<NonNullable<typeof renderer>>[1]);
      return calls;
    };
    e.setClusters([{ cell: 'c', position: [15, 60], count: 12, identity: { friend: 6, hostile: 6, neutral: 0, unknown: 0 } }]);
    const dark: TextLook = textLookFrom(FAKE_TOKEN_VALUES); // Night Watch, dark
    e.setTextLook(dark);
    expect(drawn()).toEqual([
      `sector ${IDENTITY_COLOURS.friend}`, `sector ${IDENTITY_COLOURS.hostile}`,
      'halo 12 rgba(15, 18, 23, 1) 6',
      `fill 12 rgba(227, 232, 239, 1) bold 22px ${FAKE_TOKEN_VALUES.fontData}`,
    ]);
    const before = source.getFeatures()[0];
    e.setTextLook(textLookFrom({ ...FAKE_TOKEN_VALUES, sizeText: '14px', sizeRow: '34px' })); // only the density: nothing drawn again
    expect(source.getFeatures()[0]).toBe(before);
    e.setTextLook(textLookFrom({ ...FAKE_TOKEN_VALUES, colorText: '#151a21', colorGround: '#e6e9ee', fontData: 'Consolas, monospace' })); // Night Watch, light
    expect(drawn()).toEqual([
      `sector ${IDENTITY_COLOURS.friend}`, `sector ${IDENTITY_COLOURS.hostile}`,
      'halo 12 rgba(230, 233, 238, 1) 6',
      'fill 12 rgba(21, 26, 33, 1) bold 22px Consolas, monospace',
    ]);
  });

  it('draws the clusters again in the new projection after a projection change (conformance review B1)', () => {
    const { e } = engine();
    e.setClusters([{ cell: 'c', position: [15, 75], count: 9, identity: { friend: 9, hostile: 0, neutral: 0, unknown: 0 } }]);
    e.setProjection(polar, [0, 0], 1000);
    const source = (e as unknown as { clusterSource: VectorSource }).clusterSource;
    const [x, y] = (source.getFeatures()[0]?.getGeometry() as Point).getCoordinates();
    const [ex, ey] = textbook.polarStereographic3413(15, 75);
    expect(x).toBeCloseTo(ex, 3);
    expect(y).toBeCloseTo(ey, 3);
  });
});

describe('OpenLayers engine: symbol options changed while it runs', () => {
  it('asks the symbology for images at the new size, with a new atlas and arrow', () => {
    const { e } = engine();
    const sizes: number[] = [];
    const canvas = document.createElement('canvas');
    e.setSymbols({ render: (request: { readonly size: number }) => { sizes.push(request.size); return { image: canvas, width: request.size, height: request.size, anchor: [0, 0] }; } } as unknown as SymbolService);
    e.setLayers([{ id: uuid(1), stack: 0, visible: true }]);
    e.replaceItems(uuid(1), [toDrawItemOrThrow(symbolObject(10, uuid(1), 15, 60))]);
    const atlasBefore = (e as unknown as { atlas: unknown }).atlas;
    e.setSymbolOptions(48, 100);
    expect(sizes.at(-1)).toBe(48);
    expect((e as unknown as { atlas: unknown }).atlas).not.toBe(atlasBefore);
    const calls = sizes.length;
    e.setSymbolOptions(48, 100); // nothing changed: nothing drawn again
    expect(sizes).toHaveLength(calls);
  });
});

function toDrawItemOrThrow(o: Parameters<typeof toDrawItem>[0]): DrawItem {
  const drawn = toDrawItem(o);
  if (drawn === null) throw new Error('no draw item');
  return drawn;
}

describe('OpenLayers engine: objects outside the projection (owner, 2026-10-12)', () => {
  it('criterion 4: an object around the North Pole is not drawn in EPSG:3031, and is drawn again after switching to EPSG:3413', () => {
    const { e } = engine();
    const south = registerProjections(DEFAULT_SETTINGS.projections).projections.find((p) => p.def.code === 'EPSG:3031') as Projection;
    const band = toDrawItemOrThrow({ ...symbolObject(30, uuid(1), 0, 75), type: 'core.shape', geometry: { type: 'Polygon', coordinates: [[[-180, 70], [0, 70], [180, 70], [180, 75], [0, 75], [-180, 75], [-180, 70]]] }, style: { fillColor: '#00c8ff' } });
    e.setLayers([{ id: uuid(1), stack: 0, visible: true }]);
    e.replaceItems(uuid(1), [band]);
    // The geodesic edges of the band run over the pole, which crosses the ring in Mercator: it has a fill feature of its own (T-111), not counted.
    const count = () => (e as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(uuid(1))?.source.getFeatures().filter((f) => !String(f.getId()).includes('#')).length;
    expect(count()).toBe(1);
    e.setProjection(south, [0, 0], 1000);
    expect(count()).toBe(0);
    e.setProjection(polar, [0, 0], 1000);
    expect(count()).toBe(1);
  });
});

describe('OpenLayers engine: faded symbols with text (brief function 13, criterion 23; browser check 2026-10-12)', () => {
  /** An engine with one symbol with text in view; `draw` returns its image on the text layer. */
  function symbolWithText() {
    // A 2D context that accepts everything, so the engine really composes the images.
    const anything: Record<string | symbol, unknown> = {};
    const context = new Proxy(anything, { get: (t, k) => (k in t ? t[k] : () => undefined) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const { e, map } = engine();
    map.setSize([800, 600]);
    const plainImage = document.createElement('canvas');
    const textImage = document.createElement('canvas');
    const requests: boolean[] = [];
    e.setSymbols({
      render: (request: { readonly withText: boolean }) => {
        requests.push(request.withText);
        return request.withText ? { image: textImage, width: 120, height: 50, anchor: [70, 30] } : { image: plainImage, width: 40, height: 30, anchor: [20, 15] };
      },
    } as unknown as SymbolService);
    e.setLayers([{ id: uuid(1), stack: 0, visible: true }]);
    const item = toDrawItemOrThrow(symbolObject(10, uuid(1), 1, 2, { ...INFANTRY, modifiers: { quantity: 'A1' } }));
    const draw = (faded: boolean) => {
      e.replaceItems(uuid(1), [{ ...item, faded }]);
      (e as unknown as { refreshLabels(): void }).refreshLabels();
      const features = sources(e).labels.getFeatures();
      expect(features).toHaveLength(1);
      return (features[0]?.getStyle() as OlStyle).getImage() as Icon;
    };
    return { draw, textImage, requests };
  }

  it('draws the text of a faded symbol at its opacity, without the symbol (the faded one below shows through)', () => {
    const { draw, textImage, requests } = symbolWithText();
    const icon = draw(true);
    expect(icon.getOpacity()).toBe(0.4);
    expect(icon.getImage(1)).not.toBe(textImage); // the text alone, composed by textOnly
    expect(requests.filter((withText) => !withText).length).toBeGreaterThanOrEqual(2); // the atlas, then the cut
  });

  it('draws the text of a symbol that is not faded opaque, also without the symbol: the symbol stays on its layer, so the layer order holds (T-087; owner, 2026-10-22)', () => {
    const { draw, textImage, requests } = symbolWithText();
    const icon = draw(false);
    expect(icon.getOpacity()).toBe(1);
    expect(icon.getImage(1)).not.toBe(textImage); // the text alone, composed by textOnly
    expect(requests.filter((withText) => !withText).length).toBeGreaterThanOrEqual(2); // the atlas, then the cut
  });

  it('keeps the text image when the symbol fades at its expiry and back; only the opacity changes', () => {
    const { draw, textImage } = symbolWithText();
    const text = draw(false).getImage(1);
    expect(text).not.toBe(textImage);
    const faded = draw(true);
    expect([faded.getImage(1), faded.getOpacity()]).toEqual([text, 0.4]);
    const again = draw(false);
    expect([again.getImage(1), again.getOpacity()]).toEqual([text, 1]);
  });

  it('draws the full image with text when the symbol cannot be drawn without text (no atlas entry: a marker is drawn below), as before T-087', () => {
    const anything: Record<string | symbol, unknown> = {};
    const context = new Proxy(anything, { get: (t, k) => (k in t ? t[k] : () => undefined) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const { e, map } = engine();
    map.setSize([800, 600]);
    const textImage = document.createElement('canvas');
    e.setSymbols({ render: (request: { readonly withText: boolean }) => (request.withText ? { image: textImage, width: 120, height: 50, anchor: [70, 30] } : null) } as unknown as SymbolService);
    e.setLayers([{ id: uuid(1), stack: 0, visible: true }]);
    e.replaceItems(uuid(1), [toDrawItemOrThrow(symbolObject(10, uuid(1), 1, 2, { ...INFANTRY, modifiers: { quantity: 'A1' } }))]);
    (e as unknown as { refreshLabels(): void }).refreshLabels();
    expect(((sources(e).labels.getFeatures()[0]?.getStyle() as OlStyle).getImage() as Icon).getImage(1)).toBe(textImage);
  });

  it("T-087: a back layer's symbol with text does not cover a front layer's symbol: on the text layer only its text, the symbols on their WebGL layers in the layer order, also after the order changes", () => {
    const anything: Record<string | symbol, unknown> = {};
    const context = new Proxy(anything, { get: (t, k) => (k in t ? t[k] : () => undefined) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const { e, map } = engine();
    map.setSize([800, 600]);
    const textImage = document.createElement('canvas');
    e.setSymbols({ render: (request: { readonly withText: boolean }) => (request.withText ? { image: textImage, width: 120, height: 50, anchor: [70, 30] } : { image: document.createElement('canvas'), width: 40, height: 30, anchor: [20, 15] }) } as unknown as SymbolService);
    const [back, front] = [uuid(1), uuid(2)];
    const zOf = (id: string) => (e as unknown as { layers: Map<string, { layer: { getZIndex(): number } }> }).layers.get(id)?.layer.getZIndex() ?? Number.NaN;
    e.setLayers([{ id: back, stack: 0, visible: true }, { id: front, stack: 1, visible: true }]);
    e.replaceItems(back, [toDrawItemOrThrow(symbolObject(10, back, 1, 2, { ...INFANTRY, modifiers: { quantity: 'A1' } }))]);
    e.replaceItems(front, [toDrawItemOrThrow(symbolObject(11, front, 1, 2, INFANTRY))]); // no text: on its WebGL layer only
    (e as unknown as { refreshLabels(): void }).refreshLabels();
    const texts = () => sources(e).labels.getFeatures().map((f) => ((f.getStyle() as OlStyle).getImage() as Icon).getImage(1));
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).not.toBe(textImage); // the text only, not the symbol over the front layer's
    expect(zOf(front)).toBeGreaterThan(zOf(back));
    e.setLayers([{ id: front, stack: 0, visible: true }, { id: back, stack: 1, visible: true }]); // the back layer moved to the front
    expect(zOf(back)).toBeGreaterThan(zOf(front));
  });
});

/** The real engine behind the real controller, shown at a size, with symbols from a fake SymbolService. */
function realMapView(options: { symbols?: SymbolService; dataTypes?: readonly DataType[]; engine?: Partial<ConstructorParameters<typeof OpenLayersEngine>[0]> } = {}) {
  const start = initialView(DEFAULT_SETTINGS, projections);
  if (start === null) throw new Error('no initial view');
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const e = new OpenLayersEngine({ ...start, symbolSize: 30, textThreshold: 2000, log, styleSwapIntervalMs: 0, ...options.engine });
  const clock = new FakeClock();
  const controller = new MapController({
    display: DEFAULT_DISPLAY,
    engine: e, settings: DEFAULT_SETTINGS, projections, clock, origin: 'http://127.0.0.1:8080', log,
    rendering: { mode: 'software', renderer: null },
    ...(options.dataTypes === undefined ? {} : { dataTypes: options.dataTypes }),
  });
  (e as unknown as { map: OlMap }).map.setSize([800, 600]);
  e.setSymbols(options.symbols ?? ({ render: () => ({ image: document.createElement('canvas'), width: 40, height: 30, anchor: [20, 15] }) } as unknown as SymbolService));
  return { e, controller, map: controller.service, clock, log };
}

describe('OpenLayers engine: goTo beyond what the projection can show (MCA and owner, 2026-10-12)', () => {
  it('the viewport gives the centre actually shown right after goTo, before OpenLayers reports the move', () => {
    const { e, controller, map, log } = realMapView();
    controller.setProjection('EPSG:3413');
    expect(map.viewport.center).toBeDefined(); // cached now
    map.goTo([18, 31], 500);
    const view = e.view;
    if (view === null) throw new Error('no view');
    expect(view.center[0]).toBeCloseTo(4_194_304, 3); // the extent's edge
    const shown = polar.inverse(view.center);
    expect(map.viewport.center[0]).toBeCloseTo(shown?.[0] ?? Number.NaN, 9);
    expect(map.viewport.center[1]).toBeCloseTo(shown?.[1] ?? Number.NaN, 9);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('is beyond what EPSG:3413 can show'));
  });
});

describe('OpenLayers engine: a newly added object is picked as soon as it is drawn (PCA-draw-symbols report, 2026-10-12)', () => {
  // Guard test: the report (the first click on a symbol placed a second or two earlier picked
  // nothing) did not reproduce, here or in the browser. Pick works on the engine's spatial index,
  // which holds an object from the redraw that draws it.
  it('an object arriving over the live picture is picked at its place, in its box, from the redraw on', () => {
    const { e, controller, map, clock } = realMapView();
    const L = layer(1);
    controller.listener.snapshot({ layers: [L], objects: [symbolObject(10, L.id, 15, 60)], sequenceNo: 1 });
    clock.advance(5_000);
    const added = symbolObject(11, L.id, 18, 61);
    controller.listener.changes([event(2, added)]);
    clock.advance(0); // the first change after a quiet period is drawn in the next task
    const view = e.view;
    const xy = mercator.forward([18, 61]);
    if (view === null || xy === null) throw new Error('no view');
    const [px, py] = mapToPixel(view, xy);
    expect(map.pick([px, py])).toEqual([added.id]);
    expect(map.pick([px + 18, py - 13])).toEqual([added.id]); // near the corner of its 40 x 30 image
    expect(map.pick([px + 30, py])).toEqual([]);
  });

  it('within the cadence after the layer was redrawn, an object waits for the next redraw, drawn and picked together', () => {
    const { e: engine, controller, map, clock } = realMapView();
    const L = layer(1);
    controller.listener.snapshot({ layers: [L], objects: [], sequenceNo: 1 });
    clock.advance(5_000);
    const first = symbolObject(11, L.id, 18, 61);
    const second = symbolObject(12, L.id, 12, 59);
    controller.listener.changes([event(2, first)]);
    clock.advance(0);
    controller.listener.changes([event(3, second)]);
    clock.advance(500);
    const pixelOf = (p: [number, number]) => {
      const view = engine.view;
      const xy = mercator.forward(p);
      if (view === null || xy === null) throw new Error('no view');
      return mapToPixel(view, xy);
    };
    const drawn = () => (engine as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source.getFeatureById(second.id) ?? null;
    expect(drawn()).toBeNull(); // not drawn yet (updateCadenceMs, 1 s) ...
    expect(map.pick(pixelOf([12, 59]))).toEqual([]); // ... so not picked either
    clock.advance(500);
    expect(drawn()).not.toBeNull();
    expect(map.pick(pixelOf([12, 59]))).toEqual([second.id]);
  });
});

describe('OpenLayers engine: areas are picked by their outline only (brief function 28, criterion 54; owner, 2026-10-30)', () => {
  const square = (west: number, south: number, east: number, north: number): { type: 'Polygon'; coordinates: [number, number][][] } => ({
    type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  });

  function areas() {
    const { e: engine, controller, map, clock } = realMapView();
    const L = layer(1);
    const plain = object(20, L.id, 'core.shape', square(10, 58, 14, 62)); // the default light fill
    const solid = object(21, L.id, 'core.shape', square(16, 58, 20, 62), { style: { fillColor: '#00aa00', fillOpacity: 0.5 } });
    const hatched = object(22, L.id, 'core.shape', square(10, 63, 14, 67), { style: { fillColor: '#aa0000', fillPattern: 'hatch' } });
    const open = object(23, L.id, 'core.shape', square(16, 63, 20, 67), { style: { fillColor: '#0000aa', fillOpacity: 0 } }); // nothing to see inside
    const symbol = symbolObject(24, L.id, 12, 60); // inside the first area
    controller.listener.snapshot({ layers: [L], objects: [plain, solid, hatched, open, symbol], sequenceNo: 1 });
    clock.advance(5_000);
    const pixelOf = (lon: number, lat: number): Pixel => {
      const view = engine.view;
      const xy = mercator.forward([lon, lat]);
      if (view === null || xy === null) throw new Error('no view');
      return mapToPixel(view, xy);
    };
    const click = (lon: number, lat: number) => {
      (engine as unknown as { emitPointer(type: string, pixel: Pixel): void }).emitPointer('click', pixelOf(lon, lat));
    };
    return { map, pixelOf, click, ids: { plain: plain.id, solid: solid.id, hatched: hatched.id, open: open.id, symbol: symbol.id } };
  }

  it('does not pick inside a solid, a hatched, a default and an empty fill, but on the outline', () => {
    const { map, pixelOf, ids } = areas();
    for (const [lon, lat] of [[18, 60], [12, 65], [18, 65], [11, 61]] as const) expect(map.pick(pixelOf(lon, lat)), `${String(lon)} ${String(lat)}`).toEqual([]);
    expect(map.pick(pixelOf(18, 58))).toEqual([ids.solid]); // the bottom edge
    expect(map.pick(pixelOf(14, 65))).toEqual([ids.hatched]); // the right edge
    expect(map.pick(pixelOf(16, 65))).toEqual([ids.open]); // the left edge of an area with no fill
    expect(map.pick(pixelOf(10, 60))).toEqual([ids.plain]);
  });

  it('lets a symbol inside an area always be picked and selected, and the area only on its outline', () => {
    const { map, pixelOf, click, ids } = areas();
    expect(map.pick(pixelOf(12, 60))).toEqual([ids.symbol]);
    click(12, 60);
    expect(map.selection.value).toEqual([ids.symbol]);
    click(18, 60); // inside a filled area, over empty map: the selection clears
    expect(map.selection.value).toEqual([]);
    click(14, 60); // the outline
    expect(map.selection.value).toEqual([ids.plain]);
    click(12, 65); // inside the hatched area
    expect(map.selection.value).toEqual([]);
  });
});

describe('OpenLayers engine: the fill of a polygon whose outline crosses itself (T-111; owner, 2026-10-31)', () => {
  const ring = (...points: [number, number][]): { type: 'Polygon'; coordinates: [number, number][][] } => ({ type: 'Polygon', coordinates: [[...points, points[0] as [number, number]]] });
  // Longitude 4° wide and latitude 3° high, so a swapped pair shows.
  const BOW_TIE = ring([10, 58], [14, 61], [14, 58], [10, 61]);
  const STAR = ring(...[0, 2, 4, 1, 3].map((k): [number, number] => [12 + 2 * Math.sin((72 * k * Math.PI) / 180), 61 + 1.2 * Math.cos((72 * k * Math.PI) / 180)]));

  function drawn(...objects: ReturnType<typeof object>[]) {
    const { e: engine, controller, map, clock } = realMapView();
    const L = layer(1);
    controller.listener.snapshot({ layers: [L], objects: objects.map((o) => ({ ...o, layerId: L.id })), sequenceNo: 1 });
    clock.advance(5_000);
    const source = (engine as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source;
    const features = () => source?.getFeatures() ?? [];
    return { engine, controller, map, clock, L, features };
  }

  it("draws a bow tie's fill as its two lobes under the outline, and the outline with no fill", () => {
    const bow = object(30, layer(1).id, 'core.shape', BOW_TIE, { style: { fillColor: '#00aa00', fillOpacity: 0.5 } });
    const { features } = drawn(bow);
    expect(features().map((f) => String(f.getId()))).toEqual([`${bow.id}#fill`, bow.id]); // the fill first: under the outline
    const fill = features().find((f) => f.getId() === `${bow.id}#fill`);
    const own = features().find((f) => f.getId() === bow.id);
    expect(fill?.getGeometry()).toBeInstanceOf(OlMultiPolygon);
    expect((fill?.getGeometry() as OlMultiPolygon).getPolygons()).toHaveLength(2);
    expect(fill?.get(P.strokeWidth)).toBe(0);
    expect(fill?.get(P.fill)).toEqual([0, 170, 0, 0.5]);
    expect(own?.get(P.fill)).toEqual([0, 170, 0, 0]); // no fill of its own
    expect(own?.get(P.strokeWidth)).toBe(2);
  });

  it("fills a star's middle too: five points and the pentagon, where the lobes lie at their longitude and latitude", () => {
    const star = object(31, layer(1).id, 'core.shape', STAR, { style: { fillColor: '#aa0000', fillPattern: 'hatch' } });
    const { features } = drawn(star);
    const fill = features().find((f) => f.getId() === `${star.id}#fill`)?.getGeometry() as OlMultiPolygon | undefined;
    expect(fill?.getPolygons()).toHaveLength(6);
    expect(features().find((f) => f.getId() === `${star.id}#fill`)?.get(P.hatch)).toBe(1);
    const middle = mercator.forward([12, 61]);
    const outside = mercator.forward([14, 62]); // lon and lat both beyond the star
    if (middle === null || outside === null) throw new Error('not on the map');
    expect(fill?.intersectsCoordinate([...middle])).toBe(true);
    expect(fill?.intersectsCoordinate([...outside])).toBe(false);
    // A longitude where the latitude is not the same number: the point (12, 61) is not (61, 12).
    const swapped = mercator.forward([61, 12]);
    expect(swapped === null ? false : fill?.intersectsCoordinate([...swapped])).toBe(false);
  });

  it('cuts a hole out of the lobe that holds it (M8: a bow tie with a hole had one lobe left empty), a hole in a polygon that does not cross itself stays as before', () => {
    const hole: [number, number][] = [[10.3, 59.2], [10.9, 59.2], [10.9, 59.8], [10.3, 59.8], [10.3, 59.2]]; // in the left lobe
    const withHole = object(32, layer(1).id, 'core.shape', { type: 'Polygon', coordinates: [BOW_TIE.coordinates[0] as [number, number][], hole] }, { style: { fillColor: '#00aa00' } });
    const square = object(33, layer(1).id, 'core.shape', { type: 'Polygon', coordinates: [[[20, 58], [24, 58], [24, 61], [20, 61], [20, 58]], [[21, 59], [22, 59], [22, 60], [21, 60], [21, 59]]] });
    const { features } = drawn(withHole, square);
    const fill = features().find((f) => f.getId() === `${withHole.id}#fill`)?.getGeometry() as OlMultiPolygon | undefined;
    expect(fill?.getPolygons()).toHaveLength(2);
    const at = (lon: number, lat: number) => {
      const xy = mercator.forward([lon, lat]);
      if (xy === null) throw new Error('not on the map');
      return [...xy];
    };
    expect(fill?.intersectsCoordinate(at(10.15, 59.5))).toBe(true); // the left lobe beside the hole
    expect(fill?.intersectsCoordinate(at(10.6, 59.5))).toBe(false); // the hole
    expect(fill?.intersectsCoordinate(at(13.5, 59.5))).toBe(true); // the right lobe
    expect(features().find((f) => f.getId() === withHole.id)?.get(P.fill)).toEqual([0, 170, 0, 0]); // the outline's own feature keeps the outline and the hole's, no fill
    expect(features().find((f) => f.getId() === `${square.id}#fill`)).toBeUndefined(); // no crossing: one feature
  });

  it('draws a polygon that does not cross itself as before: one feature, with its fill', () => {
    const square = object(32, layer(1).id, 'core.shape', ring([10, 58], [14, 58], [14, 61], [10, 61]), { style: { fillColor: '#00aa00', fillOpacity: 0.5 } });
    const { features } = drawn(square);
    expect(features().map((f) => String(f.getId()))).toEqual([square.id]);
    expect(features()[0]?.get(P.fill)).toEqual([0, 170, 0, 0.5]);
  });

  it('is not picked, goes with its polygon when it changes or is deleted, and the outline is still picked', () => {
    const bow = object(33, layer(1).id, 'core.shape', BOW_TIE);
    const { engine, controller, map, clock, features } = drawn(bow);
    const pixelOf = (lon: number, lat: number): Pixel => {
      const view = engine.view;
      const xy = mercator.forward([lon, lat]);
      if (view === null || xy === null) throw new Error('no view');
      return mapToPixel(view, xy);
    };
    expect(map.pick(pixelOf(11, 60))).toEqual([]); // inside a lobe
    expect(map.pick(pixelOf(14, 59.5))).toEqual([bow.id]); // on the right edge, once
    controller.listener.changes([event(2, { ...bow, version: 2, geometry: ring([10, 58], [14, 58], [14, 61], [10, 61]) })]);
    clock.advance(1_000);
    expect(features().map((f) => String(f.getId()))).toEqual([bow.id]); // now simple: no fill feature
    controller.listener.changes([event(3, { ...bow, version: 3, geometry: BOW_TIE })]);
    clock.advance(1_000);
    expect(features()).toHaveLength(2);
    controller.listener.changes([event(4, null, { id: bow.id, type: 'object' })]);
    clock.advance(1_000);
    expect(features()).toHaveLength(0);
  });
});

describe('OpenLayers engine: right-click while drawing (brief function 27, criterion 53)', () => {
  /** The OpenLayers Draw interaction of the running drawing. */
  const drawOf = (e: OpenLayersEngine) => (e as unknown as { drawing: { interaction: Draw } | null }).drawing?.interaction ?? null;
  const events = (draw: Draw, type: 'drawstart' | 'drawabort' | 'drawend') => {
    draw.dispatchEvent(new DrawEvent(type, new OlFeature(new OlPolygon([[[0, 0], [1, 0], [1, 1], [0, 0]]]))));
  };

  it('takes back the last point of a polygon or a line once a point is set, and has nothing to take back before', () => {
    for (const kind of ['polygon', 'line'] as const) {
      const { e } = engine();
      expect(e.rightClickDrawing()).toBe(false); // nothing drawn
      e.startDrawing(kind, undefined, () => undefined);
      const draw = drawOf(e);
      if (draw === null) throw new Error('no drawing');
      const removed = vi.spyOn(draw, 'removeLastPoint');
      expect(e.rightClickDrawing(), kind).toBe(false); // no point set: Escape
      events(draw, 'drawstart'); // the first point is set
      expect(e.rightClickDrawing(), kind).toBe(true);
      expect(removed).toHaveBeenCalledTimes(1);
      events(draw, 'drawabort'); // OpenLayers aborted the sketch when the last point went
      expect(e.rightClickDrawing(), kind).toBe(false); // none left: the next right click is Escape
      expect(removed).toHaveBeenCalledTimes(1);
    }
  });

  it('leaves a circle, an ellipse, a square and a rectangle alone during the press, and has nothing to do before it', () => {
    for (const kind of ['circle', 'ellipse', 'square', 'rectangle'] as const) {
      const { e } = engine();
      e.startDrawing(kind, undefined, () => undefined);
      const draw = drawOf(e);
      if (draw === null) throw new Error('no drawing');
      const removed = vi.spyOn(draw, 'removeLastPoint');
      expect(e.rightClickDrawing(), kind).toBe(false); // before the press
      events(draw, 'drawstart'); // the press
      expect(e.rightClickDrawing(), kind).toBe(true);
      expect(removed, kind).not.toHaveBeenCalled();
      events(draw, 'drawend'); // released
      expect(e.rightClickDrawing(), kind).toBe(false);
    }
  });

  it("keeps the right button's press and release away from OpenLayers while a shape is drawn, and only then", () => {
    const { e, map } = engine();
    map.setSize([800, 600]); // the engine's own pointer handling needs a size to place an event
    const heard: string[] = [];
    for (const type of ['pointerdown', 'pointerup']) map.getViewport().addEventListener(type, (event) => heard.push(`${type} ${String((event as MouseEvent).button)}`));
    const press = (type: string, button: number) => map.getViewport().dispatchEvent(new MouseEvent(type, { button, bubbles: true }));
    press('pointerdown', 2);
    expect(heard).toEqual(['pointerdown 2']); // nothing drawn: as before
    e.startDrawing('polygon', undefined, () => undefined);
    heard.length = 0;
    press('pointerdown', 2);
    press('pointerup', 2);
    expect(heard).toEqual([]);
    press('pointerdown', 0);
    press('pointerup', 0);
    expect(heard).toEqual(['pointerdown 0', 'pointerup 0']); // the main button as usual
    e.stopDrawing();
    press('pointerdown', 2);
    expect(heard).toHaveLength(3);
  });
});

describe('OpenLayers engine: continuing a line (brief function 44, criterion 105; SDK 1.6.0 part B)', () => {
  /** The OpenLayers Draw interaction of the running drawing, and the line it extends. */
  const drawOf = (e: OpenLayersEngine) => (e as unknown as { drawing: { interaction: Draw; started: boolean } | null }).drawing;
  const OWN = [[14, 60], [15.5, 60.5], [16, 61.5]] as Position[]; // longitude and latitude differ at every point
  const ADDED = [[17, 62], [18.5, 62.5]] as Position[];

  function started(options: { signal?: AbortSignal } = {}) {
    const { e, controller, map, clock, log } = realMapView();
    const L = layer(1);
    const line = object(40, L.id, 'core.shape', { type: 'LineString', coordinates: OWN });
    controller.listener.snapshot({ layers: [L], objects: [line], sequenceNo: 1 });
    clock.advance(5_000);
    map.goTo([15.5, 61], 2000);
    const run = map.append(line.id, options.signal === undefined ? {} : { signal: options.signal });
    const xy = (p: Position): number[] => [...(e.projection.forward(p) ?? [0, 0])];
    const draw = drawOf(e);
    if (draw === null) throw new Error('no drawing');
    /** The user sets points one click at a time (OpenLayers adds each before the pointer's own position). */
    const click = (p: Position) => { draw.interaction.appendCoordinates([xy(p)]); };
    const sketch = () => {
      const geometry = (draw.interaction as unknown as { sketchFeature_: OlFeature<OlLineString> | null }).sketchFeature_?.getGeometry();
      return geometry?.getCoordinates() ?? [];
    };
    return { e, controller, map, clock, log, line, run, draw, click, sketch, xy };
  }

  it('continues from the last point: the sketch is the line with the pointer at its end, and a right click with no point added is Escape', () => {
    const { e, draw, sketch, xy } = started();
    expect(draw.started).toBe(true);
    expect(sketch().slice(0, OWN.length)).toEqual(OWN.map(xy)); // the pointer's own position follows once it moves
    expect(e.rightClickDrawing()).toBe(false); // nothing added: the controller takes it as Escape
    expect(sketch().slice(0, OWN.length)).toEqual(OWN.map(xy)); // the line's own points stay
  });

  it('adds a point to each click; Enter finishes with the line then the added points, the first three unchanged', async () => {
    const { run, click, draw, controller, line } = started();
    click(ADDED[0] as Position);
    click(ADDED[1] as Position);
    draw.interaction.finishDrawing();
    const result = await run;
    expect(result?.type).toBe('LineString');
    expect(result?.coordinates.slice(0, 3)).toEqual(OWN); // exactly, not through the projection
    expect(result?.coordinates).toHaveLength(5);
    ADDED.forEach((p, i) => {
      expect(result?.coordinates[3 + i]?.[0]).toBeCloseTo(p[0], 9);
      expect(result?.coordinates[3 + i]?.[1]).toBeCloseTo(p[1], 9);
    });
    expect(controller.store.objects.get(line.id)?.geometry).toEqual({ type: 'LineString', coordinates: OWN }); // it changes nothing
  });

  it('Backspace and a right click take back an added point, never one the line had; with none left a right click is Escape', () => {
    const { e, click, draw, sketch, xy } = started();
    const removed = vi.spyOn(draw.interaction, 'removeLastPoint');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(removed).not.toHaveBeenCalled(); // nothing added
    click(ADDED[0] as Position);
    click(ADDED[1] as Position);
    expect(sketch()).toHaveLength(OWN.length + 3);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(removed).toHaveBeenCalledTimes(1);
    expect(sketch()).toHaveLength(OWN.length + 2);
    expect(e.rightClickDrawing()).toBe(true);
    expect(sketch()).toHaveLength(OWN.length + 1);
    expect(sketch().slice(0, -1)).toEqual(OWN.map(xy));
    expect(e.rightClickDrawing()).toBe(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(removed).toHaveBeenCalledTimes(2); // only the right click's one; the second Backspace did nothing
  });

  it('finishing with no point added resolves null, and Escape and an abort do too', async () => {
    const first = started();
    first.draw.interaction.finishDrawing();
    expect(await first.run).toBeNull();
    const second = started();
    second.click(ADDED[0] as Position);
    second.controller.service.pick([0, 0]); // anything else leaves it running
    second.e.stopDrawing();
    const abort = new AbortController();
    const third = started({ signal: abort.signal });
    third.click(ADDED[0] as Position);
    abort.abort();
    expect(await third.run).toBeNull();
    expect(drawOf(third.e)).toBeNull();
  });
});

describe('OpenLayers engine: text objects (brief function 45, criterion 106; data model 1.6.0)', () => {
  const L = layer(1);
  const ALPHA = object(60, L.id, 'core.text', { type: 'Point', coordinates: [15.2, 58.4] }, { text: { value: 'Alpha', rotation: 30, size: 20 }, style: { strokeColor: '#ff0000' } });
  const BETA = object(61, L.id, 'core.text', { type: 'Point', coordinates: [16.7, 59.1] }, { text: { value: 'Beta\nGamma' } });
  type Layers = Map<string, { layer: { getZIndex(): number }; source: VectorSource; stack: number; textLayer: VectorLayer | null }>;

  function shown(objects: ReturnType<typeof object>[], options: { threshold?: number } = {}) {
    const { e, controller, map, clock, log } = realMapView();
    controller.listener.snapshot({ layers: [L, layer(2)], objects, sequenceNo: 1 });
    clock.advance(5_000);
    map.goTo([15.2, 58.4], 2000);
    if (options.threshold !== undefined) e.setSymbolOptions(30, options.threshold);
    const entry = () => (e as unknown as { layers: Layers }).layers.get(L.id);
    const styleOf = (id: string) => {
      const layer = entry()?.textLayer;
      const feature = entry()?.source.getFeatureById(id);
      const style = layer?.getStyleFunction()?.(feature as never, 1);
      return Array.isArray(style) ? style[0] : style;
    };
    const pixelOf = (position: [number, number]): Pixel => {
      const view = e.view;
      const xy = mercator.forward(position);
      if (view === null || xy === null) throw new Error('no view');
      return mapToPixel(view, xy);
    };
    return { e, controller, map, clock, log, entry, styleOf, pixelOf };
  }

  it('draws the text at its point with its size, its rotation clockwise from north and its own colour, centred, with the label halo', () => {
    const { styleOf, entry } = shown([ALPHA]);
    const style = styleOf(ALPHA.id);
    const text = style instanceof OlStyle ? style.getText() : null;
    expect(text?.getText()).toBe('Alpha');
    expect(text?.getFont()).toContain('20px');
    expect(text?.getRotation()).toBeCloseTo((30 * Math.PI) / 180, 9); // north is up in Web Mercator
    expect(text?.getRotateWithView()).toBe(false);
    expect(text?.getTextAlign()).toBe('center');
    expect(text?.getTextBaseline()).toBe('middle');
    expect(text?.getFill()?.getColor()).toBe('rgba(255, 0, 0, 1)');
    expect(text?.getStroke()?.getWidth()).toBeGreaterThan(0); // the halo
    const feature = entry()?.source.getFeatureById(ALPHA.id);
    const at = (feature?.getGeometry() as OlPoint).getCoordinates();
    expect(at[0]).toBeCloseTo(mercator.forward([15.2, 58.4])?.[0] ?? Number.NaN, 6);
    expect(at[1]).toBeCloseTo(mercator.forward([15.2, 58.4])?.[1] ?? Number.NaN, 6); // longitude and latitude not swapped
  });

  it('draws a text without a size at 14 pixels and without a colour in the look\'s text colour; line breaks start new lines', () => {
    const { styleOf } = shown([BETA]);
    const style = styleOf(BETA.id);
    const text = style instanceof OlStyle ? style.getText() : null;
    expect(text?.getText()).toBe('Beta\nGamma');
    expect(text?.getFont()).toContain('14px');
    expect(text?.getRotation()).toBe(0);
    expect(text?.getFill()?.getColor()).toBe('rgba(26, 26, 26, 1)'); // DEFAULT_TEXT_LOOK
  });

  it('follows true north in a polar projection: the turn is the rotation plus where north points on the screen', () => {
    const { controller, e, styleOf } = shown([ALPHA]);
    controller.setProjection('EPSG:3413');
    const style = styleOf(ALPHA.id);
    const text = style instanceof OlStyle ? style.getText() : null;
    const north = northOnScreen(e.projection, [15.2, 58.4]);
    expect(Math.abs(north)).toBeGreaterThan(0.1); // it is not up here
    expect(text?.getRotation()).toBeCloseTo(north + (30 * Math.PI) / 180, 9);
  });

  it('is in its layer\'s order: the text layer lies over its own layer and under the next one, and goes when the layer has no text object', () => {
    const { e, controller, entry, clock } = shown([ALPHA, symbolObject(62, layer(2).id, 15.2, 58.4)]);
    const textLayer = entry()?.textLayer;
    expect(textLayer).not.toBeNull();
    const own = entry()?.layer.getZIndex() ?? 0;
    const next = (e as unknown as { layers: Layers }).layers.get(layer(2).id)?.layer.getZIndex() ?? 0;
    expect(textLayer?.getZIndex()).toBeGreaterThan(own);
    expect(textLayer?.getZIndex()).toBeLessThan(next);
    expect((e as unknown as { layers: Layers }).layers.get(layer(2).id)?.textLayer).toBeNull(); // no text in it: no text layer
    controller.listener.changes([event(2, null, { id: ALPHA.id, type: 'object' })]);
    clock.advance(2_000);
    expect(entry()?.textLayer).toBeNull(); // the last text object of the layer went
  });

  it('is always drawn: the text threshold hides symbol texts and labels, not a text object', () => {
    const { styleOf, e } = shown([ALPHA, symbolObject(63, L.id, 15.2, 58.4), symbolObject(64, L.id, 15.3, 58.4)], { threshold: 1 });
    expect(styleOf(ALPHA.id)).toBeInstanceOf(OlStyle);
    const labels = (e as unknown as { labels: VectorSource }).labels;
    expect(labels.getFeatures()).toHaveLength(0);
  });

  it('is picked and box-selected on its text\'s box, not elsewhere, ', () => {
    const { map, pixelOf } = shown([ALPHA]);
    const at = pixelOf([15.2, 58.4]);
    expect(map.pick(at)).toEqual([ALPHA.id]);
    expect(map.pick([at[0] + 25, at[1] + 6])).toEqual([ALPHA.id]); // beside the middle, inside the turned box (width 60, height 24)
    expect(map.pick([at[0] + 120, at[1]])).toEqual([]);
    expect(map.pick([at[0], at[1] + 90])).toEqual([]);
  });

  describe('its box is its measured text (SN A, owner, 2026-11-12: a long text was not picked near its end)', () => {
    /** A browser that measures: 'W' 18 pixels, 'i' 5, an East Asian character 20, any other 10; a font called Wide twice that. */
    function measuring() {
      const asked: string[] = [];
      const ctx = {
        font: '',
        measureText(text: string) {
          asked.push(this.font);
          const width = Array.from(text).reduce((sum, c) => sum + (c === 'W' ? 18 : c === 'i' ? 5 : (c.codePointAt(0) ?? 0) > 0x2e80 ? 20 : 10), 0);
          return { width: this.font.includes('Wide') ? 2 * width : width };
        },
      };
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
      return asked;
    }
    const textObject = (n: number, value: string) => object(n, L.id, 'core.text', { type: 'Point', coordinates: [15.2, 58.4] }, { text: { value, size: 20 } });

    it('is picked near the end of a long or wide text, which the guess of 0.6 em a character put outside', () => {
      const wide = textObject(70, 'WWWWWWWWWW'); // 180 pixels, guessed 120
      const { map, pixelOf } = shown([wide]);
      const asked = measuring();
      const at = pixelOf([15.2, 58.4]);
      expect(map.pick([at[0] + 90, at[1]], 0)).toEqual([wide.id]); // the box is 184 wide with its margin
      expect(map.pick([at[0] - 90, at[1]], 0)).toEqual([wide.id]);
      expect(map.pick([at[0] + 94, at[1]], 0)).toEqual([]);
      expect(asked[0]).toContain('20px'); // in the font the text is drawn in
    });

    it('is not picked beyond a narrow text, which the guess had let be picked far from it', () => {
      const narrow = textObject(71, 'iiiiiiiiii'); // 50 pixels, guessed 120
      const { map, pixelOf } = shown([narrow]);
      measuring();
      const at = pixelOf([15.2, 58.4]);
      expect(map.pick([at[0] + 25, at[1]], 0)).toEqual([narrow.id]);
      expect(map.pick([at[0] + 40, at[1]], 0)).toEqual([]);
    });

    it('is picked on non-ASCII text as the browser measures it', () => {
      const japanese = textObject(72, '日本語'); // 60 pixels, guessed 36
      const { map, pixelOf } = shown([japanese]);
      measuring();
      const at = pixelOf([15.2, 58.4]);
      expect(map.pick([at[0] + 30, at[1]], 0)).toEqual([japanese.id]);
      expect(map.pick([at[0] + 36, at[1]], 0)).toEqual([]);
    });

    it('takes the widest line of several', () => {
      const two = textObject(73, 'ii\nWWWW'); // 72 pixels wide
      const { map, pixelOf } = shown([two]);
      measuring();
      const at = pixelOf([15.2, 58.4]);
      expect(map.pick([at[0] + 37, at[1]], 0)).toEqual([two.id]);
      expect(map.pick([at[0] + 41, at[1]], 0)).toEqual([]);
    });

    it('frames the selected text on the measured box, and again when the look font changes the width', () => {
      const wide = textObject(74, 'WWWWWWWWWW');
      const { e, map } = shown([wide]);
      measuring();
      map.selection.set([wide.id]);
      const frame = (): number => {
        const feature = (e as unknown as { highlightSource: VectorSource }).highlightSource.getFeatures()[0];
        const style = feature?.getStyle();
        const first = Array.isArray(style) ? style[0] : style;
        const renderer = first instanceof OlStyle ? first.getRenderer() : null;
        const rects: number[][] = [];
        const context = { save() {}, restore() {}, translate() {}, rotate() {}, strokeRect: (...rect: number[]) => rects.push(rect), strokeStyle: '', lineWidth: 0 };
        (renderer as unknown as (c: number[], s: unknown) => void)([100, 100], { context, pixelRatio: 1 });
        return rects[0]?.[2] ?? Number.NaN;
      };
      expect(frame()).toBe(180 + 2 * 3); // the box and the frame's gap on both sides
      e.setTextLook({ ...textLookFrom(FAKE_TOKEN_VALUES), font: 'Wide, sans-serif' });
      expect(frame()).toBe(360 + 2 * 3);
    });
  });

  it('is picked before the other items of its layer, and turned with its text: a point beyond the unturned box\'s corner is inside the turned one', () => {
    const { map, pixelOf } = shown([ALPHA, symbolObject(65, L.id, 15.2, 58.4)]);
    const at = pixelOf([15.2, 58.4]);
    expect(map.pick(at)[0]).toBe(ALPHA.id); // the symbol was made after it, and is picked second
    expect(map.pick([at[0] + 26, at[1] + 15], 0)).toEqual([ALPHA.id]); // along the text's own axis, 30 degrees down: inside the box only when it is turned
    expect(map.pick([at[0] + 26, at[1] - 15], 0)).toEqual([]);
  });

  it('follows its layer: hidden with it, and over the new place when the layer\'s order changes', () => {
    const { e, map, entry } = shown([ALPHA]);
    map.setLayerVisible(L.id, false);
    expect(entry()?.textLayer?.getVisible()).toBe(false);
    map.setLayerVisible(L.id, true);
    expect(entry()?.textLayer?.getVisible()).toBe(true);
    e.setLayers([{ id: L.id, stack: 7, visible: true }, { id: layer(2).id, stack: 8, visible: true }]);
    expect(entry()?.layer.getZIndex()).toBe(17);
    expect(entry()?.textLayer?.getZIndex()).toBe(17.5);
  });

  it('is faded with its object, and counted as one object', () => {
    const { map, styleOf } = shown([ALPHA, BETA]);
    const list = map.createFadeList();
    list.set([ALPHA.id]);
    const fill = (style: unknown) => (style instanceof OlStyle ? style.getText()?.getFill()?.getColor() : undefined);
    expect(fill(styleOf(ALPHA.id))).not.toBe('rgba(255, 0, 0, 1)'); // faded
    expect(fill(styleOf(BETA.id))).toBe('rgba(26, 26, 26, 1)'); // the other not
    list.clear();
    expect(fill(styleOf(ALPHA.id))).toBe('rgba(255, 0, 0, 1)');
  });
});

describe('OpenLayers engine: tactical graphics (brief functions 29 and 30, criteria 61 to 66)', () => {
  const BOUNDARY: MilSymbol = { standard: 'APP-6D', sidc: '10032500001101000000' };

  /** A real map view with the fake symbology service, a layer and the objects given; the answers are in. */
  async function graphics(objects: (layerId: string) => ReturnType<typeof object>[], options: { service?: ReturnType<typeof createFakeSymbolService>; centre?: [number, number] } = {}) {
    const { e: engine, controller, map, clock, log } = realMapView();
    if (options.centre !== undefined) map.goTo(options.centre, 3000);
    const service = options.service ?? createFakeSymbolService();
    controller.setSymbols(service);
    const L = layer(1);
    const objs = objects(L.id);
    controller.listener.snapshot({ layers: [L], objects: objs, sequenceNo: 1 });
    clock.advance(5_000);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      clock.advance(1_000);
    }
    const source = () => (engine as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source;
    const features = () => source()?.getFeatures() ?? [];
    const pixelOf = (lon: number, lat: number): Pixel => {
      const view = engine.view;
      const xy = mercator.forward([lon, lat]);
      if (view === null || xy === null) throw new Error('no view');
      return mapToPixel(view, xy);
    };
    return { engine, controller, map, clock, log, service, L, objs, features, pixelOf };
  }

  // Longitude and latitude differ everywhere: a swapped pair would be far away.
  const LINE = [[14, 60], [16, 61], [18, 60.5]] as [number, number][];

  it('criterion 61: draws a boundary as a line through its control points, not as the marker', async () => {
    const { features, objs, engine } = await graphics((l) => [object(40, l, 'core.multipoint', { type: 'LineString', coordinates: LINE }, { symbol: BOUNDARY })]);
    const id = objs[0]?.id ?? '';
    expect(features().map((f) => String(f.getId()))).toEqual([`${id}#g0`]); // no marker
    const line = features()[0]?.getGeometry();
    if (!(line instanceof OlLineString)) throw new Error('not a line');
    const view = engine.view;
    if (view === null) throw new Error('no view');
    // Within a pixel of the projected control points.
    line.getCoordinates().forEach((c, i) => {
      const expected = mercator.forward(LINE[i] as [number, number]) as [number, number];
      expect(Math.hypot((c[0] as number) - expected[0], (c[1] as number) - expected[1]) / view.resolution).toBeLessThan(1);
    });
  });

  it('criterion 63: is the marker at the first point when the service refuses, and for an APP-6B graphic', async () => {
    const make = (symbol: MilSymbol) => (l: string) => [object(41, l, 'core.multipoint', { type: 'LineString', coordinates: LINE }, { symbol })];
    const refusing = createFakeSymbolService();
    refusing.refuse('no amplifier');
    const cases: [MilSymbol, ReturnType<typeof createFakeSymbolService> | undefined][] = [[BOUNDARY, refusing], [{ standard: 'APP-6B', sidc: 'GFGPGLB----K---' }, undefined]];
    for (const [symbol, service] of cases) {
      const { features, objs } = await graphics(make(symbol), service === undefined ? {} : { service });
      const id = objs[0]?.id ?? '';
      expect(features().map((f) => String(f.getId())), symbol.standard).toEqual([id]);
      const marker = features()[0];
      expect(marker?.get(P.kind)).toBe(KIND.fallback);
      const at = mercator.forward(LINE[0] as [number, number]) as [number, number];
      expect((marker?.getGeometry() as OlPoint).getCoordinates()).toEqual(at);
    }
  });

  it('criterion 65: in EPSG:3857 a phase line from 179° E to 179° W is a short line, not across the world', async () => {
    const { features, objs } = await graphics((l) => [object(42, l, 'core.multipoint', { type: 'LineString', coordinates: [[179, 60], [-179, 61]] }, { symbol: BOUNDARY })], { centre: [180, 60] });
    const line = features().find((f) => String(f.getId()) === `${objs[0]?.id ?? ''}#g0`)?.getGeometry();
    if (!(line instanceof OlLineString)) throw new Error('not a line');
    const [a, b] = line.getCoordinates() as [number[], number[]];
    expect(Math.abs((b[0] as number) - (a[0] as number))).toBeLessThan(300_000); // about 220 km, not 40 000 km
  });

  it('criterion 66: a click on the line selects the graphic, inside an area graphic fill does not, a box over part of a line does; the highlight shows on its lines', async () => {
    const service = createFakeSymbolService();
    const real = service.renderGraphic.bind(service);
    // The fake draws the line only: a fill is added for this test.
    service.renderGraphic = async (request) => {
      const answer = await real(request);
      if (!answer.ok) return answer;
      const ring = new Float64Array([...request.points.flat(), ...(request.points[0] ?? [])]);
      return { ...answer, fills: [{ rings: [ring], color: '#ff0000', opacity: 0.4 }] };
    };
    const square: [number, number][] = [[12, 59], [16, 59], [16, 62], [12, 62]];
    const { map, objs, pixelOf, engine, controller } = await graphics((l) => [object(43, l, 'core.multipoint', { type: 'LineString', coordinates: square }, { symbol: BOUNDARY })], { service });
    const id = objs[0]?.id ?? '';
    expect(map.pick(pixelOf(14, 59))).toEqual([id]); // on the bottom edge
    expect(map.pick(pixelOf(14, 60.5))).toEqual([]); // inside the fill
    const click = (pixel: Pixel) => {
      (engine as unknown as { emitPointer(type: string, pixel: Pixel): void }).emitPointer('click', pixel);
    };
    click(pixelOf(14, 59));
    expect(map.selection.value).toEqual([id]);
    click(pixelOf(14, 60.5));
    expect(map.selection.value).toEqual([]);
    // A box over part of a line selects it.
    const [x, y] = pixelOf(14, 59);
    (controller as unknown as { selectBox(box: { from: Pixel; to: Pixel }): void }).selectBox({ from: [x - 10, y - 10], to: [x + 10, y + 10] });
    expect(map.selection.value).toEqual([id]);
    const highlighted = (engine as unknown as { highlightSource: VectorSource }).highlightSource.getFeatures();
    expect(highlighted.length).toBeGreaterThanOrEqual(2); // its line and the fill's outline
  });

  it('criterion 64: graphics lie over the shapes and under the symbols: the style draws their fills and lines after the shapes and before the markers and symbols', () => {
    const rules = layerStyle({ atlas: 'data:atlas', arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
    const of = (kind: number, key: string) => rules.findIndex((r) => JSON.stringify(r.filter).includes(`["get","${P.kind}"],${String(kind)}]`) && key in r.style);
    const shapeFill = of(KIND.polygon, 'fill-color');
    const shapeStroke = of(KIND.polygon, 'stroke-color');
    const graphicFill = of(KIND.gfill, 'fill-color');
    const graphicLine = of(KIND.gline, 'stroke-color');
    const marker = rules.findIndex((r) => 'circle-radius' in r.style && JSON.stringify(r.filter).includes(String(KIND.fallback)));
    const symbol = rules.findIndex((r) => 'icon-offset' in r.style);
    expect(shapeFill).toBeGreaterThanOrEqual(0);
    expect(shapeStroke).toBeGreaterThanOrEqual(0);
    expect(graphicFill).toBeGreaterThan(shapeStroke);
    expect(graphicLine).toBeGreaterThan(graphicFill);
    expect(marker).toBeGreaterThan(graphicLine);
    expect(symbol).toBeGreaterThan(graphicLine);
  });

  it('draws dashes, widths and colours as the service gives them, and fades them with the object', async () => {
    const service = createFakeSymbolService();
    service.renderGraphic = () => Promise.resolve({
      ok: true as const,
      lines: [{ coordinates: new Float64Array([14, 60, 18, 61]), color: '#ff0000', opacity: 0.5, width: 3, dash: [8, 4] }, { coordinates: new Float64Array([14, 59, 18, 60]), color: '#00ff00', width: 1 }],
      fills: [{ rings: [new Float64Array([14, 59, 18, 59, 16, 62])], color: '#0000ff', opacity: 0.25, pattern: 'hatch' as const }],
      labels: [],
    });
    const { features, objs, controller, clock } = await graphics((l) => [object(44, l, 'core.multipoint', { type: 'LineString', coordinates: LINE }, { symbol: BOUNDARY })], { service });
    const id = objs[0]?.id ?? '';
    const byId = (n: number) => features().find((f) => f.getId() === `${id}#g${String(n)}`);
    expect(byId(0)?.get(P.kind)).toBe(KIND.gfill); // fills first
    expect(byId(0)?.get(P.fill)).toEqual([0, 0, 255, 0.25]);
    expect(byId(0)?.get(P.hatch)).toBe(1);
    expect(byId(1)?.get(P.stroke)).toEqual([255, 0, 0, 0.5]);
    expect([byId(1)?.get(P.strokeWidth), byId(1)?.get(P.dash)]).toEqual([3, 1]); // the first pattern seen: the style's rule 1 draws [8, 4]
    expect([byId(2)?.get(P.stroke), byId(2)?.get(P.dash)]).toEqual([[0, 255, 0, 1], 0]);
    // A fade list fades all of it (brief function 24).
    controller.service.createFadeList().set([objs[0]?.id as string]);
    clock.advance(5_000);
    expect(byId(1)?.get(P.stroke)).toEqual([255, 0, 0, 0.5 * 0.4]);
    expect(byId(0)?.get(P.fill)).toEqual([0, 0, 255, 0.25 * 0.4]);
  });

  it('removes a graphic features when it is deleted', async () => {
    const { features, objs, controller, clock } = await graphics((l) => [object(45, l, 'core.multipoint', { type: 'LineString', coordinates: LINE }, { symbol: BOUNDARY })]);
    const first = objs[0] as ReturnType<typeof object>;
    expect(features()).toHaveLength(1);
    controller.listener.changes([event(2, null, { id: first.id, type: 'object' })]);
    clock.advance(2_000);
    expect(features()).toHaveLength(0);
  });
});

describe('OpenLayers engine: placing and editing a graphic (brief function 32, criteria 68 and 69)', () => {
  const drawOf = (e: OpenLayersEngine) => (e as unknown as { drawing: { interaction: Draw } | null }).drawing?.interaction ?? null;
  const pressEnter = () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  /** Starts a drawing of a line with a graphic's limits and puts a sketch of `n` points set (and the pointer) on it. */
  function sketching(options: { minPoints: number; maxPoints: number | null }) {
    const { e } = engine();
    const sketches: number[][][] = [];
    e.startDrawing('line', undefined, () => undefined, { ...options, onSketch: (points) => sketches.push(points.map((p) => [...p])) });
    const draw = drawOf(e);
    if (draw === null) throw new Error('no drawing');
    const finish = vi.spyOn(draw, 'finishDrawing');
    const feature = new OlFeature(new OlLineString([[0, 0], [0, 0]]));
    draw.dispatchEvent(new DrawEvent('drawstart', feature));
    /** `n` points set: the sketch has them and the pointer. */
    const setPoints = (n: number) => {
      (feature.getGeometry() as OlLineString).setCoordinates(Array.from({ length: n + 1 }, (_, i) => [i * 1000, i * 500]));
    };
    return { e, draw, finish, setPoints, sketches };
  }

  it('does not finish before the graphic\'s minimum: Enter leaves the line and the drawing goes on', () => {
    const { finish, setPoints } = sketching({ minPoints: 3, maxPoints: null });
    setPoints(2);
    pressEnter();
    expect(finish).not.toHaveBeenCalled();
    setPoints(3);
    pressEnter();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('finishes by itself at the graphic\'s maximum', async () => {
    const { finish, setPoints } = sketching({ minPoints: 2, maxPoints: 2 });
    setPoints(1);
    await Promise.resolve();
    expect(finish).not.toHaveBeenCalled();
    setPoints(2); // the second click: a graphic with a maximum of 2 is done
    await Promise.resolve();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('reports the points set and the pointer as the sketch changes, and nothing when the sketch is aborted', () => {
    const { draw, setPoints, sketches } = sketching({ minPoints: 3, maxPoints: null });
    expect(sketches.at(-1)).toHaveLength(2); // the first point and the pointer
    setPoints(3);
    expect(sketches.at(-1)).toEqual([[0, 0], [1000, 500], [2000, 1000], [3000, 1500]]);
    draw.dispatchEvent(new DrawEvent('drawabort', new OlFeature(new OlLineString([[0, 0], [1, 1]]))));
    expect(sketches.at(-1)).toEqual([]);
  });

  it('hides and shows the plain preview line', () => {
    const { e, draw } = sketching({ minPoints: 3, maxPoints: null });
    expect(draw.getOverlay().getVisible()).toBe(true);
    e.setDrawingPlain(false);
    expect(draw.getOverlay().getVisible()).toBe(false);
    e.setDrawingPlain(true);
    expect(draw.getOverlay().getVisible()).toBe(true);
  });

  it('a drawing without a graphic is as before: Enter finishes at once, and nothing is reported', () => {
    const { e } = engine();
    e.startDrawing('line', undefined, () => undefined);
    const draw = drawOf(e);
    if (draw === null) throw new Error('no drawing');
    const finish = vi.spyOn(draw, 'finishDrawing');
    pressEnter();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('shows a handle on each point of an edited line, and reports the shape while it is dragged', () => {
    const { e, map } = engine();
    map.setSize([800, 600]);
    const changes: unknown[] = [];
    const tools = { reshape: () => null, move: () => null };
    e.startEditing({ kind: 'line', points: [[0, 0], [1000, 0], [1000, 1000]] }, undefined, tools, () => undefined, { vertexHandles: true, onChange: (shape) => changes.push(shape) });
    const editing = (e as unknown as { editing: { layer: { getSource(): VectorSource } } | null }).editing;
    const body = editing?.layer.getSource().getFeatures()[0];
    const style = body?.getStyle() as (feature: unknown) => OlStyle[];
    const styles = style(body);
    // The preview's styles and one more, whose geometry is the line's points.
    const handles = styles.at(-1)?.getGeometryFunction()(body as never);
    expect((handles as OlMultiPoint).getCoordinates()).toEqual([[0, 0], [1000, 0], [1000, 1000]]);
    (body?.getGeometry() as OlLineString).setCoordinates([[0, 0], [1000, 0], [1500, 1200]]); // a point dragged
    expect(changes.at(-1)).toEqual({ kind: 'line', points: [[0, 0], [1000, 0], [1500, 1200]] });
    e.stopEditing();
  });
});

describe('OpenLayers engine: the labels of a tactical graphic follow the text threshold (brief function 29)', () => {
  const BOUNDARY: MilSymbol = { standard: 'APP-6D', sidc: '10032500001101000000' };

  it('draws a graphic\'s labels in the service\'s font, colour, angle and alignment, with no halo, and counts a graphic once toward the threshold', async () => {
    const service = createFakeSymbolService();
    service.renderGraphic = (request) => Promise.resolve({
      ok: true as const,
      lines: [{ coordinates: new Float64Array(request.points.flat()), color: '#000000', width: 2 }, { coordinates: new Float64Array(request.points.flatMap(([lon, lat]) => [lon, (lat) + 0.05])), color: '#000000', width: 1 }],
      fills: [],
      labels: [
        { position: request.points[0] as [number, number], text: 'A', angle: 45, font: 'bold 14px serif', color: '#ff0000', halo: '#ffffff', align: 'right' as const },
        { position: request.points[1] as [number, number], text: 'B', angle: 0, font: '12px sans-serif', color: '#0000ff', align: 'left' as const },
      ],
    });
    const { e: engine, controller, clock } = realMapView();
    controller.setSymbols(service);
    const L = layer(1);
    const graphicAt = (n: number, lat: number) => object(n, L.id, 'core.multipoint', { type: 'LineString', coordinates: [[14, lat], [16, lat + 0.5]] }, { symbol: BOUNDARY });
    controller.listener.snapshot({ layers: [L], objects: [graphicAt(50, 61), graphicAt(51, 62), graphicAt(52, 63)], sequenceNo: 1 });
    clock.advance(5_000);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      clock.advance(1_000);
    }
    const labels = () => (engine as unknown as { labels: VectorSource }).labels.getFeatures();
    const refresh = () => {
      (engine as unknown as { refreshLabels(): void }).refreshLabels();
    };
    refresh();
    expect(labels()).toHaveLength(6); // two labels of each of the three graphics
    const text = (labels()[0]?.getStyle() as OlStyle).getText();
    expect([text?.getText(), text?.getFont(), text?.getRotation(), text?.getTextAlign()]).toEqual(['A', 'bold 14px serif', Math.PI / 4, 'right']);
    expect(text?.getFill()?.getColor()).toBe('rgba(255, 0, 0, 1)');
    expect(text?.getStroke()).toBeNull(); // no halo in M5 (owner, 2026-11-06)
    // One graphic counts as one: with room for three all labels show; above it, as for symbols and shapes, none at all.
    engine.setSymbolOptions(30, 3);
    refresh();
    expect(labels()).toHaveLength(6);
    engine.setSymbolOptions(30, 2);
    refresh();
    expect(labels()).toHaveLength(0);
    engine.setSymbolOptions(30, 0);
    refresh();
    expect(labels()).toHaveLength(0);
  });
});

describe('OpenLayers engine: images inside tactical graphics (brief function 37, criteria 89 to 92; SDK 1.5.0 part 2)', () => {
  const BOUNDARY: MilSymbol = { standard: 'APP-6D', sidc: '10032500001101000000' };
  const FROM: Position = [15.10, 58.38];
  const TO: Position = [15.30, 58.44];
  const CENTRE: Position = [15.20, 58.41]; // latitude ≠ longitude
  const made: HTMLImageElement[] = [];

  beforeEach(() => {
    made.length = 0;
    const RealImage = globalThis.Image;
    // The images the engine makes: real elements that jsdom does not load, so a test says when one is decoded.
    vi.stubGlobal('Image', function FakeImage() {
      const image = new RealImage();
      Object.defineProperty(image, 'naturalWidth', { value: 16 });
      Object.defineProperty(image, 'naturalHeight', { value: 16 });
      made.push(image);
      return image;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A real map view and the fake symbology service; one phase line (more graphics on request), the answers in. */
  async function drawn(images: SymbolServiceImages, options: { graphics?: number; modifiers?: MilSymbol['modifiers'] } = {}) {
    const service = createFakeSymbolService();
    service.withImages(images);
    const { e: engine, controller, map, clock } = realMapView();
    map.goTo(CENTRE, 3000);
    controller.setSymbols(service);
    const L = layer(1);
    const objs = Array.from({ length: options.graphics ?? 1 }, (_, i) => object(50 + i, L.id, 'core.multipoint',
      { type: 'LineString', coordinates: [FROM, TO] }, { symbol: { ...BOUNDARY, ...(options.modifiers === undefined ? {} : { modifiers: options.modifiers }) } }));
    controller.listener.snapshot({ layers: [L], objects: objs, sequenceNo: 1 });
    const settle = async () => {
      clock.advance(5_000);
      for (let i = 0; i < 8; i++) {
        await Promise.resolve();
        clock.advance(1_000);
      }
    };
    await settle();
    const labels = () => (engine as unknown as { labels: VectorSource }).labels.getFeatures();
    const refresh = () => {
      (engine as unknown as { refreshLabels(): void }).refreshLabels();
    };
    const iconsOf = () => labels().flatMap((f) => {
      const image = (f.getStyle() as OlStyle).getImage();
      return image !== null && 'getRotation' in image && 'getScaleArray' in image ? [{ feature: f, icon: image as Icon }] : [];
    });
    /** Draws the labels (which asks for the images), lets the images decode, and draws them again. */
    const show = () => {
      refresh();
      for (const image of made) image.onload?.(new Event('load'));
      refresh();
    };
    return { engine, controller, map, clock, service, L, objs, labels, refresh, iconsOf, show, settle };
  }
  type SymbolServiceImages = Parameters<ReturnType<typeof createFakeSymbolService>['withImages']>[0];

  it('criterion 89: draws an image centred on its position, 16 by 16 pixels, turned 30° clockwise, after the lines and under the label; without images it is as in M5', async () => {
    const { engine, labels, refresh, iconsOf, show, objs } = await drawn([fakeGraphicImage(CENTRE, 30)], { modifiers: { uniqueDesignation: 'A' } });
    refresh();
    expect(iconsOf()).toHaveLength(0); // still decoding: the graphic draws without it
    expect(made).toHaveLength(1);
    show();
    const [one, ...more] = iconsOf();
    expect(more).toHaveLength(0);
    const xy = mercator.forward(CENTRE);
    expect(xy).not.toBeNull();
    expect((one?.feature.getGeometry() as Point).getCoordinates()).toEqual(xy);
    expect(one?.icon.getRotation()).toBeCloseTo((30 * Math.PI) / 180, 9);
    expect(one?.icon.getScaleArray()).toEqual([1, 1]); // 16 by 16 pixels wanted, 16 by 16 given
    expect(one?.icon.getRotateWithView()).toBe(false);
    // The label comes after the image, so it lies over it; the lines are WebGL features under both.
    const kinds = labels().map((f) => ((f.getStyle() as OlStyle).getText() === null ? 'image' : 'text'));
    expect(kinds).toEqual(['image', 'text']);
    const source = (engine as unknown as { layers: Map<string, { source: VectorSource }> }).layers.values().next().value?.source;
    expect(source?.getFeatures().map((f) => String(f.getId()))).toEqual([`${objs[0]?.id ?? ''}#g0`]); // the line only: an image is not a feature of the layer
  });

  it('criterion 89: scales the image to the wanted size, and without images a graphic has none', async () => {
    const wide = { ...fakeGraphicImage(CENTRE), width: 32, height: 8 };
    const { iconsOf, show } = await drawn([wide]);
    show();
    expect(iconsOf()[0]?.icon.getScaleArray()).toEqual([2, 0.5]);
    made.length = 0;
    const plain = await drawn(null);
    plain.show();
    expect(made).toHaveLength(0);
    expect(plain.iconsOf()).toHaveLength(0);
  });

  it('criterion 90: only an SVG data URI is the source of an image; anything else is not drawn and nothing is requested for it', async () => {
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);
    const good = fakeGraphicImage(CENTRE);
    const { iconsOf, show } = await drawn([
      { ...good, svg: 'data:text/html,<script>alert(1)</script>' },
      { ...good, svg: 'https://example.com/mine.svg' },
      { ...good, svg: 'javascript:alert(1)' },
      { ...good, svg: '' },
      { ...good, width: 0 },
      { ...good, angle: Number.NaN },
      { ...good, position: [Number.NaN, 58] },
      good,
    ]);
    show();
    expect(made.map((image) => image.src)).toEqual([FAKE_GRAPHIC_IMAGE_SVG]); // one image, from a data URI: nothing else was made
    expect(iconsOf()).toHaveLength(1);
    expect(fetched).not.toHaveBeenCalled();
  });

  it('criterion 90: an answer with only images that are not SVG data URIs makes no image at all', async () => {
    const { iconsOf, show } = await drawn([{ ...fakeGraphicImage(CENTRE), svg: 'https://example.com/mine.svg' }, { ...fakeGraphicImage(CENTRE), svg: 'data:text/html,<b>x</b>' }]);
    show();
    expect(made).toHaveLength(0);
    expect(iconsOf()).toHaveLength(0);
  });

  it('criterion 91: 100 graphics with the same svg decode it once', async () => {
    const { iconsOf, show } = await drawn([fakeGraphicImage(CENTRE)], { graphics: 100 });
    show();
    expect(made).toHaveLength(1);
    expect(iconsOf().length).toBeGreaterThan(0);
  });

  it("criterion 92: the next answer's images replace the last ones (the controller test shows the zoom that asks for it)", async () => {
    const { engine, L, objs, labels, iconsOf, show } = await drawn([fakeGraphicImage(CENTRE, 30)]);
    show();
    expect(iconsOf()).toHaveLength(1);
    const id = objs[0]?.id ?? '';
    const before = (engine as unknown as { items: Map<string, Map<string, DrawItem>> }).items.get(L.id)?.get(id);
    if (before?.kind !== 'graphic' || before.parts === null) throw new Error('not drawn');
    const after: Position = [15.25, 58.43];
    engine.updateItems(L.id, new Map([[id, { ...before, parts: { ...before.parts, images: [fakeGraphicImage(after, 90)] } }]]));
    show();
    const icons = iconsOf();
    expect(icons).toHaveLength(1);
    expect(icons[0]?.icon.getRotation()).toBeCloseTo(Math.PI / 2, 9);
    expect((icons[0]?.feature.getGeometry() as Point).getCoordinates()).toEqual(mercator.forward(after));
    expect(labels().filter((f) => (f.getStyle() as OlStyle).getText() === null)).toHaveLength(1);
    expect(made).toHaveLength(1); // the same svg: decoded once
  });

  it('criterion 92: a faded graphic\'s image has the graphic\'s lower opacity; a click on an image selects nothing', async () => {
    const away: Position = [15.20, 58.62]; // about 25 km north of the line (the map is at 3 km a pixel here): well clear of the pick tolerance
    const { map, objs, show, iconsOf, settle, engine } = await drawn([fakeGraphicImage(away)]);
    show();
    expect(iconsOf()[0]?.icon.getOpacity()).toBe(1);
    const fade = map.createFadeList();
    fade.set([objs[0]?.id ?? '']);
    await settle();
    show();
    expect(iconsOf()[0]?.icon.getOpacity()).toBeLessThan(1);
    fade.clear();
    const view = engine.view;
    const xy = mercator.forward(away);
    if (view === null || xy === null) throw new Error('no view');
    expect(map.pick(mapToPixel(view, xy), 4)).toEqual([]);
  });

  it('criterion 92: the preview shows the images', async () => {
    const { engine, L } = await drawn(null);
    const item = {
      id: 'preview', layerId: L.id, kind: 'graphic' as const, symbol: BOUNDARY, points: [FROM, TO],
      parts: { ok: true as const, lines: [], fills: [], labels: [], images: [fakeGraphicImage(CENTRE, 45)] },
    };
    engine.setDragPreview(item); // asks for the image
    expect(made).toHaveLength(1);
    made[0]?.onload?.(new Event('load')); // decoded: the preview is drawn again
    const preview = () => (engine as unknown as { previewSource: VectorSource }).previewSource.getFeatures();
    expect(preview().some((f) => ((f.getStyle() as OlStyle).getImage() as Icon | null)?.getRotation() === (45 * Math.PI) / 180)).toBe(true);
  });
});

describe('OpenLayers engine: the whole dash pattern, the short way across the antimeridian and hatched fills of a graphic (T-144 follow-up)', () => {
  const BOUNDARY: MilSymbol = { standard: 'APP-6D', sidc: '10032500001101000000' };
  const LINE_AT = [[14, 60], [16, 61]] as [number, number][];

  it('normalizes a dash pattern: the whole pattern up to eight numbers, an odd count repeated, none for a solid line', () => {
    expect(dashPattern(undefined)).toEqual([]);
    expect(dashPattern([])).toEqual([]);
    expect(dashPattern([0, 0])).toEqual([]);
    expect(dashPattern([8, 4])).toEqual([8, 4]);
    expect(dashPattern([8, 4, 2, 4])).toEqual([8, 4, 2, 4]); // dash, gap, dot, gap
    expect(dashPattern([6, 3, 1, 3, 1, 3])).toEqual([6, 3, 1, 3, 1, 3]);
    expect(dashPattern([5, 2, 1])).toEqual([5, 2, 1, 5, 2, 1]); // odd: repeated, as the Canvas does
    expect(dashPattern([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(dashPattern(Array.from({ length: 20 }, (_, i) => i + 1))).toHaveLength(16);
    expect(dashPattern([8, Number.NaN, 4, -1, 2])).toEqual([8, 4, 2, 8, 4, 2]);
  });

  it('draws a line with a dash pattern longer than a pair with all its numbers, and the style has a rule for each length', async () => {
    const service = createFakeSymbolService();
    service.renderGraphic = () => Promise.resolve({
      ok: true as const,
      lines: [
        { coordinates: new Float64Array(LINE_AT.flat()), color: '#000000', width: 2, dash: [10, 4, 2, 4] },
        { coordinates: new Float64Array(LINE_AT.flat()), color: '#000000', width: 2, dash: [6, 2, 1, 2, 1, 2] },
        { coordinates: new Float64Array(LINE_AT.flat()), color: '#000000', width: 2 },
      ],
      fills: [],
      labels: [],
    });
    const { e: engine, controller, clock } = realMapView();
    controller.setSymbols(service);
    const L = layer(1);
    const o = object(60, L.id, 'core.multipoint', { type: 'LineString', coordinates: LINE_AT }, { symbol: BOUNDARY });
    controller.listener.snapshot({ layers: [L], objects: [o], sequenceNo: 1 });
    clock.advance(5_000);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      clock.advance(1_000);
    }
    const features = (engine as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source.getFeatures() ?? [];
    const at = (n: number) => features.find((f) => f.getId() === `${o.id}#g${String(n)}`);
    // The features carry the number of their pattern; the style has a rule for each, with the whole pattern.
    expect([at(0)?.get(P.dash), at(1)?.get(P.dash), at(2)?.get(P.dash)]).toEqual([1, 2, 0]);
    expect((engine as unknown as { styleKey: string }).styleKey).toMatch(/:2$/); // the style was made again when the second pattern came
    const rules = (engine as unknown as { currentStyle(): ReturnType<typeof layerStyle> }).currentStyle();
    const dashed = rules.filter((r) => 'stroke-line-dash' in r.style && JSON.stringify(r.filter).includes(`,${String(KIND.gline)}]`));
    expect(dashed.map((r) => (r.style as Record<string, unknown>)['stroke-line-dash'])).toEqual([[10, 4, 2, 4], [6, 2, 1, 2, 1, 2]]);
    // Each is told apart by its number, so a line is drawn once; a solid line has its own rule.
    expect(dashed.map((r) => JSON.stringify(r.filter))).toEqual([1, 2].map((n) => JSON.stringify(['all', ['==', ['get', P.kind], KIND.gline], ['==', ['get', P.dash], n]])));
    expect(rules.some((r) => JSON.stringify(r.filter) === JSON.stringify(['all', ['==', ['get', P.kind], KIND.gline], ['==', ['get', P.dash], 0]]))).toBe(true);
  });

  it('numbers the dash patterns in the order they come, and draws a line solid when there are too many different ones', () => {
    const dashes = new DashPatterns();
    expect(dashes.idOf([])).toBe(0);
    expect(dashes.idOf([8, 4])).toBe(1);
    expect(dashes.idOf([8, 4, 2, 4])).toBe(2);
    expect(dashes.idOf([8, 4])).toBe(1);
    expect(dashes.version).toBe(2);
    expect(dashes.patterns).toEqual([[8, 4], [8, 4, 2, 4]]);
    for (let i = 0; dashes.version < MAX_DASH_PATTERNS; i++) dashes.idOf([i + 20, 3]);
    expect(dashes.idOf([999, 1])).toBe(0);
    expect(dashes.version).toBe(MAX_DASH_PATTERNS);
  });

  it('takes the short way between points that come back wrapped: 179.5 then -179.5, in either direction, in a run, in a fill', async () => {
    const service = createFakeSymbolService();
    const run = [178, 60, 179.5, 60.5, -179.5, 61, -178, 61.5]; // wrapped, going east
    const back = [-178, 61.5, -179.5, 61, 179.5, 60.5, 178, 60]; // going west
    const ring = [179, 60, -179, 60, -179, 61, 179, 61, 179, 60]; // closed
    service.renderGraphic = () => Promise.resolve({
      ok: true as const,
      lines: [{ coordinates: new Float64Array(run), color: '#000000', width: 2 }, { coordinates: new Float64Array(back), color: '#000000', width: 2 }],
      fills: [{ rings: [new Float64Array(ring)], color: '#ff0000', opacity: 0.3 }],
      labels: [],
    });
    const { e: engine, controller, clock, map } = realMapView();
    map.goTo([180, 60], 3000);
    controller.setSymbols(service);
    const L = layer(1);
    const o = object(61, L.id, 'core.multipoint', { type: 'LineString', coordinates: [[178, 60], [-178, 61.5]] }, { symbol: BOUNDARY });
    controller.listener.snapshot({ layers: [L], objects: [o], sequenceNo: 1 });
    clock.advance(5_000);
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
      clock.advance(1_000);
    }
    const features = (engine as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source.getFeatures() ?? [];
    const world = 40_075_016.68;
    const xs = (id: string) => {
      const geometry = features.find((f) => f.getId() === id)?.getGeometry();
      const coordinates = geometry instanceof OlLineString ? geometry.getCoordinates() : geometry instanceof OlPolygon ? (geometry.getCoordinates()[0] ?? []) : [];
      return coordinates.map((c) => c[0] as number);
    };
    for (const id of [`${o.id}#g1`, `${o.id}#g2`, `${o.id}#g0`]) {
      const x = xs(id);
      expect(x.length, id).toBeGreaterThanOrEqual(4);
      // No step is a jump across the world: every neighbouring pair is a few degrees apart.
      for (let i = 1; i < x.length; i++) expect(Math.abs((x[i] as number) - (x[i - 1] as number)), id).toBeLessThan(world / 20);
    }
  });

  it('draws a hatched fill with the hatch tile in the fill colour, as a shape\'s, on the Canvas too', () => {
    const rules = layerStyle({ atlas: null, arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
    const hatched = rules.find((r) => JSON.stringify(r.filter) === JSON.stringify(['all', ['==', ['get', P.kind], KIND.gfill], ['==', ['get', P.fillOn], 1], ['==', ['get', P.hatch], 1]]));
    expect((hatched?.style as Record<string, unknown>)['fill-pattern-src']).toBe('data:hatch');
    expect((hatched?.style as Record<string, unknown>)['fill-color']).toEqual(['get', P.fill]);
    const solid = rules.find((r) => JSON.stringify(r.filter) === JSON.stringify(['all', ['==', ['get', P.kind], KIND.gfill], ['==', ['get', P.fillOn], 1], ['==', ['get', P.hatch], 0]]));
    expect((solid?.style as Record<string, unknown>)['fill-pattern-src']).toBeUndefined();
  });
});

describe('OpenLayers engine: the display settings (brief function 35, criteria 77 to 81)', () => {
  const L = layer(1);
  const moving = (n: number, at: Position, modifiers: { speed?: number; direction?: number }, extra: Partial<MapObject> = {}) =>
    ({ ...symbolObject(n, L.id, at[0], at[1], { ...INFANTRY, modifiers }), ...extra });
  const sourceOf = (e: OpenLayersEngine) => (e as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source;
  const vectorOf = (e: OpenLayersEngine, id: string) => sourceOf(e)?.getFeatureById(`${id}#vector`) ?? null;

  it('criterion 79: draws a vector 6 000 m east of a symbol at speed 10 and 10 minutes, none at 0 minutes or without speed or direction', () => {
    const { e, controller, clock } = realMapView();
    e.setDisplayOptions(options({ speedVectorSeconds: 600 }));
    const fast = moving(10, [15.2, 58.41], { speed: 10, direction: 90 });
    const still = moving(11, [15.3, 58.5], { speed: 0, direction: 90 });
    const noHeading = moving(12, [15.4, 58.6], { speed: 10 });
    controller.listener.snapshot({ layers: [L], objects: [fast, still, noHeading], sequenceNo: 1 });
    clock.advance(5_000);
    const vector = vectorOf(e, fast.id);
    expect(vector?.get(P.kind)).toBe(KIND.aux);
    const line = vector?.getGeometry() as OlLineString;
    const [start, end] = [line.getFirstCoordinate(), line.getLastCoordinate()].map((c) => mercator.inverse([c[0] ?? 0, c[1] ?? 0]) as Position);
    expect(start?.[0]).toBeCloseTo(15.2, 6);
    expect(start?.[1]).toBeCloseTo(58.41, 6);
    expect(distance(start as Position, end as Position)).toBeCloseTo(6000, 0);
    expect(distance(end as Position, destination([15.2, 58.41], 90, 6000))).toBeLessThan(1);
    expect(vectorOf(e, still.id)).toBeNull();
    expect(vectorOf(e, noHeading.id)).toBeNull();
    e.setDisplayOptions(options({ speedVectorSeconds: 0 }));
    expect(vectorOf(e, fast.id)).toBeNull();
    e.setDisplayOptions(options({ speedVectorSeconds: 1800 }));
    const longer = vectorOf(e, fast.id)?.getGeometry() as OlLineString;
    expect(distance(start as Position, mercator.inverse(longer.getLastCoordinate() as [number, number]) as Position)).toBeCloseTo(18_000, 0);
  });

  it('criterion 94: draws a vector 50 m east of a symbol at speed 10 and 5 s, in the projection, and none at 0', () => {
    const { e, controller, clock } = realMapView();
    e.setDisplayOptions(options({ speedVectorSeconds: 5 }));
    const ship = moving(10, [15.2, 58.41], { speed: 10, direction: 90 });
    controller.listener.snapshot({ layers: [L], objects: [ship], sequenceNo: 1 });
    clock.advance(5_000);
    const line = vectorOf(e, ship.id)?.getGeometry() as OlLineString;
    const end = mercator.inverse(line.getLastCoordinate() as [number, number]) as Position;
    expect(distance([15.2, 58.41], end)).toBeCloseTo(50, 0);
    expect(distance(end, destination([15.2, 58.41], 90, 50))).toBeLessThan(1);
    e.setDisplayOptions(options({ speedVectorSeconds: 30 })); // a change of the step draws the longer vector at once
    const longer = vectorOf(e, ship.id)?.getGeometry() as OlLineString;
    expect(distance([15.2, 58.41], mercator.inverse(longer.getLastCoordinate() as [number, number]) as Position)).toBeCloseTo(300, 0);
    e.setDisplayOptions(options({ speedVectorSeconds: 0 }));
    expect(vectorOf(e, ship.id)).toBeNull();
  });

  it('criterion 79 (LB): the vector is black for a friend, a hostile and a vessel alike', () => {
    const { e, controller, clock } = realMapView();
    e.setDisplayOptions(options({ speedVectorSeconds: 600 }));
    const symbols = [INFANTRY, { standard: 'APP-6D' as const, sidc: '10061000001211000000' }, { standard: 'vessel' as const, sidc: '0670' }];
    const objects = symbols.map((s, i) => ({ ...symbolObject(10 + i, L.id, 15.2 + i / 10, 58.41, { ...s, modifiers: { speed: 10, direction: 90 } }) }));
    controller.listener.snapshot({ layers: [L], objects, sequenceNo: 1 });
    clock.advance(5_000);
    for (const o of objects) {
      const vector = vectorOf(e, o.id);
      expect(vector, o.id).not.toBeNull();
      expect(vector?.get(P.stroke)).toEqual([0, 0, 0, 1]);
      expect(vector?.get(P.strokeWidth)).toBe(2);
    }
  });

  it('criteria 78 and 79 (LB, LC; CR-0043 part A): where a vector is drawn the symbol has no direction arrow; with 0 minutes or speed 0 it keeps it; the Direction arrow switch turns it off', () => {
    const { e, controller, clock } = realMapView();
    const fast = moving(10, [15.2, 58.41], { speed: 10, direction: 90 });
    const still = moving(11, [15.3, 58.5], { speed: 0, direction: 90 });
    controller.listener.snapshot({ layers: [L], objects: [fast, still], sequenceNo: 1 });
    clock.advance(5_000);
    const arrow = (id: string) => sourceOf(e)?.getFeatureById(id)?.get(P.hasArrow) as number;
    expect([arrow(fast.id), arrow(still.id)]).toEqual([1, 1]); // 0 minutes: today's arrow
    e.setDisplayOptions(options({ speedVectorSeconds: 600 }));
    expect([arrow(fast.id), arrow(still.id)]).toEqual([0, 1]); // a vector replaces the arrow; speed 0 has no vector, so its arrow stays
    e.setDisplayOptions(options({ labelPlaces: NAME_BELOW, speedVectorSeconds: 0 })); // a label placed or not does not touch the arrow (LC)
    expect([arrow(fast.id), arrow(still.id)]).toEqual([1, 1]);
    e.setDisplayOptions(options({ directionArrow: false, speedVectorSeconds: 0 })); // the switch: no arrow
    expect([arrow(fast.id), arrow(still.id)]).toEqual([0, 0]);
    e.setDisplayOptions(options({ directionArrow: false, speedVectorSeconds: 600 }));
    expect([arrow(fast.id), arrow(still.id)]).toEqual([0, 0]);
    e.setDisplayOptions(options({ directionArrow: true, speedVectorSeconds: 600 }));
    expect([arrow(fast.id), arrow(still.id)]).toEqual([0, 1]);
    // A change of the symbol keeps the rule.
    controller.listener.changes([event(2, { ...fast, version: 2, geometry: { type: 'Point', coordinates: [16, 58.41] } })]);
    clock.advance(5_000);
    expect(arrow(fast.id)).toBe(0);
    e.setDisplayOptions(options({ directionArrow: false, speedVectorSeconds: 0 }));
    controller.listener.changes([event(3, { ...fast, version: 3, geometry: { type: 'Point', coordinates: [16.1, 58.41] } })]);
    clock.advance(5_000);
    expect(arrow(fast.id)).toBe(0); // a symbol drawn after the switch went off has none either
  });

  it('criterion 80: the vector follows its symbol, goes with it, is faded with it and is never picked', () => {
    const { e, controller, clock, map } = realMapView();
    e.setDisplayOptions(options({ speedVectorSeconds: 600 }));
    const ship = moving(10, [15.2, 58.41], { speed: 10, direction: 90 });
    controller.listener.snapshot({ layers: [L], objects: [ship], sequenceNo: 1 });
    clock.advance(5_000);
    const colour = () => vectorOf(e, ship.id)?.get(P.stroke) as number[];
    expect(colour()[3]).toBe(1);
    const fade = map.createFadeList();
    fade.set([ship.id]);
    expect(colour()[3]).toBeLessThan(1);
    fade.clear();
    expect(colour()[3]).toBe(1);
    // Picked: a click on the middle of the vector hits nothing, a box over it nothing.
    map.goTo([15.2, 58.41], 40);
    const middle = destination([15.2, 58.41], 90, 3000);
    const view = e.view;
    const xy = mercator.forward(middle);
    if (view === null || xy === null) throw new Error('no view');
    const at = mapToPixel(view, xy);
    expect(map.pick(at, 4)).toEqual([]);
    expect(e.pickCandidates(at, 4).map((c) => c.id)).not.toContain(`${ship.id}#vector`);
    expect(e.boxCandidates({ from: [at[0] - 20, at[1] - 20], to: [at[0] + 20, at[1] + 20] }).map((c) => c.id)).not.toContain(`${ship.id}#vector`);
    // It moves with its symbol, and goes when the symbol does.
    controller.listener.changes([event(2, { ...ship, version: 2, geometry: { type: 'Point', coordinates: [16, 58.41] } })]);
    clock.advance(5_000);
    const moved = (vectorOf(e, ship.id)?.getGeometry() as OlLineString).getFirstCoordinate();
    expect(mercator.inverse([moved[0] ?? 0, moved[1] ?? 0])?.[0]).toBeCloseTo(16, 6);
    controller.listener.changes([event(3, null, { id: ship.id, type: 'object' })]);
    clock.advance(5_000);
    expect(vectorOf(e, ship.id)).toBeNull();
  });

  it('criterion 81: a vector from 179.9° E heading east is one short line, not across the world', () => {
    const { e, controller, clock } = realMapView();
    e.setDisplayOptions(options({ speedVectorSeconds: 600 }));
    const ship = moving(10, [179.9, 10], { speed: 100, direction: 90 }); // 60 km east: 180.44°
    controller.listener.snapshot({ layers: [L], objects: [ship], sequenceNo: 1 });
    clock.advance(5_000);
    const [minX = 0, , maxX = 0] = vectorOf(e, ship.id)?.getGeometry()?.getExtent() ?? [];
    expect(maxX - minX).toBeGreaterThan(50_000);
    expect(maxX - minX).toBeLessThan(70_000); // 60 km, never 40 000 km
  });

  it('criterion 77 (CR-0043 part A): every render request carries the size and no labels, a new size makes the images again, and new labels do not', () => {
    const { e, controller, clock } = realMapView();
    const service = createFakeSymbolService();
    e.setSymbols(service);
    e.setSymbolOptions(48, 2000);
    e.setDisplayOptions(options({ labelPlaces: { ...NO_PLACED_LABELS.labelPlaces, below: 'name', topRight: 'type' } }));
    controller.listener.snapshot({ layers: [L], objects: [symbolObject(10, L.id, 15, 58, { ...INFANTRY, modifiers: { type: 'T', country: 'SE' } })], sequenceNo: 1 });
    clock.advance(5_000);
    (e as unknown as { refreshLabels(): void }).refreshLabels();
    expect(service.renderRequests.length).toBeGreaterThan(0);
    for (const request of service.renderRequests) {
      expect(request.size).toBe(48);
      expect(request.labels).toEqual([]); // the map view draws the placed labels itself
    }
    const resized = service.renderRequests.length;
    e.setSymbolOptions(20, 2000);
    const afterResize = service.renderRequests.slice(resized);
    expect(afterResize.length).toBeGreaterThan(0);
    for (const request of afterResize) expect(request.size).toBe(20);
    (e as unknown as { refreshLabels(): void }).refreshLabels(); // the text images at the new size
    const relabelled = service.renderRequests.length;
    e.setDisplayOptions(options({ labelPlaces: { ...NO_PLACED_LABELS.labelPlaces, topLeft: 'speed' } }));
    (e as unknown as { refreshLabels(): void }).refreshLabels();
    expect(service.renderRequests.slice(relabelled)).toEqual([]); // the images do not depend on the labels: no atlas started again
  });

  it("asks with no labels and the shell's size from the start (CR-0043 part A)", () => {
    const { e, controller, clock } = realMapView();
    const service = createFakeSymbolService();
    e.setSymbols(service);
    controller.listener.snapshot({ layers: [L], objects: [symbolObject(10, L.id, 15, 58)], sequenceNo: 1 });
    clock.advance(5_000);
    expect(service.renderRequests.length).toBeGreaterThan(0);
    for (const request of service.renderRequests) {
      expect(request.labels).toEqual([]);
      expect(request.size).toBe(DEFAULT_DISPLAY.symbolSize);
    }
  });

  describe('vessels (brief function 33, criterion 71)', () => {
    const SHIP = { standard: 'vessel' as const, sidc: '0470' };
    const ship = (n: number, at: Position, modifiers?: { direction?: number; speed?: number; quantity?: string }) =>
      symbolObject(n, L.id, at[0], at[1], { ...SHIP, ...(modifiers === undefined ? {} : { modifiers }) });
    const featureOf = (e: OpenLayersEngine, id: string) =>
      (e as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source.getFeatureById(id);
    const vesselRequests = (service: ReturnType<typeof createFakeSymbolService>) => service.renderRequests.filter((r) => r.standard === 'vessel' && r.withText !== true);

    it('criterion 71: is drawn with the image render gives, with its direction, at its position, without an arrow of its own, and a click selects it', () => {
      const { e, controller, map, clock } = realMapView();
      const service = createFakeSymbolService();
      e.setSymbols(service);
      const at: Position = [11.8512, 57.6934]; // latitude ≠ longitude
      const object = ship(10, at, { direction: 90 });
      controller.listener.snapshot({ layers: [L], objects: [object], sequenceNo: 1 });
      clock.advance(5_000);
      expect(vesselRequests(service)).toEqual([expect.objectContaining({ standard: 'vessel', sidc: '0470', modifiers: { direction: 90 } })]);
      const feature = featureOf(e, object.id);
      expect(feature?.get(P.inAtlas)).toBe(1);
      expect(feature?.get(P.hasArrow)).toBe(0); // the hull turns by itself
      const xy = mercator.forward(at);
      if (feature === undefined || feature === null || xy === null) throw new Error('not drawn');
      expect(feature.getGeometry()?.getExtent().slice(0, 2)).toEqual([xy[0], xy[1]]);
      map.goTo(at, 40);
      const view = e.view;
      if (view === null) throw new Error('no view');
      expect(map.pick(mapToPixel(view, xy), 4)).toEqual([object.id]);
    });

    it('asks for one image per hull step of 10 degrees, a mark when it does not move, and the same image again for the same hull', () => {
      const { e, controller, clock } = realMapView();
      const service = createFakeSymbolService();
      e.setSymbols(service);
      const objects = [
        ship(10, [11, 57], { direction: 90 }),
        ship(11, [11.1, 57], { direction: 90.4 }), // the same whole degree
        ship(12, [11.2, 57], { direction: 270 }),
        ship(13, [11.3, 57], { direction: 45, speed: 0 }), // not moving: the mark
        ship(14, [11.4, 57]), // no direction: the mark
        ship(15, [11.5, 57], { direction: 90, speed: 6 }),
      ];
      controller.listener.snapshot({ layers: [L], objects, sequenceNo: 1 });
      clock.advance(5_000);
      // Hulls at 90° (three vessels, one of them with a speed) and 270°, and one mark (two vessels): three images, not six.
      expect(vesselRequests(service).map((r) => r.modifiers)).toEqual([{ direction: 90 }, { direction: 270 }, { direction: 45, speed: 0 }]);
    });

    it('criterion 108 (T-200): is drawn with the hull of 30 degrees at a direction of 34, 40 at 35 and 36, 0 at 356, with and without text, and keeps its direction', async () => {
      vi.useFakeTimers();
      const anything: Record<string | symbol, unknown> = {};
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy(anything, { get: (t, k) => (k in t ? t[k] : () => undefined) }) as unknown as CanvasRenderingContext2D);
      const { e, controller, clock, map } = realMapView();
      map.goTo([11.15, 57], 100);
      const service = createFakeSymbolService();
      e.setSymbols(service);
      const objects = [ship(10, [11, 57], { direction: 34, quantity: 'A' }), ship(11, [11.1, 57], { direction: 35, quantity: 'B' }), ship(12, [11.2, 57], { direction: 36, quantity: 'C' }), ship(13, [11.3, 57], { direction: 356, quantity: 'D' })];
      controller.listener.snapshot({ layers: [L], objects, sequenceNo: 1 });
      clock.advance(5_000);
      await vi.advanceTimersByTimeAsync(100);
      (e as unknown as { refreshLabels(): void }).refreshLabels();
      expect([...new Set(vesselRequests(service).map((r) => r.modifiers?.direction))].sort()).toEqual([0, 30, 40]); // 35 and 36: one hull
      const texts = service.renderRequests.filter((r) => r.standard === 'vessel' && r.withText === true);
      expect(texts.length).toBeGreaterThan(0);
      expect([...new Set(texts.map((r) => r.modifiers?.direction))].sort()).toEqual([0, 30, 40]); // the text image has the stepped hull too
      expect(objects[0]?.symbol).toMatchObject({ modifiers: { direction: 34 } }); // the object is not changed
      vi.useRealTimers();
    });

    it("criterion 108 (T-200): the text image of a turning vessel is drawn again with its hull's step, not with every degree", async () => {
      vi.useFakeTimers();
      const anything: Record<string | symbol, unknown> = {};
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy(anything, { get: (t, k) => (k in t ? t[k] : () => undefined) }) as unknown as CanvasRenderingContext2D);
      const { e, controller, clock, map } = realMapView();
      map.goTo([11, 57], 100);
      const service = createFakeSymbolService();
      e.setSymbols(service);
      const object = ship(10, [11, 57], { direction: 31, quantity: 'A' });
      controller.listener.snapshot({ layers: [L], objects: [object], sequenceNo: 1 });
      clock.advance(5_000);
      await vi.advanceTimersByTimeAsync(100);
      const refresh = () => {
        (e as unknown as { refreshLabels(): void }).refreshLabels();
      };
      refresh();
      const texts = () => service.renderRequests.filter((r) => r.withText === true).length;
      const before = texts();
      expect(before).toBeGreaterThan(0);
      for (const [version, direction] of [[2, 32], [3, 33], [4, 34]] as const) {
        controller.listener.changes([event(version, { ...object, version, symbol: { ...SHIP, modifiers: { direction, quantity: 'A' } } })]);
        clock.advance(2_000);
        await vi.advanceTimersByTimeAsync(100);
        refresh();
      }
      expect(texts()).toBe(before); // 31 to 34 are the hull of 30
      controller.listener.changes([event(5, { ...object, version: 5, symbol: { ...SHIP, modifiers: { direction: 35, quantity: 'A' } } })]);
      clock.advance(2_000);
      await vi.advanceTimersByTimeAsync(100);
      refresh();
      expect(texts()).toBeGreaterThan(before); // 35 is the hull of 40
      vi.useRealTimers();
    });

    describe('the style is swapped when the new atlas image is loaded (T-200, criterion 108)', () => {
      afterEach(() => {
        vi.useRealTimers();
      });
      const hullOf = (n: number) => ship(n, [11 + (n % 20) * 0.05, 57 + Math.floor(n / 20) * 0.05], { direction: (n * 7) % 360, speed: 6 });
      const imageOf = (e: OpenLayersEngine, id: string): unknown[] => {
        const feature = featureOf(e, id);
        return [feature?.get(P.inAtlas), feature?.get(P.ox), feature?.get(P.oy)];
      };

      /** An engine whose images load when the test says so (`settle`): the swap waits for them. */
      function held() {
        vi.useFakeTimers();
        const releases: (() => void)[] = [];
        const loads: (readonly string[])[] = [];
        const view = realMapView({ engine: { styleSwapIntervalMs: 250, loadImages: (urls) => {
          loads.push(urls);
          return new Promise<void>((resolve) => releases.push(resolve));
        } } });
        const service = createFakeSymbolService();
        view.e.setSymbols(service);
        const layers = (view.e as unknown as { layers: Map<string, { layer: { setStyle(style: unknown): void } }> }).layers;
        const swaps: number[] = [];
        const watch = () => {
          for (const entry of layers.values()) {
            const set = entry.layer.setStyle.bind(entry.layer);
            entry.layer.setStyle = (style: unknown) => {
              swaps.push(Date.now());
              set(style);
            };
          }
        };
        /** Runs the timers for `ms`, then lets every image that is loading finish. */
        const settle = async (ms = 300) => {
          await vi.advanceTimersByTimeAsync(ms);
          while (releases.length > 0) releases.shift()?.();
          await vi.advanceTimersByTimeAsync(0);
        };
        return { ...view, service, releases, loads, swaps, watch, settle };
      }

      it('loads the atlas image before the style names it; a symbol that waits for it is drawn from its own image on a Canvas layer and picked meanwhile; the layers keep their style until then', async () => {
        const { e, controller, clock, map, releases, loads, swaps, watch, settle } = held();
        controller.listener.snapshot({ layers: [L], objects: [hullOf(1), hullOf(2)], sequenceNo: 1 });
        clock.advance(5_000);
        watch();
        expect(loads).toHaveLength(1); // the swap starts at once, and waits for the image
        expect(loads[0]?.some((url) => url.startsWith('data:'))).toBe(true);
        expect(releases).toHaveLength(1);
        expect(imageOf(e, hullOf(1).id)[0]).toBe(2); // not in the shown atlas yet: the WebGL layer draws nothing of it
        const canvasSymbols = () => (e as unknown as { pendingSource: VectorSource }).pendingSource.getFeatures().length;
        expect(canvasSymbols()).toBe(2); // so it is drawn from its own image on a Canvas layer: a new symbol is always drawn, however long the swap takes
        const xy = mercator.forward([11.05, 57]);
        map.goTo([11.05, 57], 40);
        if (e.view === null || xy === null) throw new Error('no view');
        const pixel = mapToPixel(e.view, xy);
        expect(map.pick(pixel, 4)).toEqual([hullOf(1).id]); // and picked, its size being known
        expect(swaps).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(swaps).toHaveLength(0); // as long as the image is not loaded
        await settle(0); // the style with the atlas that holds the hulls (the labels no longer change the images, so no atlas before it)
        expect(swaps).toHaveLength(1);
        expect(imageOf(e, hullOf(1).id)[0]).toBe(1);
        expect(imageOf(e, hullOf(2).id)[0]).toBe(1);
        expect(canvasSymbols()).toBe(0); // the WebGL layer draws them now
        expect(map.pick(pixel, 4)).toContain(hullOf(1).id);
      });

      it('the Canvas symbols follow their layer: not drawn while it is hidden, drawn again when it is shown', () => {
        const { e, controller, clock, map } = held();
        controller.listener.snapshot({ layers: [L], objects: [hullOf(1)], sequenceNo: 1 });
        clock.advance(5_000);
        const drawn = () => (e as unknown as { pendingSource: VectorSource }).pendingSource.getFeatures().map((f) => (f.getStyle() as OlStyle).getImage());
        expect(drawn()).toHaveLength(1);
        expect(drawn()[0]).not.toBeNull();
        map.setLayerVisible(L.id, false);
        expect(drawn()[0]).toBeNull(); // an empty style: nothing is drawn
        map.setLayerVisible(L.id, true);
        expect(drawn()[0]).not.toBeNull();
      });

      it('takes a waiting symbol off the Canvas layer when its object is deleted or its layer goes, and gives a symbol that changed no Canvas symbol (it keeps its old image)', async () => {
        const { e, controller, clock, settle } = held();
        const [a, b] = [hullOf(1), hullOf(2)];
        controller.listener.snapshot({ layers: [L], objects: [a, b], sequenceNo: 1 });
        clock.advance(5_000);
        const canvasSymbols = () => (e as unknown as { pendingSource: VectorSource }).pendingSource.getFeatures().length;
        expect(canvasSymbols()).toBe(2);
        controller.listener.changes([event(2, null, { id: a.id, type: 'object' })]);
        clock.advance(5_000);
        expect(canvasSymbols()).toBe(1);
        await settle();
        await settle();
        expect(canvasSymbols()).toBe(0);
        controller.listener.changes([event(3, { ...b, version: 2, symbol: { ...SHIP, modifiers: { direction: 150, speed: 6 } } })]);
        clock.advance(5_000);
        expect(imageOf(e, b.id)[0]).toBe(1); // keeps the old image
        expect(canvasSymbols()).toBe(0); // so no Canvas symbol
        const c = hullOf(5);
        controller.listener.changes([event(4, c)]);
        clock.advance(5_000);
        expect(canvasSymbols()).toBe(1); // a new symbol with a new hull: on the Canvas layer
        controller.listener.snapshot({ layers: [L], objects: [], sequenceNo: 5 }); // the layer's objects are replaced
        expect(canvasSymbols()).toBe(0);
      });

      it('does not wait for ever for images that do not finish loading: after a few seconds the style is swapped all the same', async () => {
        const { e, controller, clock, swaps, watch } = held();
        controller.listener.snapshot({ layers: [L], objects: [hullOf(1)], sequenceNo: 1 });
        clock.advance(5_000);
        watch();
        await vi.advanceTimersByTimeAsync(IMAGE_LOAD_TIMEOUT_MS - 100); // no image is ever released
        expect(swaps).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(200);
        expect(swaps.length).toBeGreaterThan(0);
        await vi.advanceTimersByTimeAsync(IMAGE_LOAD_TIMEOUT_MS + 300);
        expect(imageOf(e, hullOf(1).id)[0]).toBe(1);
      });

      it('a vessel that turns keeps drawing its old image until the swap, then the new one', async () => {
        const { e, controller, clock, loads, settle } = held();
        const object = hullOf(1);
        controller.listener.snapshot({ layers: [L], objects: [object], sequenceNo: 1 });
        clock.advance(5_000);
        for (let i = 0; i < 4; i++) await settle(); // until no swap is waiting any more
        const first = imageOf(e, object.id);
        expect(first[0]).toBe(1);
        const turned = { ...object, version: 2, symbol: { ...SHIP, modifiers: { direction: 150, speed: 6 } } }; // a new hull
        const loadsBefore = loads.length;
        controller.listener.changes([event(2, turned)]);
        clock.advance(2_000);
        expect(imageOf(e, object.id)).toEqual(first); // the new image is in the atlas, not in the shown image: the old one is drawn
        await vi.advanceTimersByTimeAsync(300);
        expect(loads.length).toBeGreaterThan(loadsBefore); // the swap is loading
        expect(imageOf(e, object.id)).toEqual(first); // and the image is not loaded yet
        await settle(0);
        const later = imageOf(e, object.id);
        expect(later[0]).toBe(1);
        expect(later).not.toEqual(first); // the new image
      });

      it('on a map that is shown the style goes on new layers that take over when they have drawn: setStyle is never called on a layer in use, and no frame is without its symbols', async () => {
        vi.useFakeTimers();
        const view = realMapView({ engine: { styleSwapIntervalMs: 0, loadImages: () => Promise.resolve() } });
        const { e, controller, clock } = view;
        const olMap = (e as unknown as { map: OlMap }).map;
        vi.spyOn(olMap, 'getTarget').mockReturnValue(document.createElement('div')); // shown: the layers are swapped, not restyled
        e.setSymbols(createFakeSymbolService());
        type Webgl = { setStyle(style: unknown): void; getRenderer(): { ready: boolean } };
        const entryOf = () => (e as unknown as { layers: Map<string, { layer: Webgl; source: VectorSource }> }).layers.get(L.id);
        const webgl = () => olMap.getLayers().getArray().filter((layer) => layer.getClassName() === 'map-view-2d-layer') as unknown as Webgl[];
        controller.listener.snapshot({ layers: [L], objects: [hullOf(1)], sequenceNo: 1 });
        clock.advance(5_000);
        const first = entryOf()?.layer;
        if (first === undefined) throw new Error('no layer');
        const restyled = vi.spyOn(first, 'setStyle');
        /** One swap: the images load, the new layer is added, is ready after its first frame, and has drawn in the next. Returns the layer that took over, or null if no swap was going. */
        const renderSpy = vi.spyOn(olMap, 'render');
        const swapOnce = async () => {
          await vi.advanceTimersByTimeAsync(10);
          const before = entryOf()?.layer;
          const next = webgl().find((layer) => layer !== before);
          if (next === undefined) return null;
          next.getRenderer().ready = false; // what the layer's first frame does: its buffers are made in a worker
          renderSpy.mockClear();
          olMap.dispatchEvent('postrender');
          expect(renderSpy).toHaveBeenCalled(); // an idle map draws no frame by itself: the swap asks for the next while it waits
          olMap.dispatchEvent('postrender');
          expect(entryOf()?.layer).toBe(before); // not ready: the old layer is in use
          next.getRenderer().ready = true; // a view that moves gives it no buffers: ready, but nothing to draw
          olMap.dispatchEvent('postrender');
          olMap.dispatchEvent('postrender');
          olMap.dispatchEvent('postrender');
          expect(entryOf()?.layer).toBe(before);
          (next.getRenderer() as unknown as { buffers_: unknown }).buffers_ = {}; // its buffers are there
          olMap.dispatchEvent('postrender');
          expect(entryOf()?.layer).toBe(before); // ready, but it has not drawn yet
          renderSpy.mockClear();
          olMap.dispatchEvent('postrender'); // it drew in the frame before
          expect(renderSpy).not.toHaveBeenCalled(); // done: no more frames asked for
          expect(entryOf()?.layer).toBe(next);
          expect(webgl()).toHaveLength(1); // the old one is gone
          return next;
        };
        expect(imageOf(e, hullOf(1).id)[0]).toBe(2); // not in the shown atlas yet: nothing is drawn of it
        while ((await swapOnce()) !== null) { /* the style for the symbol options, then the one that holds the hull */ }
        expect(imageOf(e, hullOf(1).id)[0]).toBe(1);
        // A vessel that turns: a new hull, a new swap; it keeps its image until the new layer has taken over.
        const object = hullOf(1);
        const imageBefore = imageOf(e, object.id);
        controller.listener.changes([event(2, { ...object, version: 2, symbol: { ...SHIP, modifiers: { direction: 150, speed: 6 } } })]);
        clock.advance(2_000);
        expect(imageOf(e, object.id)).toEqual(imageBefore);
        await swapOnce();
        const imageAfter = imageOf(e, object.id);
        expect(imageAfter[0]).toBe(1);
        expect(imageAfter).not.toEqual(imageBefore);
        expect(restyled).not.toHaveBeenCalled();
        expect(webgl().every((layer) => layer !== first)).toBe(true); // the layer made first is gone
      });

      it('a new atlas (a new symbol size) draws none of its symbols with the shown image, which is the old atlas, until the style is swapped', async () => {
        const { e, controller, clock, settle } = held();
        const object = hullOf(1);
        controller.listener.snapshot({ layers: [L], objects: [object], sequenceNo: 1 });
        clock.advance(5_000);
        await settle();
        await settle();
        expect(imageOf(e, object.id)[0]).toBe(1);
        e.setSymbolOptions(40, 2_000);
        expect(imageOf(e, object.id)[0]).toBe(2); // the new atlas has it at another place: not drawn until the style names that atlas
        await settle();
        await settle();
        expect(imageOf(e, object.id)[0]).toBe(1);
      });

      it('the layers a swap adds have no hit detection either (T-195)', async () => {
        vi.useFakeTimers();
        const view = realMapView({ engine: { styleSwapIntervalMs: 250, loadImages: () => Promise.resolve() } });
        const { e, controller, clock } = view;
        const olMap = (e as unknown as { map: OlMap }).map;
        vi.spyOn(olMap, 'getTarget').mockReturnValue(document.createElement('div'));
        e.setSymbols(createFakeSymbolService());
        controller.listener.snapshot({ layers: [L], objects: [hullOf(1)], sequenceNo: 1 });
        clock.advance(5_000);
        await vi.advanceTimersByTimeAsync(10);
        const webgl = olMap.getLayers().getArray().filter((layer) => layer.getClassName() === 'map-view-2d-layer') as unknown as { hitDetectionDisabled_: boolean }[];
        expect(webgl).toHaveLength(2); // the shown layer and the one the swap added
        for (const layer of webgl) expect(layer.hitDetectionDisabled_).toBe(true);
        vi.useRealTimers();
      });

      it('a swap whose layers never get ready is given up, and the next waits twice as long (no frames asked for ever)', async () => {
        vi.useFakeTimers();
        const view = realMapView({ engine: { styleSwapIntervalMs: 250, loadImages: () => Promise.resolve() } });
        const { e, controller, clock } = view;
        const olMap = (e as unknown as { map: OlMap }).map;
        vi.spyOn(olMap, 'getTarget').mockReturnValue(document.createElement('div'));
        e.setSymbols(createFakeSymbolService());
        const webgl = () => olMap.getLayers().getArray().filter((layer) => layer.getClassName() === 'map-view-2d-layer').length;
        controller.listener.snapshot({ layers: [L], objects: [hullOf(1)], sequenceNo: 1 });
        clock.advance(5_000);
        await vi.advanceTimersByTimeAsync(10); // the images are loaded: the new layer is added
        expect(webgl()).toBe(2);
        const giveUp = () => {
          for (let i = 0; i < 700; i++) {
            for (const layer of olMap.getLayers().getArray()) if (layer.getClassName() === 'map-view-2d-layer') (layer as unknown as { getRenderer(): { ready: boolean } }).getRenderer().ready = false; // never ready
            olMap.dispatchEvent('postrender');
          }
        };
        giveUp();
        expect(webgl()).toBe(1); // given up: the new layer is gone
        await vi.advanceTimersByTimeAsync(300);
        expect(webgl()).toBe(1); // the next try waits 500 ms, not 250
        await vi.advanceTimersByTimeAsync(300);
        expect(webgl()).toBe(2);
        giveUp();
        await vi.advanceTimersByTimeAsync(700);
        expect(webgl()).toBe(1); // and now 1 000 ms
        await vi.advanceTimersByTimeAsync(400);
        expect(webgl()).toBe(2);
        vi.useRealTimers();
      });

      it('swaps at most four times a second, with the images that came in between together', async () => {
        const { e, controller, clock, loads, swaps, watch, settle } = held();
        const objects = Array.from({ length: 40 }, (_, i) => hullOf(i));
        controller.listener.snapshot({ layers: [L], objects, sequenceNo: 1 });
        clock.advance(5_000);
        await settle();
        await settle();
        watch();
        for (let second = 1; second <= 20; second++) {
          const turned = objects.map((o, i) => ({ ...o, version: second + 1, symbol: { ...SHIP, modifiers: { direction: ((i * 7) % 360) + second * 9, speed: 6 } } }));
          controller.listener.changes(turned.map((o, i) => event(1000 + second * 100 + i, o)));
          clock.advance(1_000);
          await settle(1_000);
        }
        expect(swaps.length).toBeGreaterThan(5);
        for (let i = 1; i < swaps.length; i++) expect((swaps[i] ?? 0) - (swaps[i - 1] ?? 0)).toBeGreaterThanOrEqual(250);
        expect(loads.length).toBeLessThanOrEqual(20 * 4 + 2);
        expect(e.view).not.toBeNull();
      });

      it('200 vessels turning 1 degree a second for a minute: at most 36 images, and no frame without a vessel', async () => {
        const { e, controller, clock, swaps, watch, settle } = held();
        const objects = Array.from({ length: 200 }, (_, i) => ship(i + 1, [11 + (i % 20) * 0.05, 57 + Math.floor(i / 20) * 0.05], { direction: i % 20, speed: 6 }));
        controller.listener.snapshot({ layers: [L], objects, sequenceNo: 1 });
        clock.advance(5_000);
        await settle();
        await settle();
        watch();
        const drawn = () => objects.filter((o) => featureOf(e, o.id)?.get(P.inAtlas) === 1).length;
        expect(drawn()).toBe(200);
        let fewest = 200;
        for (let second = 1; second <= 60; second++) {
          const turned = objects.map((o, i) => ({ ...o, version: second + 1, symbol: { ...SHIP, modifiers: { direction: ((i % 20) + second) % 360, speed: 6 } } }));
          controller.listener.changes(turned.map((o, i) => event(10_000 + second * 1000 + i, o)));
          clock.advance(1_000);
          for (let step = 0; step < 4; step++) {
            await vi.advanceTimersByTimeAsync(250);
            fewest = Math.min(fewest, drawn()); // a frame while an image loads, and before each swap
            await settle(0);
            fewest = Math.min(fewest, drawn()); // and after it
          }
        }
        expect(fewest).toBe(200);
        const atlas = (e as unknown as { atlas: { version: number } }).atlas;
        expect(atlas.version).toBeLessThanOrEqual(36);
        expect(swaps.length).toBeGreaterThan(0);
      });
    });

    it('draws a vessel that turns again with its new heading', () => {
      const { e, controller, clock } = realMapView();
      const service = createFakeSymbolService();
      e.setSymbols(service);
      const object = ship(10, [11, 57], { direction: 90 });
      controller.listener.snapshot({ layers: [L], objects: [object], sequenceNo: 1 });
      clock.advance(5_000);
      const before = featureOf(e, object.id);
      const turned = { ...object, version: 2, symbol: { ...SHIP, modifiers: { direction: 138 } } }; // the hull at 140 (T-200)
      controller.listener.changes([event(2, turned)]);
      clock.advance(5_000);
      expect(featureOf(e, object.id)).not.toBe(before);
      expect(vesselRequests(service).map((r) => r.modifiers)).toEqual([{ direction: 90 }, { direction: 140 }]);
    });

    it('keeps the arrow of APP-6 symbols and never gives a vessel one, with or without a speed vector', () => {
      const { e, controller, clock } = realMapView();
      e.setSymbols(createFakeSymbolService());
      const land = symbolObject(11, L.id, 15, 58, { ...INFANTRY, modifiers: { direction: 90, speed: 5 } });
      const object = ship(10, [11, 57], { direction: 90, speed: 5 });
      controller.listener.snapshot({ layers: [L], objects: [object, land], sequenceNo: 1 });
      clock.advance(5_000);
      expect([featureOf(e, object.id)?.get(P.hasArrow), featureOf(e, land.id)?.get(P.hasArrow)]).toEqual([0, 1]);
      e.setDisplayOptions(options({ speedVectorSeconds: 600 }));
      expect([featureOf(e, object.id)?.get(P.hasArrow), featureOf(e, land.id)?.get(P.hasArrow)]).toEqual([0, 0]);
      expect(featureOf(e, `${object.id}#vector`)).toBeTruthy(); // the speed vector works for a vessel as for any symbol
    });

    it('asks for the vessels again when the look changes (the ground colour is in the image), and for nothing when there is none', () => {
      const { e, controller, clock } = realMapView();
      const service = createFakeSymbolService();
      e.setSymbols(service);
      const dark = textLookFrom(FAKE_TOKEN_VALUES);
      const light = textLookFrom({ ...FAKE_TOKEN_VALUES, colorText: '#151a21', colorGround: '#e6e9ee' });
      e.setTextLook(dark);
      controller.listener.snapshot({ layers: [L], objects: [symbolObject(11, L.id, 15, 58)], sequenceNo: 1 });
      clock.advance(5_000);
      const appSixOnly = service.renderRequests.length;
      e.setTextLook(light);
      expect(service.renderRequests.length).toBe(appSixOnly); // no vessel in the atlas: nothing is drawn again
      controller.listener.changes([event(2, ship(10, [11, 57], { direction: 90 }))]);
      clock.advance(5_000);
      expect(vesselRequests(service)).toHaveLength(1);
      e.setTextLook(dark);
      clock.advance(5_000);
      expect(vesselRequests(service)).toHaveLength(2);
      e.setTextLook(dark); // the same look: nothing
      clock.advance(5_000);
      expect(vesselRequests(service)).toHaveLength(2);
    });

    it('is the fallback marker when the service refuses vessels (a symbology older than SDK 1.4.0 part 3)', () => {
      const { e, controller, clock } = realMapView();
      const base = createFakeSymbolService();
      e.setSymbols({
        ...base,
        render: (request: Parameters<typeof base.render>[0]) => {
          if (request.standard === 'vessel') throw new Error('not a symbol standard');
          return base.render(request);
        },
      });
      const object = ship(10, [11, 57], { direction: 90 });
      controller.listener.snapshot({ layers: [L], objects: [object], sequenceNo: 1 });
      clock.advance(5_000);
      expect(featureOf(e, object.id)?.get(P.inAtlas)).toBe(0);
    });
  });

  describe('criterion 78 (CR-0043 part A): the labels at their places', () => {
    const NONE = NO_PLACED_LABELS.labelPlaces;
    /** The label texts drawn for `count` symbols with these places, with where each lies. */
    function placed(labelPlaces: LabelPlaces, threshold: number, count = 1, modifiers: Record<string, unknown> = {}) {
      const { e, controller, clock } = realMapView();
      e.setSymbolOptions(30, threshold);
      e.setDisplayOptions(options({ labelPlaces }));
      const objects = Array.from({ length: count }, (_, i) => ({ ...symbolObject(10 + i, L.id, 15 + i * 0.1, 58, { ...INFANTRY, modifiers }), properties: { name: `Alpha ${String(i)}` } }));
      controller.listener.snapshot({ layers: [L], objects, sequenceNo: 1 });
      clock.advance(5_000);
      (e as unknown as { refreshLabels(): void }).refreshLabels();
      return sources(e).labels.getFeatures().flatMap((f) => {
        const style = f.getStyle();
        const text = style instanceof OlStyle ? style.getText() : null;
        return text?.getText() === undefined ? [] : [{ text: String(text.getText()), x: text.getOffsetX(), y: text.getOffsetY(), align: text.getTextAlign(), baseline: text.getTextBaseline() }];
      });
    }

    it('draws the name below the symbol when it is placed there, and nothing when no label is placed', () => {
      const shown = placed({ ...NONE, below: 'name' }, 2000);
      expect(shown.map((t) => t.text)).toEqual(['Alpha 0']);
      expect(shown[0]?.y).toBeGreaterThan(0); // below the anchor
      expect(shown[0]?.baseline).toBe('top');
      expect(shown[0]?.align).toBe('center');
      expect(placed(NONE, 2000)).toEqual([]);
      expect(placed({ ...NONE, topRight: 'uniqueDesignation' }, 2000)).toEqual([]); // the object has none of it
      expect(placed({ ...NONE, topLeft: 'type' }, 2000, 1, { type: 'T', uniqueDesignation: 'U' }).map((t) => t.text)).toEqual(['T']); // a place with no label draws nothing, whatever the object has
    });

    it('puts a label at each corner beside the image, growing away from it, and one below it', () => {
      const all = placed({ topLeft: 'type', topRight: 'uniqueDesignation', bottomLeft: 'dtg', bottomRight: 'additionalInformation', below: 'name' }, 2000, 1, { type: 'T', uniqueDesignation: 'U', dtg: 'D', additionalInformation: 'A' });
      const at = (text: string) => all.find((t) => t.text === text);
      expect(all).toHaveLength(5);
      expect(at('T')).toMatchObject({ align: 'right', baseline: 'top' }); // top left: the text ends at the image's left edge
      expect(at('U')).toMatchObject({ align: 'left', baseline: 'top' });
      expect(at('D')).toMatchObject({ align: 'right', baseline: 'bottom' });
      expect(at('A')).toMatchObject({ align: 'left', baseline: 'bottom' });
      expect(at('Alpha 0')).toMatchObject({ align: 'center', baseline: 'top' });
      expect(at('T')?.x).toBeLessThan(0);
      expect(at('D')?.x).toBeLessThan(0);
      expect(at('U')?.x).toBeGreaterThan(0);
      expect(at('A')?.x).toBeGreaterThan(0);
      expect(at('U')?.y).toBeLessThan(0); // the top: above the anchor
      expect(at('T')?.y).toBeLessThan(0);
      expect(at('D')?.y).toBeGreaterThan(0);
      expect(at('A')?.y).toBeGreaterThan(0);
      expect(at('Alpha 0')?.y).toBeGreaterThan(at('A')?.y ?? Number.POSITIVE_INFINITY); // below the bottom corners
    });

    it('reads each label from the object: the name from properties, the speed in km/h, the others from the amplifiers', () => {
      const shown = placed({ topLeft: 'speed', topRight: 'higherFormation', bottomLeft: 'altitudeDepth', bottomRight: 'staffComments', below: 'name' }, 2000, 1, { speed: 10, higherFormation: 'HF', altitudeDepth: '500 m', staffComments: 'SC' });
      expect(shown.map((t) => t.text).sort()).toEqual(['36 km/h', '500 m', 'Alpha 0', 'HF', 'SC'].sort());
    });

    it('follows the text threshold: not above it', () => {
      expect(placed({ ...NONE, below: 'name' }, 2, 2).map((t) => t.text).sort()).toEqual(['Alpha 0', 'Alpha 1']);
      expect(placed({ ...NONE, below: 'name' }, 2, 3)).toEqual([]);
    });

    it('asks symbology for the text image only where it still draws something: an amplifier that cannot be placed', () => {
      const withListed = realMapView();
      const service = createFakeSymbolService();
      withListed.e.setSymbols(service);
      const listedOnly = { ...symbolObject(10, L.id, 15, 58, { ...INFANTRY, modifiers: { uniqueDesignation: 'U', speed: 4 } }) };
      withListed.controller.listener.snapshot({ layers: [L], objects: [listedOnly], sequenceNo: 1 });
      withListed.clock.advance(5_000);
      (withListed.e as unknown as { refreshLabels(): void }).refreshLabels();
      expect(service.renderRequests.filter((r) => r.withText === true)).toEqual([]);
      const offList = { ...symbolObject(11, L.id, 15.1, 58, { ...INFANTRY, modifiers: { uniqueDesignation: 'U', quantity: '12' } }) };
      withListed.controller.listener.changes([event(2, offList)]);
      withListed.clock.advance(5_000);
      (withListed.e as unknown as { refreshLabels(): void }).refreshLabels();
      const asked = service.renderRequests.filter((r) => r.withText === true);
      expect(asked.length).toBeGreaterThan(0);
      for (const request of asked) expect(request.labels).toEqual([]);
    });
  });
});

describe('OpenLayers engine: areas and lines across the antimeridian in EPSG:3857 (brief functions 18 and 36, criterion 87)', () => {
  const world = 40_075_016.68;

  it('draws a circle, a polygon, a line, an arc band and a corridor over 180° as short areas, not as a stripe round the world', () => {
    const { e: engine, controller, clock, map } = realMapView();
    map.goTo([180, 10], 20_000);
    const L = layer(1);
    const style = { strokeColor: '#ff7f0e', fillColor: '#ff7f0e', fillOpacity: 0.4 };
    const objects = [
      object(70, L.id, 'core.shape', { type: 'Circle', center: [179.9, 10.2], radius: 60_000 }, { style }),
      object(71, L.id, 'core.shape', { type: 'Polygon', coordinates: [[[179.5, 8], [-179.5, 8], [-179.5, 9], [179.5, 9], [179.5, 8]]] }, { style }),
      object(72, L.id, 'core.shape', { type: 'LineString', coordinates: [[179.2, 7], [-179.2, 7.5]] }, { style }),
      object(73, L.id, 'core.shape', { type: 'ArcBand', center: [179.8, 10.2], innerRadius: 20_000, outerRadius: 80_000, startBearing: 0, endBearing: 180 }, { style }),
      object(74, L.id, 'core.shape', { type: 'Corridor', coordinates: [[179.4, 8.9], [-179.4, 9.3]], width: 10_000 }, { style }),
    ];
    controller.listener.snapshot({ layers: [L], objects, sequenceNo: 1 });
    clock.advance(5_000);
    const features = (engine as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source.getFeatures() ?? [];
    for (const o of objects) {
      const geometry = features.find((f) => f.getId() === o.id)?.getGeometry();
      expect(geometry, o.geometry.type).toBeDefined();
      const [minX = 0, , maxX = 0] = geometry?.getExtent() ?? [];
      expect(maxX - minX, o.geometry.type).toBeGreaterThan(0);
      expect(maxX - minX, o.geometry.type).toBeLessThan(world / 20); // a few degrees at most, never the world
    }
    // The areas go on past the edge of the world (the next copy), as one piece: the corridor ends east of it.
    const corridor = features.find((f) => f.getId() === objects[4]?.id)?.getGeometry()?.getExtent() ?? [];
    expect(corridor[2] ?? 0).toBeGreaterThan(world / 2);
  });

  it('picks an area across 180° on its outline from both sides of the edge, and nothing inside it (function 28)', () => {
    const { e: engine, controller, clock, map } = realMapView();
    map.goTo([180, 10], 700);
    const L = layer(1);
    const centre: [number, number] = [179.8, 10.2];
    const band = object(80, L.id, 'core.shape', { type: 'ArcBand', center: centre, innerRadius: 20_000, outerRadius: 80_000, startBearing: 0, endBearing: 180 });
    controller.listener.snapshot({ layers: [L], objects: [band], sequenceNo: 1 });
    clock.advance(5_000);
    const view = engine.view;
    if (view === null) throw new Error('no view');
    const world = 40_075_016.68;
    const nearView = (lonLat: Position) => {
      const xy = mercator.forward(lonLat);
      if (xy === null) throw new Error('no point');
      const copy = Math.round((view.center[0] - xy[0]) / world);
      return mapToPixel(view, [xy[0] + copy * world, xy[1]]);
    };
    // On the outer arc east of 180° (past the edge of the world) and on the one west of it, and on a side.
    expect(map.pick(nearView(destination(centre, 90, 80_000)))).toEqual([band.id]);
    expect(map.pick(nearView(destination(centre, 135, 80_000)))).toEqual([band.id]);
    expect(map.pick(nearView(destination(centre, 0, 50_000)))).toEqual([band.id]);
    // Inside the fill and in the hole: nothing.
    expect(map.pick(nearView(destination(centre, 90, 50_000)))).toEqual([]);
    expect(map.pick(nearView(destination(centre, 90, 5_000)))).toEqual([]);
    // A circle wholly west of 180° is stored in the world's main copy, and picked from the copy the view is in.
    const circle = object(81, L.id, 'core.shape', { type: 'Circle', center: [-179.9, 9], radius: 10_000 });
    controller.listener.snapshot({ layers: [L], objects: [band, circle], sequenceNo: 2 });
    clock.advance(5_000);
    expect(map.pick(nearView(destination([-179.9, 9], 270, 10_000)))).toEqual([circle.id]);
  });

  it('draws what is wholly on one side as before, and the first point where the projection puts it', () => {
    const { e: engine, controller, clock } = realMapView();
    const L = layer(1);
    const line = object(75, L.id, 'core.shape', { type: 'LineString', coordinates: [[-179.5, 8], [-178.5, 8.5]] });
    controller.listener.snapshot({ layers: [L], objects: [line], sequenceNo: 1 });
    clock.advance(5_000);
    const features = (engine as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source.getFeatures() ?? [];
    const coordinates = (features.find((f) => f.getId() === line.id)?.getGeometry() as OlLineString).getCoordinates();
    expect(coordinates[0]?.[0]).toBeCloseTo((-179.5 * Math.PI * 6378137) / 180, 3);
    expect(coordinates[coordinates.length - 1]?.[0]).toBeCloseTo((-178.5 * Math.PI * 6378137) / 180, 3);
  });
});

describe('OpenLayers engine: a line with an arrowhead and route markers (brief function 18)', () => {
  it('criterion 35: draws them beside the line, removes them with it, and picks the line, once, at its end', () => {
    const { e: engine, controller, map, clock } = realMapView();
    const L = layer(1);
    const route = object(20, L.id, 'core.shape', { type: 'LineString', coordinates: [[15, 60], [16, 61], [18, 61.5]] }, { style: { strokeColor: '#ff0000', strokeWidth: 3, arrowhead: 'end', pointMarkers: 'circle' } });
    controller.listener.snapshot({ layers: [L], objects: [route], sequenceNo: 1 });
    clock.advance(5_000);
    const source = (engine as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source;
    const ids = () => (source?.getFeatures() ?? []).map((f) => String(f.getId())).sort();
    expect(ids()).toEqual([route.id, `${route.id}#arrow`, `${route.id}#markers`].sort());
    const view = engine.view;
    const xy = mercator.forward([18, 61.5]);
    if (view === null || xy === null) throw new Error('no view');
    expect(map.pick(mapToPixel(view, xy))).toEqual([route.id]);
    // Changed without them: they go; deleted: everything goes.
    controller.listener.changes([event(2, { ...route, version: 2, style: { strokeColor: '#ff0000' } })]);
    clock.advance(1_000);
    expect(ids()).toEqual([route.id]);
    controller.listener.changes([event(3, { ...route, version: 3 })]);
    clock.advance(1_000);
    expect(ids()).toHaveLength(3);
    controller.listener.changes([event(4, null, { id: route.id, type: 'object' })]);
    clock.advance(1_000);
    expect(ids()).toEqual([]);
  });
});

describe('OpenLayers engine: shape labels (brief function 18; owner 2026-10-15 and 2026-10-16: they follow the text threshold, one count with symbols)', () => {
  function labelled(threshold: number, withSymbols = true) {
    const { e, controller, clock } = realMapView();
    if (!withSymbols) e.setSymbols(null as unknown as SymbolService);
    e.setSymbolOptions(30, threshold);
    const L = layer(1);
    const area = object(30, L.id, 'core.shape', { type: 'Polygon', coordinates: [[[14, 59], [16, 59], [16, 60.5], [14, 60.5], [14, 59]]] }, { properties: { name: 'Area A' } });
    const line = object(31, L.id, 'core.shape', { type: 'LineString', coordinates: [[13, 61], [17, 61.5]] }, { properties: { name: 'Route B' } });
    const unnamed = object(32, L.id, 'core.shape', { type: 'LineString', coordinates: [[13, 58], [17, 58.5]] }, { properties: { name: '  ' } });
    controller.listener.snapshot({ layers: [L], objects: [area, line, unnamed, symbolObject(33, L.id, 15, 62), symbolObject(34, L.id, 16, 62)], sequenceNo: 1 });
    clock.advance(5_000);
    (e as unknown as { refreshLabels(): void }).refreshLabels();
    const texts = sources(e).labels.getFeatures().flatMap((f) => {
      const style = f.getStyle();
      const text = style instanceof OlStyle ? style.getText()?.getText() : undefined;
      return typeof text === 'string' ? [{ text, at: (f.getGeometry() as Point).getCoordinates() }] : [];
    });
    return texts.sort((a, b) => a.text.localeCompare(b.text));
  }

  it('criterion 35: draws a named area and a named line with their names, inside the area and at the middle of the line', () => {
    const texts = labelled(4); // two named shapes and two symbols: exactly at the threshold
    expect(texts.map((t) => t.text)).toEqual(['Area A', 'Route B']);
    const [lon, lat] = mercator.inverse([texts[0]?.at[0] ?? 0, texts[0]?.at[1] ?? 0]) ?? [0, 0];
    expect(lon).toBeGreaterThan(14);
    expect(lon).toBeLessThan(16);
    expect(lat).toBeGreaterThan(59);
    expect(lat).toBeLessThan(60.5);
    const middle = mercator.inverse([texts[1]?.at[0] ?? 0, texts[1]?.at[1] ?? 0]) ?? [0, 0];
    expect(middle[0]).toBeCloseTo(15, 0);
    expect(middle[1]).toBeGreaterThan(61);
    expect(middle[1]).toBeLessThan(61.5);
  });

  it('criterion 35: above the threshold, counted over symbols and named shapes together, no texts at all', () => {
    expect(labelled(3)).toEqual([]);
  });

  it("criterion 43: a label in the look's text colour on a halo in its ground colour, in its text font, 12 px in every look; a new look relabels at once (owner, 2026-10-20)", async () => {
    const { e, controller, clock } = realMapView();
    const L = layer(1);
    controller.listener.snapshot({ layers: [L], objects: [object(30, L.id, 'core.shape', { type: 'LineString', coordinates: [[13, 61], [17, 61.5]] }, { properties: { name: 'Route B' } })], sequenceNo: 1 });
    clock.advance(5_000);
    const label = () => {
      const style = sources(e).labels.getFeatures()[0]?.getStyle();
      const text = style instanceof OlStyle ? style.getText() : null;
      return [text?.getFont(), text?.getFill()?.getColor(), text?.getStroke()?.getColor()];
    };
    e.setTextLook(textLookFrom(FAKE_TOKEN_VALUES));
    await new Promise((resolve) => setTimeout(resolve, 0)); // what the snapshot queued
    (e as unknown as { refreshLabels(): void }).refreshLabels();
    expect(label()).toEqual([`600 12px ${FAKE_TOKEN_VALUES.fontText}`, 'rgba(227, 232, 239, 1)', 'rgba(15, 18, 23, 0.9)']);
    e.setTextLook(textLookFrom({ ...FAKE_TOKEN_VALUES, colorText: '#1c2830', colorGround: '#ecefea', fontText: 'Arial, sans-serif', sizeText: '14px' })); // Chart Room, comfortable
    await new Promise((resolve) => setTimeout(resolve, 0)); // the labels are drawn again on the next turn
    expect(label()).toEqual(['600 12px Arial, sans-serif', 'rgba(28, 40, 48, 1)', 'rgba(236, 239, 234, 0.9)']);
  });

  it('labels shapes also without the symbology plugin', () => {
    expect(labelled(4, false).map((t) => t.text)).toEqual(['Area A', 'Route B']);
  });
});

describe('OpenLayers engine: editing a shape (brief function 17; criteria 33 and 41)', () => {
  it("criterion 33: moves and reshapes with OpenLayers' own tools on a layer of its own; Enter returns the shape; unmounting ends it with null", async () => {
    const { e } = engine();
    const map = (e as unknown as { map: OlMap }).map;
    const interactions = () => map.getInteractions().getArray().filter((i) => i instanceof Translate || i instanceof Modify);
    const layers = () => map.getLayers().getLength();
    const before = layers();
    const ring: [number, number][] = [[0, 0], [1000, 0], [1000, 1000], [0, 0]];
    const ended: unknown[] = [];
    e.startEditing({ kind: 'polygon', rings: [ring] }, undefined, { reshape: () => null, move: () => null }, (shape) => ended.push(shape));
    expect(interactions().map((i) => i.constructor.name).sort()).toEqual(['Modify', 'Translate'].sort());
    expect(layers()).toBe(before + 1);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ended).toEqual([{ kind: 'polygon', rings: [ring] }]);
    await Promise.resolve();
    expect(interactions()).toHaveLength(0);
    expect(layers()).toBe(before);
    // Ended by unmounting the map: null, and nothing left behind.
    const unmount = e.mount(document.createElement('div'));
    e.startEditing({ kind: 'line', points: [[0, 0], [1000, 500]] }, undefined, { reshape: () => null, move: () => null }, (shape) => ended.push(shape));
    unmount();
    expect(ended[1]).toBeNull();
    await Promise.resolve();
    expect(interactions()).toHaveLength(0);
  });

  it("criterion 33: a circle's handles: the shape shown is the outline reshape gives, and Enter returns the handles", () => {
    const { e } = engine();
    const outline: [number, number][] = [[0, 100], [100, 0], [0, -100], [-100, 0]];
    const ended: unknown[] = [];
    const circle = { kind: 'circle', center: [0, 0], edge: [100, 0] } as const;
    e.startEditing(circle, undefined, { reshape: (shape) => ({ shape, outline }), move: () => null }, (shape) => ended.push(shape));
    const editLayer = (e as unknown as { editing: { layer: { getSource(): VectorSource } } }).editing.layer;
    const features = editLayer.getSource().getFeatures();
    expect(features).toHaveLength(3); // the body, the centre and the edge handle
    const body = features.find((f) => f.getGeometry() instanceof OlPolygon);
    expect((body?.getGeometry() as OlPolygon).getCoordinates()[0]).toEqual([...outline, outline[0]]);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ended).toEqual([circle]);
  });
});

describe('OpenLayers engine: editing and the WebGL layers without hit detection (T-195; the ITA m3-sim-panels)', () => {
  it('Translate asks only the edit layer for the feature under the pointer: forEachFeatureAtCoordinate throws on a WebGL layer without hit detection', () => {
    const { e, controller } = realMapView();
    controller.listener.snapshot({ layers: [layer(1)], objects: [], sequenceNo: 1 });
    e.startEditing({ kind: 'line', points: [[0, 0], [1000, 0]] }, undefined, { reshape: () => null, move: () => null }, () => undefined);
    const state = (e as unknown as { editing: { layer: unknown; interactions: readonly unknown[] } }).editing;
    const translate = state.interactions.find((i): i is Translate => i instanceof Translate);
    const asked = (translate as unknown as { layerFilter_: (candidate: unknown) => boolean }).layerFilter_;
    const webgl = [...(e as unknown as { layers: Map<string, { layer: { hitDetectionDisabled_: boolean } }> }).layers.values()].map((entry) => entry.layer);
    expect(webgl).toHaveLength(1);
    expect(webgl[0]?.hitDetectionDisabled_).toBe(true);
    expect(asked(webgl[0])).toBe(false);
    expect(asked(state.layer)).toBe(true);
  });

  it('Modify does no hit detection of its own (its hitDetection option is unset), so it asks no layer', () => {
    const { e } = engine();
    e.startEditing({ kind: 'line', points: [[0, 0], [1000, 0]] }, undefined, { reshape: () => null, move: () => null }, () => undefined);
    const modify = (e as unknown as { editing: { interactions: readonly unknown[] } }).editing.interactions.find((i): i is Modify => i instanceof Modify);
    expect((modify as unknown as { hitDetection_: unknown }).hitDetection_).toBeNull();
  });
});

describe('OpenLayers engine: editing a circle or an ellipse with the real geodesic tools (review findings 1 and 3, part C)', () => {
  function editing(shape: EditShape) {
    const { e } = engine();
    const ended: (EditShape | null)[] = [];
    e.startEditing(shape, undefined, { reshape: (s) => reshape(s, mercator), move: (before, center) => moveRound(before, center, mercator) }, (s) => ended.push(s));
    const state = (e as unknown as { editing: { layer: { getSource(): VectorSource }; interactions: readonly unknown[] } }).editing;
    const points = state.layer.getSource().getFeatures().filter((f) => f.getGeometry() instanceof OlPoint);
    const translate = state.interactions.find((i): i is Translate => i instanceof Translate);
    const finish = () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return ended[0] ?? null;
    };
    return { points, translate, finish };
  }

  it("criterion 33: an ellipse's minor handle dragged past the major swaps the axes", () => {
    const center = mercator.forward([16, 61]) ?? [0, 0];
    const shape = editShapeOf({ type: 'Ellipse', center: [16, 61], semiMajorAxis: 8_000, semiMinorAxis: 3_000, rotation: 30 }, mercator);
    if (shape === null) throw new Error('no shape');
    const { points, finish } = editing(shape);
    // The handles: the centre, the major end, the minor end. The minor end moves 12 km out.
    const minor = points[2]?.getGeometry() as OlPoint;
    minor.setCoordinates([...(mercator.forward(destination([16, 61], 120, 12_000)) ?? [0, 0])]);
    const edited = editedGeometry(finish() ?? shape, mercator);
    if ('problem' in edited || edited.geometry.type !== 'Ellipse') throw new Error('not an ellipse');
    expect(edited.geometry.semiMajorAxis).toBeCloseTo(12_000, 0);
    expect(edited.geometry.semiMinorAxis).toBeCloseTo(8_000, 0);
    expect(edited.geometry.rotation).toBeCloseTo(120, 0);
    expect(center).toBeDefined();
  });

  it('criterion 33: a circle moved from 60° N to 20° N keeps its radius (map units are not metres)', () => {
    const shape = editShapeOf({ type: 'Circle', center: [15, 60], radius: 5_000 }, mercator);
    if (shape === null) throw new Error('no shape');
    const { points, translate, finish } = editing(shape);
    const from = mercator.forward([15, 60]) ?? [0, 0];
    const to = mercator.forward([15, 20]) ?? [0, 0];
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
    // What OpenLayers' Translate does: every feature in its collection moves by the same map vector.
    translate?.dispatchEvent(new TranslateEvent('translatestart', new Collection(), [...from], [...from], undefined as never));
    for (const point of points) (point.getGeometry() as OlPoint).translate(dx, dy);
    translate?.dispatchEvent(new TranslateEvent('translateend', new Collection(), [...to], [...from], undefined as never));
    const edited = editedGeometry(finish() ?? shape, mercator);
    if ('problem' in edited || edited.geometry.type !== 'Circle') throw new Error('not a circle');
    expect(edited.geometry.center[1]).toBeCloseTo(20, 6);
    expect(Math.abs(edited.geometry.radius - 5_000)).toBeLessThan(0.01);
  });
});

describe('OpenLayers engine: a projection code given a new definition (owner, 2026-10-13, review R9)', () => {
  it("settings at runtime (design pattern section 7): OpenLayers' own conversions (graticule, scale line) follow the new definition; the other projections and OpenLayers' built-in ones keep theirs", () => {
    const def = { ...polar.def, code: 'TEST:9413' };
    const point: Position = [15, 62];
    const projectedBy = (p: Projection | undefined) => {
      const xy = p?.forward(point);
      if (xy == null) throw new Error('not converted');
      return xy;
    };
    const before = registerProjections([def]).projections[0];
    registerWithOpenLayers([...projections, ...(before === undefined ? [] : [before])]);
    expect(olTransform([...point], 'EPSG:4326', def.code).map(Math.round)).toEqual(projectedBy(before).map(Math.round));

    const after = registerProjections([{ ...def, proj4: def.proj4.replace('+lon_0=-45', '+lon_0=0') }]).projections[0];
    registerWithOpenLayers(after === undefined ? [] : [after]);
    const now = olTransform([...point], 'EPSG:4326', def.code);
    expect(now.map(Math.round)).toEqual(projectedBy(after).map(Math.round));
    expect(Math.abs((now[0] ?? 0) - projectedBy(before)[0])).toBeGreaterThan(100_000);
    expect(olTransform([...point], 'EPSG:4326', polar.def.code).map(Math.round)).toEqual(projectedBy(polar).map(Math.round));
    expect(getOlProjection(polar.def.code)?.getExtent()).toEqual([...polar.def.extent]);
    expect(getOlProjection(polar.def.code)?.getWorldExtent()).toEqual([...polar.def.worldExtent]);
    // OpenLayers' built-in projections and aliases are back, not proj4's (conformance review remark 1).
    expect(getOlProjection('CRS:84')).not.toBeNull();
    expect(getOlProjection('EPSG:102100')).not.toBeNull();
    expect(getOlProjection('EPSG:4326')?.getMetersPerUnit()).toBeCloseTo(111_319.49, 1);
    expect(olTransform([...projectedBy(mercator)], mercator.def.code, 'EPSG:4326').map((n) => Math.round(n * 1e6) / 1e6)).toEqual(point);
  });
});

describe('OpenLayers engine: selection box and the keys of a click (brief function 14)', () => {
  const keys = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
  function boxEngine(mac: boolean) {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const e = new OpenLayersEngine({ projection: mercator, center: [0, 0], resolution: 1000, symbolSize: 30, textThreshold: 2000, log, mac, styleSwapIntervalMs: 0 });
    const map = (e as unknown as { map: OlMap }).map;
    map.setSize([800, 600]);
    const boxes = map.getInteractions().getArray().filter((i): i is DragBox => i instanceof DragBox && !(i instanceof DragZoom));
    expect(boxes).toHaveLength(1);
    const box = boxes[0] as DragBox;
    const starts = (held: Partial<typeof keys>) =>
      box.getActive() && (box as unknown as { condition_: (e: unknown) => boolean }).condition_({ originalEvent: { pointerId: 1, isPrimary: true, button: 0, ...keys, ...held } });
    return { e, map, box, starts };
  }

  it('criterion 26: Ctrl+drag draws the box (Cmd+drag on a Mac); Shift+drag stays the zoom box; nothing else does', () => {
    const pc = boxEngine(false);
    expect(pc.starts({ ctrlKey: true })).toBe(true);
    expect(pc.starts({ metaKey: true })).toBe(false);
    expect(pc.starts({ shiftKey: true })).toBe(false);
    expect(pc.starts({ ctrlKey: true, shiftKey: true })).toBe(false);
    expect(pc.starts({})).toBe(false);
    expect(pc.map.getInteractions().getArray().some((i) => i instanceof DragZoom && i.getActive())).toBe(true);
    const mac = boxEngine(true);
    expect(mac.starts({ metaKey: true })).toBe(true);
    expect(mac.starts({ ctrlKey: true })).toBe(false);
  });

  it('criterion 41: no box while a point is picked or a shape drawn or edited; a box while an object can be dragged (owner, 2026-10-16)', () => {
    const { e, starts } = boxEngine(false);
    for (const [mode, box] of [['pick-point', false], ['draw', false], ['edit', false], ['drag-object', true], ['none', true]] as const) {
      e.setInteraction(mode);
      expect(starts({ ctrlKey: true })).toBe(box);
    }
  });

  it('reports the box from the press to the release, in pixels', () => {
    const { e, box } = boxEngine(false);
    const reported: unknown[] = [];
    e.onSelectBox((b) => reported.push(b));
    box.dispatchEvent(new DragBoxEvent('boxstart', [0, 0], { pixel: [10, 20] } as never));
    box.dispatchEvent(new DragBoxEvent('boxend', [0, 0], { pixel: [300, 200] } as never));
    expect(reported).toEqual([{ from: [10, 20], to: [300, 200] }]);
  });

  it('criterion 25: a click reports the add key (Ctrl, Cmd on a Mac) and other keys', () => {
    for (const [mac, held, expected] of [
      [false, {}, undefined], [false, { ctrlKey: true }, 'add'], [false, { metaKey: true }, 'other'], [false, { shiftKey: true }, 'other'],
      [true, { metaKey: true }, 'add'], [true, { ctrlKey: true }, 'other'],
    ] as const) {
      const { e, map } = boxEngine(mac);
      const clicks: unknown[] = [];
      e.onPointer((event) => clicks.push(event.keys));
      map.dispatchEvent({ type: 'click', pixel: [5, 5], originalEvent: { ...keys, ...held } } as never);
      expect(clicks).toEqual([expected]);
    }
  });

  it("criteria 26 and 28: the box finds a symbol by its position and a line by its path, not an area around the box, nor what a hidden layer holds", () => {
    const { e } = boxEngine(false);
    e.setLayers([{ id: uuid(1), stack: 0, visible: true }, { id: uuid(2), stack: 1, visible: false }]);
    const shape = (n: number, geometry: Parameters<typeof toDrawItem>[0]['geometry']) => toDrawItemOrThrow({ ...symbolObject(n, uuid(1), 0, 0), type: 'core.shape', geometry, style: { strokeColor: '#000000' } });
    e.replaceItems(uuid(1), [
      toDrawItemOrThrow(symbolObject(10, uuid(1), 1, 1)),
      toDrawItemOrThrow(symbolObject(11, uuid(1), 3, 2)),
      shape(12, { type: 'LineString', coordinates: [[-3, 0], [3, 0]] }),
      shape(13, { type: 'Polygon', coordinates: [[[-3, -2.5], [3, -2.5], [3, 2.5], [-3, 2.5], [-3, -2.5]]] }),
    ]);
    e.replaceItems(uuid(2), [toDrawItemOrThrow(symbolObject(20, uuid(2), 0.5, 0.5))]);
    const box = { from: [300, 150], to: [600, 450] } as const; // about 0.9° W to 1.8° E, 1.35° S to 1.35° N
    expect(new Set(boxAt(e.boxCandidates(box), box))).toEqual(new Set([uuid(10), uuid(12)]));
  });
});

describe('OpenLayers engine: the right click (brief function 15)', () => {
  it("reports a right click on the map as a menu event with the page point, and keeps the browser's own menu shut", () => {
    const { e, map } = engine();
    map.setSize([800, 600]);
    const events: unknown[] = [];
    e.onPointer((event) => events.push(event));
    const contextmenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 });
    map.getViewport().dispatchEvent(contextmenu);
    expect(contextmenu.defaultPrevented).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'menu', page: [120, 80] });
  });
});

describe('OpenLayers engine: dim (brief function 19)', () => {
  it('criterion 37: a black layer between the background and the objects, at the dim level; hidden at 0', () => {
    const { e, map } = engine();
    e.setLayers([{ id: uuid(1), stack: 0, visible: true }]);
    const dim = map.getLayers().getArray().find((l) => l.getClassName() === 'map-view-2d-dim');
    if (dim === undefined) throw new Error('no dim layer');
    const objects = map.getLayers().getArray().filter((l) => l.getClassName() === 'map-view-2d-layer');
    // Without a background map the graticule (z 1) is what lies under the objects: the dim layer is
    // above it, and its element covers the neutral background too (owner, 2026-10-17: the grid dims).
    const background = map.getLayers().getArray().filter((l) => l.getZIndex() !== undefined && (l.getZIndex() ?? 0) <= 1);
    expect(background.some((l) => l instanceof Graticule)).toBe(true);
    for (const l of background) expect(dim.getZIndex()).toBeGreaterThan(l.getZIndex() ?? 0);
    for (const l of objects) expect(dim.getZIndex()).toBeLessThan(l.getZIndex() ?? 0);
    expect(dim.getVisible()).toBe(false);
    e.setDim(0.6);
    const element = (dim as unknown as { render: (frame: unknown) => HTMLElement }).render(null);
    expect(dim.getVisible()).toBe(true);
    expect(element.style.opacity).toBe('0.6');
    expect(element.style.background).toMatch(/rgb\(0, 0, 0\)|#000/);
    expect(element.style.pointerEvents).toBe('none');
    expect([element.style.position, element.style.inset]).toEqual(['absolute', '0px']);
    e.setDim(5); // never past 90 %
    expect(element.style.opacity).toBe('0.9');
    e.setDim(0);
    expect(dim.getVisible()).toBe(false);
  });
});

describe('OpenLayers engine: sensor report symbols (brief function 39, criteria 96 to 99; SDK 1.5.0 part 3)', () => {
  const L = layer(1);
  const DETECTION: DataType = { id: 'gmti.detection', name: 'GMTI detection', declaredBy: 'gmti', defaults: { fadeWhenExpired: true }, behaviour: { fadeWhenExpired: true }, sensorReport: true };
  const COT: DataType = { id: 'cot.cot', name: 'CoT', declaredBy: 'cot', defaults: {}, behaviour: {} };
  const TANK: MilSymbol = { standard: 'APP-6D', sidc: '10061000001205000000' }; // not INFANTRY: the requests tell which object asked
  const detection = (n: number, at: Position, extra: Partial<MapObject> = {}) => ({
    ...symbolObject(n, L.id, at[0], at[1], { ...TANK, modifiers: { speed: 10, direction: 90 } }),
    dataType: 'gmti.detection', properties: { name: 'D1' }, ...extra,
  });
  const track = (n: number, at: Position) => ({ ...symbolObject(n, L.id, at[0], at[1], INFANTRY), dataType: 'cot.cot' });
  const featureOf = (e: OpenLayersEngine, id: string) =>
    (e as unknown as { layers: Map<string, { source: VectorSource }> }).layers.get(L.id)?.source.getFeatureById(id);
  const sizeOf = (e: OpenLayersEngine, id: string) => {
    const f = featureOf(e, id);
    return [f?.get(P.w), f?.get(P.h), f?.get(P.ax), f?.get(P.ay)] as unknown[];
  };
  const textsOf = (e: OpenLayersEngine) => {
    (e as unknown as { refreshLabels(): void }).refreshLabels();
    return sources(e).labels.getFeatures().flatMap((f) => {
      const style = f.getStyle();
      const text = style instanceof OlStyle ? style.getText() : null;
      return text?.getText() === undefined ? [] : [String(text.getText())];
    });
  };
  function start(service: SymbolService = createFakeSymbolService(), types: readonly DataType[] = [DETECTION, COT]) {
    const run = realMapView({ symbols: service, dataTypes: types });
    return { ...run, service };
  }

  it('criterion 96: a detection is the service\'s 12 by 12 image at its anchor, with no render request, no name, no arrow and no vector; a cot track beside it is drawn as before', () => {
    const service = createFakeSymbolService();
    const { e, controller, clock } = start(service);
    e.setDisplayOptions(options({ labelPlaces: NAME_BELOW, speedVectorSeconds: 600 }));
    e.setSymbolOptions(48, 2000);
    const d = detection(10, [15.2, 58.41]);
    const t = track(11, [15.3, 58.5]);
    controller.listener.snapshot({ layers: [L], objects: [d, t], sequenceNo: 1 });
    clock.advance(5_000);
    expect(sizeOf(e, d.id)).toEqual([12, 12, 6, 6]); // the symbol size 48 does not change it
    expect(featureOf(e, d.id)?.get(P.inAtlas)).toBe(1);
    expect(featureOf(e, d.id)?.get(P.hasArrow)).toBe(0);
    expect(featureOf(e, `${d.id}#vector`)).toBeNull();
    expect(featureOf(e, `${t.id}#vector`)).toBeNull(); // the track has no speed
    expect(sizeOf(e, t.id)).toEqual([48, 48, 24, 24]); // the track: render, at the size
    expect(service.renderRequests.some((r) => r.sidc === TANK.sidc)).toBe(false); // no render call for the detection
    expect(service.renderRequests.some((r) => r.sidc === INFANTRY.sidc)).toBe(true);
    expect(textsOf(e)).toEqual([]); // no name under it (the labels have `name`)
    expect(service.renderRequests.some((r) => r.sidc === TANK.sidc)).toBe(false); // nor a text image
  });

  it('criterion 96: a symbol with a speed and a direction in a data type without the flag keeps its arrow and gets its vector and name', () => {
    const { e, controller, clock } = start();
    e.setDisplayOptions(options({ labelPlaces: NAME_BELOW, speedVectorSeconds: 0 }));
    const plain = detection(10, [15.2, 58.41], { dataType: 'cot.cot' });
    controller.listener.snapshot({ layers: [L], objects: [plain], sequenceNo: 1 });
    clock.advance(5_000);
    expect(featureOf(e, plain.id)?.get(P.hasArrow)).toBe(1);
    expect(textsOf(e)).toEqual(['D1']);
    e.setDisplayOptions(options({ labelPlaces: NAME_BELOW, speedVectorSeconds: 600 }));
    expect(featureOf(e, `${plain.id}#vector`)).not.toBeNull();
  });

  it('criterion 97: without sensorReportSymbol in the service, or with a data type that lacks the flag, the detection is drawn through render', () => {
    const service = createFakeSymbolService();
    const old = { ...service } as Partial<SymbolService> & { renderRequests: unknown };
    delete old.sensorReportSymbol;
    const { e, controller, clock } = start(old as SymbolService);
    e.setDisplayOptions(options({ labelPlaces: NAME_BELOW, speedVectorSeconds: 600 }));
    const d = detection(10, [15.2, 58.41]);
    controller.listener.snapshot({ layers: [L], objects: [d], sequenceNo: 1 });
    clock.advance(5_000);
    expect(sizeOf(e, d.id)[0]).toBe(30); // the image render gave, at the size
    expect(featureOf(e, d.id)?.get(P.hasArrow)).toBe(0); // its vector replaces the arrow, as for any symbol
    expect(featureOf(e, `${d.id}#vector`)).not.toBeNull();
    expect(textsOf(e)).toEqual(['D1']);

    const flagless = start(createFakeSymbolService(), [{ ...DETECTION, sensorReport: false }, COT]);
    flagless.controller.listener.snapshot({ layers: [L], objects: [d], sequenceNo: 1 });
    flagless.clock.advance(5_000);
    expect(sizeOf(flagless.e, d.id)[0]).toBe(30);
    const unknown = start(createFakeSymbolService(), []); // a data type nobody declared
    unknown.controller.listener.snapshot({ layers: [L], objects: [d], sequenceNo: 1 });
    unknown.clock.advance(5_000);
    expect(sizeOf(unknown.e, d.id)[0]).toBe(30);
  });

  it('criterion 97: a service whose sensorReportSymbol throws gives APP-6 symbols, and the failure is logged', () => {
    const service = { ...createFakeSymbolService(), sensorReportSymbol: () => { throw new Error('not ready'); } } as SymbolService;
    const { e, controller, clock, log } = start(service);
    const d = detection(10, [15.2, 58.41]);
    controller.listener.snapshot({ layers: [L], objects: [d], sequenceNo: 1 });
    clock.advance(5_000);
    expect(sizeOf(e, d.id)[0]).toBe(30);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('sensor report symbol'), expect.anything());
  });

  it('criterion 98: a click on its image and a box over it pick it, it is highlighted as a 12 by 12 image, and it fades by its data type', () => {
    const service = createFakeSymbolService();
    const { e, controller, map, clock } = start(service);
    const at: Position = [15.2, 58.41];
    const d = detection(10, at, { time: { expires: new Date(WALL_START + 60_000).toISOString() } });
    controller.listener.snapshot({ layers: [L], objects: [d], sequenceNo: 1 });
    clock.advance(5_000);
    map.goTo(at, 40);
    const view = e.view;
    const xy = mercator.forward(at);
    if (view === null || xy === null) throw new Error('no view');
    const centre = mapToPixel(view, xy);
    expect(map.pick(centre, 0)).toEqual([d.id]);
    expect(map.pick([centre[0] + 5, centre[1] - 5], 0)).toEqual([d.id]); // inside the 12 by 12 image
    expect(map.pick([centre[0] + 12, centre[1]], 0)).toEqual([]); // outside it
    expect(e.boxCandidates({ from: [centre[0] - 20, centre[1] - 20], to: [centre[0] + 20, centre[1] + 20] }).map((c) => c.id)).toEqual([d.id]);
    const box = e.pickCandidates(centre, 0)[0] as { left: number; right: number; top: number; bottom: number };
    expect([box.right - box.left, box.bottom - box.top]).toEqual([12, 12]);
    expect(service.renderRequests.some((r) => r.sidc === TANK.sidc)).toBe(false);
    // Highlighted (function 10): the frame fits the image as drawn.
    const before = service.renderRequests.length;
    map.selection.set([d.id]);
    clock.advance(1_000);
    expect(sources(e).highlightSource.getFeatures()).toHaveLength(1);
    expect(service.renderRequests.length).toBe(before); // nothing was rendered for it
    // Faded by its data type when it expires (function 13).
    expect(featureOf(e, d.id)?.get(P.opacity)).toBe(1);
    clock.advance(120_000);
    expect(featureOf(e, d.id)?.get(P.opacity)).toBeLessThan(1);
    expect(sizeOf(e, d.id)).toEqual([12, 12, 6, 6]);
  });

  it('criterion 98: a sensor report that is dragged shows the sensor report image in the preview, without an arrow', () => {
    const { e } = start();
    const item = toDrawItem(detection(10, [15.2, 58.41]), new Set(['gmti.detection']));
    if (item === null) throw new Error('no item');
    e.setDragPreview(item);
    const styles = sources(e).previewSource.getFeatures()[0]?.getStyle() as OlStyle[];
    expect(styles).toHaveLength(1); // the symbol only: its direction (90) gives no arrow
    expect((styles[0]?.getImage() as Icon).getImage(1)).toBe(FAKE_SENSOR_REPORT_SYMBOL.image);
  });

  it('CR-0043 part A: the drag preview of a symbol with a direction has the arrow while the switch is on, and not after it is switched off', () => {
    const { e } = start();
    const item = toDrawItem(symbolObject(10, L.id, 15.2, 58.41, { ...INFANTRY, modifiers: { direction: 90 } }));
    if (item === null) throw new Error('no item');
    e.setDragPreview(item);
    expect(sources(e).previewSource.getFeatures()[0]?.getStyle() as OlStyle[]).toHaveLength(2); // the arrow, then the symbol
    e.setDisplayOptions(options({ directionArrow: false }));
    e.setDragPreview(item);
    expect(sources(e).previewSource.getFeatures()[0]?.getStyle() as OlStyle[]).toHaveLength(1);
  });

  it('criterion 99: when the service returns another image the sensor reports show it within 2 s, without a reload', () => {
    vi.useFakeTimers();
    try {
      const service = createFakeSymbolService() as { sensorReportSymbol?: SymbolService['sensorReportSymbol'] } & SymbolService;
      const small: SymbolImage = { image: {} as ImageBitmap, width: 10, height: 10, anchor: [5, 5] };
      const big: SymbolImage = { image: {} as ImageBitmap, width: 20, height: 20, anchor: [10, 10] };
      let current = small;
      (service as { sensorReportSymbol: () => SymbolImage }).sensorReportSymbol = () => current;
      const { e, controller, clock } = start(service);
      const d = detection(10, [15.2, 58.41]);
      controller.listener.snapshot({ layers: [L], objects: [d], sequenceNo: 1 });
      clock.advance(5_000);
      expect(sizeOf(e, d.id)).toEqual([10, 10, 5, 5]);
      vi.advanceTimersByTime(1_500); // the same image: nothing changes
      expect(sizeOf(e, d.id)).toEqual([10, 10, 5, 5]);
      current = big; // the admin changed the settings
      vi.advanceTimersByTime(2_000);
      expect(sizeOf(e, d.id)).toEqual([20, 20, 10, 10]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('criterion 99: a data type that becomes a sensor report, or stops being one, redraws its objects at once', () => {
    const { e, controller, clock } = start(createFakeSymbolService(), [{ ...DETECTION, sensorReport: false }, COT]);
    const d = detection(10, [15.2, 58.41]);
    controller.listener.snapshot({ layers: [L], objects: [d], sequenceNo: 1 });
    clock.advance(5_000);
    expect(sizeOf(e, d.id)[0]).toBe(30);
    controller.setDataTypes([DETECTION, COT]);
    clock.advance(5_000);
    expect(sizeOf(e, d.id)).toEqual([12, 12, 6, 6]);
    controller.setDataTypes([{ ...DETECTION, sensorReport: false }, COT]);
    clock.advance(5_000);
    expect(sizeOf(e, d.id)[0]).toBe(30);
  });

  it('does not count toward the text threshold: names of other symbols stay with thousands of detections in view', () => {
    const { e, controller, clock } = start();
    e.setSymbolOptions(30, 2);
    e.setDisplayOptions(options({ labelPlaces: NAME_BELOW, speedVectorSeconds: 0 }));
    const objects = [
      ...Array.from({ length: 5 }, (_, i) => detection(100 + i, [15 + i / 100, 58])),
      { ...track(10, [15.2, 58.41]), properties: { name: 'Alpha' } },
    ];
    controller.listener.snapshot({ layers: [L], objects, sequenceNo: 1 });
    clock.advance(5_000);
    expect(textsOf(e)).toEqual(['Alpha']);
  });
});

describe('OpenLayers engine: the cost of the WebGL layers (T-195; the ITA slow map with an area per dwell)', () => {
  it('has no hit detection on its WebGL layers: it is a second pass over every feature each frame and nothing here asks it (picking is the map view own)', () => {
    const { e, controller } = realMapView();
    const L = layer(1);
    controller.listener.snapshot({ layers: [L, layer(2)], objects: [], sequenceNo: 1 });
    const entries = [...(e as unknown as { layers: Map<string, { layer: { hitDetectionDisabled_: boolean } }> }).layers.values()];
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(entry.layer.hitDetectionDisabled_).toBe(true);
  });
});

