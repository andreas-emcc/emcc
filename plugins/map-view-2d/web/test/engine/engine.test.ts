/**
 * The OpenLayers side, as far as it runs without WebGL: features (OpenLayers geometries in the map
 * projection), the WebGL style as plain data, atlas packing, and the engine without WebGL. Real
 * pixels are the ITA's browser tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLiteralStyle } from 'ol/render/webgl/style.js';
import type { FlatStyle } from 'ol/style/flat.js';
import type Point from 'ol/geom/Point.js';
import type LineString from 'ol/geom/LineString.js';
import type MultiPoint from 'ol/geom/MultiPoint.js';
import OlFeature from 'ol/Feature.js';
import OlLineString from 'ol/geom/LineString.js';
import OlPoint from 'ol/geom/Point.js';
import OlPolygon from 'ol/geom/Polygon.js';
import { SYMBOL_SIZE_MAX, SYMBOL_SIZE_MIN, type MilSymbol, type Position } from '@emc2/plugin-sdk';
import { toDrawItem } from '../../src/core/drawData.ts';
import { registerProjections, type Projection } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { HATCH_LINE_WIDTH, HATCH_TILE, hatchImage, ShelfPacker, textOnly, type AtlasEntry } from '../../src/engine/atlas.ts';
import { extraFeatures, fillFeatures, toFeature, type FeatureContext } from '../../src/engine/features.ts';
import { DashPatterns, graphicFeatures } from '../../src/engine/graphicFeatures.ts';
import { NullEngine } from '../../src/engine/nullEngine.ts';
import { arrowheadLength, canvasLineExtras, canvasStyles, drawPreviewStyle, frameRect, hatchPattern, HIGHLIGHT, highlightStyles, KIND, LABEL_GAP, LABEL_TEXT, layerStyle, markerRadius, P, placedLabelStyle } from '../../src/engine/styles.ts';
import type CircleStyle from 'ol/style/Circle.js';
import type Icon from 'ol/style/Icon.js';
import { INFANTRY, object, symbolObject, textbook, uuid } from '../fixtures.ts';

const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
const mercator = projections[0] as Projection;
const polar = projections[1] as Projection;
const L = uuid(1);

function context(projection: Projection, entry: AtlasEntry | null = { x: 10, y: 20, w: 30, h: 32, ax: 15, ay: 16 }): FeatureContext & { asked: MilSymbol[] } {
  let seq = 0;
  const asked: MilSymbol[] = [];
  return {
    projection,
    asked,
    directionArrow: true,
    atlasEntry: (symbol) => {
      asked.push(symbol);
      return entry;
    },
    sensorReportEntry: () => null,
    nextSeq: () => ++seq,
  };
}

function item(o: Parameters<typeof toDrawItem>[0]) {
  const drawn = toDrawItem(o);
  if (drawn === null) throw new Error('no draw item');
  return drawn;
}

describe('features', () => {
  it('criterion 3: puts a symbol at 15° E 60° N in the map projection, with its atlas entry', () => {
    const feature = toFeature(item(symbolObject(10, L, 15, 60)), context(mercator));
    const [x, y] = (feature?.getGeometry() as Point).getCoordinates();
    const [ex, ey] = textbook.webMercator(15, 60);
    expect(x).toBeCloseTo(ex, 3);
    expect(y).toBeCloseTo(ey, 3);
    expect(feature?.getId()).toBe(uuid(10));
    expect(feature?.getProperties()).toMatchObject({ [P.kind]: KIND.symbol, [P.inAtlas]: 1, [P.ox]: 10, [P.oy]: 20, [P.w]: 30, [P.h]: 32, [P.ax]: 15, [P.ay]: 16, [P.hasArrow]: 0 });
  });

  it('criterion 3: puts a symbol at 15° E 60° N where the textbook formula puts it in EPSG:3413 (review remark N4)', () => {
    const feature = toFeature(item(symbolObject(10, L, 15, 60)), context(polar));
    const [x, y] = (feature?.getGeometry() as Point).getCoordinates();
    const [ex, ey] = textbook.polarStereographic3413(15, 60);
    expect(x).toBeCloseTo(ex, 3);
    expect(y).toBeCloseTo(ey, 3);
  });

  it('marks a symbol without an image, so it is drawn as a marker', () => {
    const feature = toFeature(item(symbolObject(10, L, 15, 60)), context(mercator, null));
    expect(feature?.get(P.inAtlas)).toBe(0);
  });

  it('turns the direction arrow with true north in EPSG:3413', () => {
    const symbol = { ...INFANTRY, modifiers: { direction: 0 } };
    const feature = toFeature(item({ ...symbolObject(10, L, 15, 60), symbol }), context(polar));
    expect(feature?.get(P.hasArrow)).toBe(1);
    expect(feature?.get(P.rotation)).toBeCloseTo((-60 * Math.PI) / 180, 6);
  });

  it('criterion 4: draws a line over the pole and across the antimeridian as one line in EPSG:3413', () => {
    const line = object(11, L, 'core.shape', { type: 'LineString', coordinates: [[170, 80], [-170, 80], [-10, 85]] }, { style: { strokeColor: '#ff0000', strokeDash: 'dash' } });
    const feature = toFeature(item(line), context(polar));
    const coordinates = (feature?.getGeometry() as LineString).getCoordinates();
    expect(coordinates.length).toBeGreaterThan(10);
    for (const [x, y] of coordinates) {
      expect(Math.hypot(x ?? 0, y ?? 0)).toBeLessThan(2_000_000); // all near the pole, no jump around the world
    }
    expect(feature?.getProperties()).toMatchObject({ [P.kind]: KIND.line, [P.stroke]: [255, 0, 0, 1], [P.dash]: 1 });
  });

  it('criterion 10: draws a plugin type as a fallback marker', () => {
    const feature = toFeature(item(object(12, L, 'cot.track', { type: 'Point', coordinates: [18, 59] })), context(mercator));
    expect(feature?.get(P.kind)).toBe(KIND.fallback);
  });

  it('numbers the features in drawing order', () => {
    const ctx = context(mercator);
    const a = toFeature(item(symbolObject(10, L, 15, 60)), ctx);
    const b = toFeature(item(symbolObject(11, L, 15, 60)), ctx);
    expect(Number(b?.get(P.seq))).toBeGreaterThan(Number(a?.get(P.seq)));
  });
});

describe('WebGL style', () => {
  it('is plain data: shapes, markers, atlas symbols and arrows', () => {
    const rules = layerStyle({ atlas: 'data:image/png;base64,AAAA', arrow: 'data:image/png;base64,BBBB', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
    expect(JSON.parse(JSON.stringify(rules))).toEqual(rules);
    const sources = rules.flatMap((r) => Object.entries(r.style).filter(([k]) => k === 'icon-src').map(([, v]) => v as string));
    expect(sources).toEqual(['data:image/png;base64,BBBB', 'data:image/png;base64,AAAA', 'data:arrowhead']); // the arrow first: under the symbol (T-138)
  });

  it('reads no more properties than a WebGL program has attributes for: 20 linked in the browser, 27 did not ("Too many attributes")', () => {
    const rules = layerStyle({ atlas: 'data:atlas', arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
    const names = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) {
        if (value[0] === 'get' && typeof value[1] === 'string') names.add(value[1]);
        value.forEach(walk);
      } else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
    };
    for (const rule of rules) {
      walk(rule.filter);
      walk(rule.style);
    }
    expect(names.size).toBeLessThanOrEqual(20);
  });

  it('reads few properties in the rules that draw lines: a WebGL line program has about seven attributes to spare (the dash patterns are constants of their rules)', () => {
    const dashes = Array.from({ length: 24 }, (_, i) => [10 + i, 4, 2, 4, 2, 4]);
    const rules = layerStyle({ atlas: 'data:atlas', arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' }, dashes);
    const names = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) {
        if (value[0] === 'get' && typeof value[1] === 'string') names.add(value[1]);
        value.forEach(walk);
      } else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
    };
    for (const rule of rules.filter((r) => 'stroke-color' in r.style)) {
      walk(rule.filter);
      walk(rule.style);
    }
    expect([...names].sort()).toEqual([P.dash, P.kind, P.stroke, P.strokeWidth].sort());
  });

  it('compiles for WebGL, every rule (OpenLayers checks the expression types)', () => {
    const rules = layerStyle({ atlas: 'data:image/png;base64,AAAA', arrow: 'data:image/png;base64,BBBB', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' }, [[8, 4], [10, 4, 2, 4], [6, 2, 1, 2, 1, 2]]);
    for (const rule of rules) {
      expect(() => parseLiteralStyle(rule.style as FlatStyle, {}, rule.filter)).not.toThrow();
    }
  });

  it('has no atlas rule before there is an atlas (symbols are markers then)', () => {
    const rules = layerStyle({ atlas: null, arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
    const sources = rules.flatMap((r) => Object.entries(r.style).filter(([k]) => k === 'icon-src').map(([, v]) => v as string));
    expect(sources).toEqual(['data:arrow', 'data:arrowhead']);
  });

  it('criterion 35: fills a hatched area with the hatch tile tinted in its fill colour, and other areas solid (data model 1.1.0)', () => {
    const rules = layerStyle({ atlas: null, arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
    const fills = rules.filter((r) => 'fill-color' in r.style && !JSON.stringify(r.filter).includes(`,${String(KIND.gfill)}]`)); // the shapes' (a graphic's fills are the tests of function 29)
    expect(fills).toHaveLength(2);
    const hatched = fills.map((r) => r.style as FlatStyle).filter((style) => 'fill-pattern-src' in style);
    expect(hatched.map((style) => style['fill-pattern-src'])).toEqual(['data:hatch']);
    expect(hatched[0]?.['fill-color']).toEqual(['get', P.fill]);
    // The filters tell the two apart, so an area is filled once.
    // And only a fill that can be seen is drawn (`P.fillOn`, T-195).
    expect(fills.map((r) => JSON.stringify(r.filter))).toEqual([
      JSON.stringify(['all', ['==', ['get', P.kind], KIND.polygon], ['==', ['get', P.fillOn], 1], ['==', ['get', P.hatch], 0]]),
      JSON.stringify(['all', ['==', ['get', P.kind], KIND.polygon], ['==', ['get', P.fillOn], 1], ['==', ['get', P.hatch], 1]]),
    ]);
  });

  it('T-195: one stroke rule for the shapes and one for the relation lines and speed vectors, whatever their dash: a rule is a pass over every vertex of the layer', () => {
    const rules = layerStyle({ atlas: null, arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
    const strokes = rules.filter((r) => 'stroke-color' in r.style && !JSON.stringify(r.filter).includes(`,${String(KIND.gline)}]`));
    expect(strokes.map((r) => JSON.stringify(r.filter))).toEqual([
      JSON.stringify(['any', ['==', ['get', P.kind], KIND.line], ['==', ['get', P.kind], KIND.polygon]]),
      JSON.stringify(['==', ['get', P.kind], KIND.aux]),
    ]);
    const width = ['clamp', ['get', P.strokeWidth], 1, 50];
    const dash = ['get', P.dash];
    for (const rule of strokes) {
      // A solid line (0) has one dash too long to end and no gap; a dashed one (1) four widths and three; a dotted one (2) one and two.
      expect((rule.style as FlatStyle)['stroke-line-dash']).toEqual([
        ['case', ['==', dash, 0], 100_000, ['==', dash, 1], ['*', width, 4], width],
        ['case', ['==', dash, 0], 0, ['==', dash, 1], ['*', width, 3], ['*', width, 2]],
      ]);
    }
  });

  it('T-195: a tactical graphic\'s fill is drawn only when its colour has some opacity', () => {
    const BOUNDARY = { standard: 'APP-6D' as const, sidc: '10032500001101000000' };
    const fill = (opacity: number): unknown => {
      const item = { id: uuid(70), layerId: L, kind: 'graphic' as const, symbol: BOUNDARY, points: [[10, 58], [12, 60]] as [number, number][], parts: { ok: true as const, lines: [], labels: [], fills: [{ rings: [new Float64Array([10, 58, 12, 58, 12, 60])], color: '#ff0000', opacity }] } };
      return graphicFeatures(item, mercator, () => 1, new DashPatterns())[0]?.get(P.fillOn);
    };
    expect(fill(0)).toBe(0);
    expect(fill(0.4)).toBe(1);
  });

  it('T-195: a fill that cannot be seen is not drawn: fillOn is 1 only for a fill with some opacity, faded or not, for a polygon and its crossing fill alike', () => {
    const area = (extra: Record<string, unknown>) => item(object(60, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 58], [14, 58], [14, 61], [10, 61], [10, 58]]] }, { style: extra }));
    const fillOn = (it: ReturnType<typeof item>): unknown => toFeature(it, context(mercator))?.get(P.fillOn);
    expect(fillOn(area({ strokeColor: '#ff0000', fillOpacity: 0 }))).toBe(0); // gmti's dwell areas: an outline, no fill
    expect(fillOn(area({ strokeColor: '#ff0000', fillColor: '#00ff00', fillOpacity: 0, fillPattern: 'hatch' }))).toBe(0);
    expect(fillOn(area({ strokeColor: '#ff0000', fillOpacity: 0.3 }))).toBe(1);
    expect(fillOn(area({ strokeColor: '#ff0000' }))).toBe(1); // the default fill
    expect(fillOn({ ...area({ fillOpacity: 0.3 }), faded: true })).toBe(1);
    expect(fillOn({ ...area({ fillOpacity: 0.3 }), opacity: 0.2 })).toBe(1);
    const bow = item(object(61, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 58], [14, 61], [14, 58], [10, 61], [10, 58]]] }, { style: { fillOpacity: 0.4 } }));
    expect(fillOn(bow)).toBe(0); // its own feature has no fill: the faces are a feature of their own
    expect(fillFeatures(bow, context(mercator))[0]?.get(P.fillOn)).toBe(1);
    const bowNone = item(object(62, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 58], [14, 61], [14, 58], [10, 61], [10, 58]]] }, { style: { fillOpacity: 0 } }));
    expect(fillFeatures(bowNone, context(mercator))[0]?.get(P.fillOn)).toBe(0);
  });
});

describe('hatched fills (data model 1.1.0, owner 2026-10-16: 45° lines fixed on screen)', () => {
  it('criterion 35: marks a polygon or circle with fillPattern hatch, and nothing else', () => {
    const ctx = context(mercator);
    const area = (style: Record<string, unknown>) => toFeature(item(object(20, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 60], [12, 60], [12, 61], [10, 60]]] }, { style })), ctx);
    expect(area({ fillColor: '#ff0000', fillPattern: 'hatch' })?.get(P.hatch)).toBe(1);
    expect(area({ fillColor: '#ff0000', fillPattern: 'solid' })?.get(P.hatch)).toBe(0);
    expect(area({ fillColor: '#ff0000' })?.get(P.hatch)).toBe(0); // a 1.0.0 shape looks as before
    const circle = toFeature(item(object(21, L, 'core.shape', { type: 'Circle', center: [15, 60], radius: 5000 }, { style: { fillPattern: 'hatch' } })), ctx);
    expect(circle?.get(P.hatch)).toBe(1);
    const line = toFeature(item(object(22, L, 'core.shape', { type: 'LineString', coordinates: [[10, 60], [12, 61]] }, { style: { fillPattern: 'hatch' } })), ctx);
    expect(line?.get(P.hatch)).toBe(0);
  });

  it('draws white 45° lines on a transparent tile that repeats without seams', () => {
    const calls: [string, number, number][] = [];
    const fake = {
      width: 0, height: 0,
      getContext: () => ({
        set strokeStyle(v: string) { calls.push(['style:' + v, 0, 0]); },
        set lineWidth(v: number) { calls.push(['width', v, 0]); },
        beginPath() {}, stroke() { calls.push(['stroke', 0, 0]); },
        moveTo(x: number, y: number) { calls.push(['move', x, y]); },
        lineTo(x: number, y: number) { calls.push(['line', x, y]); },
      }),
    } as unknown as HTMLCanvasElement;
    const canvas = hatchImage(() => fake);
    expect([canvas.width, canvas.height]).toEqual([HATCH_TILE, HATCH_TILE]);
    expect(calls[0]).toEqual(['style:#ffffff', 0, 0]);
    expect(calls[1]).toEqual(['width', HATCH_LINE_WIDTH, 0]);
    // Each segment rises at 45°: x grows by the tile size while y falls by it.
    const segments = calls.filter(([c]) => c === 'move' || c === 'line');
    for (let i = 0; i < segments.length; i += 2) {
      const [, x0, y0] = segments[i] ?? ['', 0, 0];
      const [, x1, y1] = segments[i + 1] ?? ['', 0, 0];
      expect([x1 - x0, y0 - y1]).toEqual([HATCH_TILE, HATCH_TILE]);
    }
    // The middle line and the two corner pieces that continue the neighbouring tiles' lines.
    expect(segments.filter(([c]) => c === 'move').map(([, x]) => x)).toEqual([-HATCH_TILE, 0, HATCH_TILE]);
  });
});

describe('atlas packing', () => {
  it('places images in rows and starts a new row when one is full', () => {
    const packer = new ShelfPacker(100, 100);
    expect(packer.place(40, 30)).toEqual({ x: 0, y: 0 });
    expect(packer.place(40, 20)).toEqual({ x: 41, y: 0 });
    expect(packer.place(40, 10)).toEqual({ x: 0, y: 31 });
    expect(packer.height).toBe(42);
  });

  it('refuses what does not fit', () => {
    const packer = new ShelfPacker(100, 50);
    expect(packer.place(200, 10)).toBeNull();
    expect(packer.place(90, 45)).not.toBeNull();
    expect(packer.place(90, 45)).toBeNull();
  });
});

describe('engine without WebGL', () => {
  it('criterion 13: shows that the map cannot be drawn, and draws nothing', () => {
    const engine = new NullEngine(mercator);
    const element = document.createElement('div');
    const unmount = engine.mount(element);
    expect(element.textContent).toBe('This browser cannot draw the map: WebGL is not available.');
    expect(engine.view).toBeNull();
    expect(engine.pickCandidates()).toEqual([]);
    unmount();
    expect(element.textContent).toBe('');
  });
});

describe('highlight styles (owner, 2026-10-09)', () => {
  const box = { w: 30, h: 20, ax: 15, ay: 10 };

  it('criterion 15: frames a symbol image from its size and anchor, with a gap', () => {
    expect(frameRect(100, 50, box, 1, 3)).toEqual([82, 37, 36, 26]);
    expect(frameRect(200, 100, box, 2, 3)).toEqual([164, 74, 72, 52]); // a high-DPI canvas
  });

  it('draws the frame of a selected symbol in two tones around its image', () => {
    const [style] = highlightStyles(item(symbolObject(10, L, 15, 60)), box);
    const rects: number[][] = [];
    const ctx = { save: () => undefined, restore: () => undefined, strokeRect: (...r: number[]) => rects.push(r), strokeStyle: '', lineWidth: 0 };
    const renderer = style?.getRenderer();
    expect(renderer).toBeTypeOf('function');
    renderer?.([100, 50], { context: ctx, pixelRatio: 1 } as unknown as Parameters<NonNullable<typeof renderer>>[1]);
    expect(rects).toEqual([[82, 37, 36, 26], [82, 37, 36, 26]]);
  });

  it('gives a symbol without an image, a point and a marker a halo, and fills nothing', () => {
    for (const o of [
      symbolObject(10, L, 15, 60),
      object(11, L, 'core.shape', { type: 'Point', coordinates: [15, 60] }),
      object(12, L, 'cot.track', { type: 'Point', coordinates: [15, 60] }),
    ]) {
      const styles = highlightStyles(item(o), null);
      expect(styles).toHaveLength(2);
      for (const s of styles) {
        expect(s.getImage()).not.toBeNull();
        expect(s.getFill()).toBeNull();
      }
    }
  });

  it('criterion 15: puts a wide contrasting casing under a line or an outline, its own stroke on top, and no fill', () => {
    const line = object(13, L, 'core.shape', { type: 'LineString', coordinates: [[10, 60], [12, 61]] }, { style: { strokeColor: '#ff0000', strokeWidth: 2 } });
    const area = object(14, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 60], [12, 60], [12, 61], [10, 60]]] }, { style: { strokeColor: '#00ff00', fillColor: '#00ff00' } });
    for (const o of [line, area]) {
      const styles = highlightStyles(item(o), null);
      expect(styles.map((s) => s.getStroke()?.getWidth())).toEqual([10, 8, 2]);
      expect(styles.every((s) => s.getFill() === null)).toBe(true);
    }
  });
});

describe('faded items (brief function 13)', () => {
  it('criterion 23: a faded item carries 40 % opacity for WebGL, its shape colours too', () => {
    const line = item(object(13, L, 'core.shape', { type: 'LineString', coordinates: [[10, 60], [12, 61]] }, { style: { strokeColor: '#ff0000' } }));
    const normal = toFeature(line, context(mercator));
    const fadedFeature = toFeature({ ...line, faded: true }, context(mercator));
    expect(normal?.get(P.opacity)).toBe(1);
    expect(fadedFeature?.get(P.opacity)).toBe(0.4);
    expect(fadedFeature?.get(P.stroke)).toEqual([255, 0, 0, 0.4]);
  });

  it('criterion 107: an item with an opacity of its own is drawn at it, its shape colours too, and the opacity wins over faded', () => {
    const line = item(object(13, L, 'core.shape', { type: 'LineString', coordinates: [[10, 60], [12, 61]] }, { style: { strokeColor: '#ff0000' } }));
    const stepped = toFeature({ ...line, opacity: 0.45 }, context(mercator));
    expect(stepped?.get(P.opacity)).toBe(0.45);
    expect(stepped?.get(P.stroke)).toEqual([255, 0, 0, 0.45]);
    expect(toFeature({ ...line, opacity: 0.2, faded: true }, context(mercator))?.get(P.opacity)).toBe(0.2);
  });

  it('criterion 23: the WebGL rules take the opacity for images, arrows and the fixed marker colours', () => {
    const rules = layerStyle({ atlas: 'data:atlas', arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
    const values = rules.flatMap((r) => Object.entries(r.style).map(([k, v]) => [k, JSON.stringify(v)] as const));
    expect(values.filter(([k]) => k === 'icon-opacity').map(([, v]) => v)).toEqual([JSON.stringify(['get', P.opacity]), JSON.stringify(['get', P.opacity])]);
    expect(values.filter(([k]) => k === 'circle-fill-color' || k === 'circle-stroke-color').some(([, v]) => v.includes(`["get","${P.opacity}"]`))).toBe(true);
  });

  it('draws the direction arrow under the symbol: its rule comes before the symbol rules, with and without an atlas (T-138)', () => {
    for (const atlas of ['data:atlas', null]) {
      const rules = layerStyle({ atlas, arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
      const indexOf = (key: string) => rules.findIndex((r) => key in r.style);
      const arrow = indexOf('icon-rotation');
      const fallback = rules.findIndex((r) => 'circle-radius' in r.style && JSON.stringify(r.filter).includes(String(KIND.fallback)) && JSON.stringify(r.filter).includes('"any"'));
      expect(arrow).toBeGreaterThanOrEqual(0);
      expect(fallback).toBeGreaterThanOrEqual(0);
      expect(arrow, 'before the fallback marker').toBeLessThan(fallback);
      if (atlas !== null) expect(arrow, 'before the symbol image').toBeLessThan(indexOf('icon-offset'));
    }
  });

  it('draws a faded symbol, its arrow and its highlight at 40 % on the Canvas', () => {
    const moving = item(symbolObject(10, L, 15, 60, { ...INFANTRY, modifiers: { direction: 90 } }));
    const image = { image: document.createElement('canvas'), width: 30, height: 32, anchor: [15, 16] as const };
    const styles = canvasStyles({ ...moving, faded: true }, image, { canvas: document.createElement('canvas'), anchor: [6, 45] }, 0);
    expect(styles.map((st) => st.getImage()?.getOpacity())).toEqual([0.4, 0.4]);
    expect((styles[0]?.getImage() as Icon).getAnchor()).toEqual([6, 45]); // the arrow first, under the symbol (T-138)
    expect((styles[1]?.getImage() as Icon).getAnchor()).toEqual([15, 16]);
    const halo = highlightStyles({ ...item(object(11, L, 'core.shape', { type: 'Point', coordinates: [15, 60] })), faded: true }, null);
    expect((halo[1]?.getImage() as CircleStyle | null)?.getStroke()?.getColor()).toBe('rgba(255, 212, 0, 0.4)');
  });
});

describe('items outside the projection (owner, 2026-10-12)', () => {
  it('criterion 4 and 10 (owner, 2026-10-12): makes no feature for an item entirely outside the world extent, so it is neither drawn nor pickable', () => {
    const south = registerProjections(DEFAULT_SETTINGS.projections).projections.find((p) => p.def.code === 'EPSG:3031') as Projection;
    const band = item(object(30, L, 'core.shape', { type: 'Polygon', coordinates: [[[-180, 70], [0, 70], [180, 70], [180, 75], [0, 75], [-180, 75], [-180, 70]]] }, { style: { fillColor: '#00c8ff' } }));
    expect(toFeature(band, context(south))).toBeNull();
    expect(toFeature(band, context(polar))).not.toBeNull();
  });
});

describe('textOnly: the text of a symbol without the symbol (brief function 13, T-087)', () => {
  it('draws the image with text, then cuts the plain symbol out of it, aligned at the anchors', () => {
    const draws: { image: unknown; x: number; y: number; op: string }[] = [];
    const ctx = {
      globalCompositeOperation: 'source-over',
      drawImage(image: unknown, x: number, y: number) {
        draws.push({ image, x, y, op: this.globalCompositeOperation });
      },
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const withText = { image: 'with text' as unknown as HTMLCanvasElement, width: 120, height: 50, anchor: [70, 30] as const };
    const plain = { image: 'plain' as unknown as HTMLCanvasElement, width: 40, height: 30, anchor: [20, 15] as const };
    const result = textOnly(() => canvas, withText, plain);
    expect(draws).toEqual([
      { image: 'with text', x: 0, y: 0, op: 'source-over' },
      { image: 'plain', x: 50, y: 15, op: 'destination-out' },
    ]);
    expect(result).toEqual({ image: canvas, width: 120, height: 50, anchor: [70, 30] });
    expect([canvas.width, canvas.height]).toEqual([120, 50]);
  });

  it('keeps the image with text where there is no 2D context', () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    const withText = { image: 'with text' as unknown as HTMLCanvasElement, width: 120, height: 50, anchor: [70, 30] as const };
    const plain = { image: 'plain' as unknown as HTMLCanvasElement, width: 40, height: 30, anchor: [20, 15] as const };
    expect(textOnly(() => canvas, withText, plain)).toBe(withText);
  });
});

describe('arrowheads and route markers (data model 1.1.0, brief function 18; owner 2026-10-16: sizes follow the line width)', () => {
  const line = (n: number, coordinates: Position[], style: Record<string, unknown>) => item(object(n, L, 'core.shape', { type: 'LineString', coordinates }, { style }));

  it('criterion 35: puts the arrowhead on the last point, turned along the last segment as drawn', () => {
    const ctx = context(mercator);
    const east = extraFeatures(line(30, [[15, 60], [15.5, 60]], { arrowhead: 'end', strokeWidth: 5 }), ctx);
    expect(east).toHaveLength(1);
    expect(east[0]?.getId()).toBe(`${uuid(30)}#arrow`);
    expect(east[0]?.get(P.kind)).toBe(KIND.arrowhead);
    expect(east[0]?.get(P.rotation)).toBeCloseTo(Math.PI / 2, 9); // pointing right
    expect((east[0]?.getGeometry() as Point).getCoordinates()).toEqual([...(mercator.forward([15.5, 60]) ?? [])]);
    const north = extraFeatures(line(31, [[15, 60], [15, 60.5]], { arrowhead: 'end' }), ctx);
    expect(north[0]?.get(P.rotation)).toBeCloseTo(0, 9); // pointing up
    const southWest = extraFeatures(line(32, [[15, 60], [14.5, 59.5]], { arrowhead: 'end' }), ctx);
    expect(southWest[0]?.get(P.rotation)).toBeLessThan(-Math.PI / 2); // down and to the left
    // A line ending with a repeated point: along the last segment that has a length (review remark 2).
    const repeated = extraFeatures(line(38, [[15, 60], [15.5, 60], [15.5, 60]], { arrowhead: 'end' }), ctx);
    expect(repeated[0]?.get(P.rotation)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('criterion 35: scales arrowheads and markers with the line width, with their minimums', () => {
    expect(arrowheadLength(5)).toBe(20);
    expect(arrowheadLength(1)).toBe(12);
    expect(markerRadius(4)).toBe(6);
    expect(markerRadius(1)).toBe(4);
    const [arrow] = extraFeatures(line(33, [[15, 60], [15.5, 60]], { arrowhead: 'end', strokeWidth: 5 }), context(mercator));
    expect(arrow?.get(P.scale)).toBeCloseTo(20 / 48, 9);
  });

  it("criterion 35: puts route markers on the line's own points, not on the points added for its geodesic edges", () => {
    const route = line(34, [[10, 60], [40, 65], [42, 62]], { pointMarkers: 'circle', strokeColor: '#00ff00', strokeWidth: 3 });
    expect(route.kind === 'line' ? route.positions.length : 0).toBeGreaterThan(10);
    const [markers] = extraFeatures(route, context(polar));
    expect(markers?.getId()).toBe(`${uuid(34)}#markers`);
    const points = (markers?.getGeometry() as MultiPoint).getCoordinates();
    expect(points).toHaveLength(3);
    expect(points[1]?.[0]).toBeCloseTo(polar.forward([40, 65])?.[0] ?? NaN, 6);
    expect(markers?.get(P.radius)).toBe(5);
    // Data model 1.1.0: a small filled circle in strokeColor, no outline.
    expect(markers?.get(P.fill)).toEqual([0, 255, 0, 1]);
    expect(markers?.get(P.strokeWidth)).toBe(0);
  });

  it('criterion 35: fades them with the line, and gives 1.0.0 lines and areas none', () => {
    const faded = { ...line(35, [[15, 60], [15.5, 60]], { arrowhead: 'end', pointMarkers: 'circle', strokeColor: '#ff0000' }), faded: true };
    const extras = extraFeatures(faded, context(mercator));
    expect(extras.map((f) => f.get(P.stroke) as unknown)).toEqual([[255, 0, 0, 0.4], [255, 0, 0, 0.4]]);
    expect(extraFeatures(line(36, [[15, 60], [15.5, 60]], { strokeColor: '#ff0000' }), context(mercator))).toEqual([]);
    const area = item(object(37, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 60], [12, 60], [12, 61], [10, 60]]] }, { style: { arrowhead: 'end', pointMarkers: 'circle' } }));
    expect(extraFeatures(area, context(mercator))).toEqual([]);
  });

  it('criterion 35: the style draws the arrowhead tinted with the line colour and the markers from their properties', () => {
    const rules = layerStyle({ atlas: null, arrow: 'data:arrow', arrowAnchor: [6, 45], hatch: 'data:hatch', arrowhead: 'data:arrowhead' });
    const arrow = rules.find((r) => JSON.stringify(r.filter) === JSON.stringify(['==', ['get', P.kind], KIND.arrowhead]))?.style as FlatStyle;
    expect(arrow['icon-src']).toBe('data:arrowhead');
    expect(arrow['icon-color']).toEqual(['get', P.stroke]);
    // The same scale on both axes, spelled out (a bare ['get', …] draws a stretched image in OpenLayers 10.10).
    expect(arrow['icon-scale']).toEqual(['array', ['get', P.scale], ['get', P.scale]]);
    const markers = rules.find((r) => JSON.stringify(r.filter) === JSON.stringify(['==', ['get', P.kind], KIND.markers]))?.style as FlatStyle;
    expect(markers['circle-radius']).toEqual(['get', P.radius]);
  });
});

describe('the selection highlight for shapes (brief functions 10 and 18)', () => {
  it('criterion 36: a selected circle, ellipse, polygon and line get a stroke wider than their own, under it', () => {
    const shapes = [
      object(40, L, 'core.shape', { type: 'Circle', center: [15, 60], radius: 5_000 }, { style: { strokeWidth: 3 } }),
      object(41, L, 'core.shape', { type: 'Ellipse', center: [16, 61], semiMajorAxis: 8_000, semiMinorAxis: 3_000, rotation: 40 }, { style: { strokeWidth: 3 } }),
      object(42, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 60], [12, 60], [12, 61], [10, 60]]] }, { style: { strokeWidth: 3, fillPattern: 'hatch' } }),
      object(43, L, 'core.shape', { type: 'LineString', coordinates: [[10, 60], [12, 61]] }, { style: { strokeWidth: 3, arrowhead: 'end', pointMarkers: 'circle' } }),
    ];
    for (const shape of shapes) {
      const drawn = item(shape);
      expect(['polygon', 'line']).toContain(drawn.kind);
      const widths = highlightStyles(drawn, null).map((style) => style.getStroke()?.getWidth() ?? 0);
      // The casing and the highlight colour wider than the shape's own stroke, which is drawn again on top.
      expect(widths[0]).toBeGreaterThan(3);
      expect(widths[1]).toBeGreaterThan(3);
      expect(widths[widths.length - 1]).toBe(3);
    }
  });
});

describe('the 1.1.0 styles on the Canvas: overlays and the drag preview (brief function 18)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const arrowheadCanvas = document.createElement('canvas');
  const line = (n: number, coordinates: Position[], style: Record<string, unknown>) => item(object(n, L, 'core.shape', { type: 'LineString', coordinates }, { style }));

  it('criterion 35: draws the arrowhead at the last point, turned along the last segment and tinted, and markers on the own points', () => {
    const route = line(50, [[15, 60], [15.5, 60], [16, 60]], { strokeColor: '#0000ff', strokeWidth: 5, arrowhead: 'end', pointMarkers: 'circle' });
    const [arrow, markers] = canvasLineExtras(route, mercator, arrowheadCanvas, 7);
    expect((arrow?.getGeometry() as Point).getCoordinates()).toEqual([...(mercator.forward([16, 60]) ?? [])]);
    const icon = arrow?.getImage() as Icon;
    expect(icon.getRotation()).toBeCloseTo(Math.PI / 2, 9);
    expect(icon.getScale()).toBeCloseTo(arrowheadLength(5) / 48, 9);
    expect(icon.getColor()).toEqual([0, 0, 255, 1]);
    expect(arrow?.getZIndex()).toBe(7);
    expect((markers?.getGeometry() as MultiPoint).getCoordinates()).toHaveLength(3);
    expect((markers?.getImage() as CircleStyle).getRadius()).toBe(markerRadius(5));
    expect((markers?.getImage() as CircleStyle).getFill()?.getColor()).toBe('rgba(0, 0, 255, 1)');
    expect((markers?.getImage() as CircleStyle).getStroke()).toBeNull();
    expect(canvasLineExtras(line(51, [[15, 60], [16, 60]], {}), mercator, arrowheadCanvas)).toEqual([]);
  });

  it('criterion 35: fills a hatched area with the hatch in its colour, and with the plain colour without a 2D context', () => {
    const area = (n: number, fillColor: string) => item(object(n, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 60], [12, 60], [12, 61], [10, 60]]] }, { style: { fillColor, fillOpacity: 0.5, fillPattern: 'hatch' } }));
    // jsdom has no 2D context: the plain colour.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(canvasStyles(area(52, '#123456'), null, null, 0)[0]?.getFill()?.getColor()).toBe('rgba(18, 52, 86, 0.5)');
    // With one: a pattern from the white tile with the colour drawn into its lines, once per colour.
    const pattern = { pattern: true } as unknown as CanvasPattern;
    const ops: string[] = [];
    const context = {
      set strokeStyle(_: string) {}, set lineWidth(_: number) {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      set globalCompositeOperation(v: string) { ops.push(v); }, set fillStyle(v: string) { ops.push(v); }, fillRect() {},
      createPattern: vi.fn(() => pattern),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    expect(canvasStyles(area(53, '#654321'), null, null, 0)[0]?.getFill()?.getColor()).toBe(pattern);
    expect(ops).toEqual(['source-in', 'rgba(101, 67, 33, 0.5)']);
    expect(hatchPattern('rgba(101, 67, 33, 0.5)')).toBe(pattern);
    expect(context.createPattern).toHaveBeenCalledTimes(1);
  });
});

describe('the preview while drawing (brief function 17)', () => {
  const arrowheadCanvas = document.createElement('canvas');

  it("criterion 32: shows the shape in the caller's style, a line with its arrowhead and markers, and a dot at the pointer", () => {
    const area = drawPreviewStyle('area', { strokeColor: '#C0392B', strokeWidth: 4, strokeDash: 'dash', fillColor: '#C0392B', fillOpacity: 0.5 }, arrowheadCanvas);
    const [outline] = area(new OlFeature(new OlPolygon([[[0, 0], [10, 0], [10, 10], [0, 0]]])));
    expect(outline?.getStroke()?.getColor()).toBe('rgba(192, 57, 43, 1)');
    expect(outline?.getStroke()?.getLineDash()).toEqual([16, 12]);
    expect(outline?.getFill()?.getColor()).toBe('rgba(192, 57, 43, 0.5)');
    const line = drawPreviewStyle('line', { strokeColor: '#1F3A93', arrowhead: 'end', pointMarkers: 'circle' }, arrowheadCanvas);
    const styles = line(new OlFeature(new OlLineString([[0, 0], [10, 0], [20, 5]])));
    expect(styles).toHaveLength(3); // the line, its arrowhead and its markers
    expect(line(new OlFeature(new OlPoint([20, 5])))).toHaveLength(1); // the dot at the pointer
  });
});

describe("a symbol's label at its place (CR-0043 part A; T-163)", () => {
  const look = { text: [26, 26, 26, 1], halo: [255, 255, 255, 1], font: 'sans-serif', dataFont: 'monospace' } as const;
  const reach = { left: 10, top: 14, right: 12, bottom: 16 };
  const at = (place: Parameters<typeof placedLabelStyle>[1]) => {
    const text = placedLabelStyle('Alpha', place, reach, 1, 3, look).getText();
    return { align: text?.getTextAlign(), baseline: text?.getTextBaseline(), x: text?.getOffsetX(), y: text?.getOffsetY(), text: text?.getText() };
  };

  it('puts each corner label beside the image, its edge on the image\'s top or bottom, the text growing away from the image', () => {
    expect(at('topLeft')).toMatchObject({ align: 'right', baseline: 'top', x: -(10 + LABEL_GAP), y: -14, text: 'Alpha' });
    expect(at('topRight')).toMatchObject({ align: 'left', baseline: 'top', x: 12 + LABEL_GAP, y: -14 });
    expect(at('bottomLeft')).toMatchObject({ align: 'right', baseline: 'bottom', x: -(10 + LABEL_GAP), y: 16 });
    expect(at('bottomRight')).toMatchObject({ align: 'left', baseline: 'bottom', x: 12 + LABEL_GAP, y: 16 });
  });

  it('puts the label below centred under the image', () => {
    expect(at('below')).toMatchObject({ align: 'center', baseline: 'top', x: 0, y: 16 + LABEL_GAP });
  });

  // RC1 (owner YC A): the selection frame of a symbol is its image plus a gap, drawn in a wide casing; it covered the first
  // characters of a label at a corner ("5 INF" showed as "INF", "36 km/h" as "6 km/h").
  it('keeps every label place clear of the selection frame, text halo included, at every symbol size and for wide or tall images', () => {
    const boxes = [SYMBOL_SIZE_MIN, 30, SYMBOL_SIZE_MAX].map((size) => ({ w: Math.round(1.6 * size), h: Math.round(1.3 * size), ax: Math.round(0.8 * size), ay: Math.round(0.65 * size) }))
      .concat([
        { w: 70, h: 80, ax: 35, ay: 56 }, // an echelon above the frame
        { w: 62, h: 74, ax: 12, ay: 70 }, // a headquarters staff: the anchor at the staff's foot, off the centre
      ]);
    const casing = (HIGHLIGHT.width + 2) / 2;
    const halo = LABEL_TEXT.haloWidth / 2;
    for (const box of boxes) {
      const reachOf = { left: box.ax, top: box.ay, right: box.w - box.ax, bottom: box.h - box.ay };
      const [left, top, width, height] = frameRect(0, 0, box, 1);
      const frame = { left: left - casing, top: top - casing, right: left + width + casing, bottom: top + height + casing };
      for (const place of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'below'] as const) {
        const text = placedLabelStyle('36 km/h', place, reachOf, 1, 3, look).getText();
        const x = text?.getOffsetX() ?? 0;
        const y = text?.getOffsetY() ?? 0;
        const label = `${place} at ${JSON.stringify(box)}`;
        if (place === 'topRight' || place === 'bottomRight') expect(x - halo, label).toBeGreaterThanOrEqual(frame.right);
        if (place === 'topLeft' || place === 'bottomLeft') expect(x + halo, label).toBeLessThanOrEqual(frame.left);
        if (place === 'below') expect(y - halo, label).toBeGreaterThanOrEqual(frame.bottom);
      }
    }
  });

  it('fades with its object', () => {
    const faded = placedLabelStyle('Alpha', 'below', reach, 0.4, 3, look).getText()?.getFill()?.getColor();
    expect(faded).toBe('rgba(26, 26, 26, 0.4)');
  });
});

