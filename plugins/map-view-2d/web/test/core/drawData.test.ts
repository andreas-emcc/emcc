import { describe, expect, it } from 'vitest';
import { TEXT_SIZE_DEFAULT, type MapObject } from '@emc2/plugin-sdk';
import { appearanceKey, directionOf, drawWithText, firstPosition, inProjection, movementOf, steppedSymbol, symbolRequest, toDrawItem, vesselHeading } from '../../src/core/drawData.ts';
import { registerProjections, type Projection } from '../../src/core/projections.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { INFANTRY, object, symbolObject, uuid } from '../fixtures.ts';

const L = uuid(1);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('draw data', () => {
  it('draws a core.symbol as a symbol at its position', () => {
    const item = toDrawItem(symbolObject(10, L, 15, 60));
    expect(item).toMatchObject({ kind: 'symbol', id: uuid(10), layerId: L, position: [15, 60], appearance: 'APP-6D|10031000001211000000' });
  });

  it('function 45: draws a core.text as its text at its point, with the size, rotation and colour it names, else the defaults', () => {
    const full = toDrawItem(object(7, L, 'core.text', { type: 'Point', coordinates: [15.2, 58.4] }, { text: { value: 'Alpha', rotation: 30, size: 20 }, style: { strokeColor: '#ff0000' } }));
    expect(full).toEqual({ id: uuid(7), layerId: L, kind: 'textobject', position: [15.2, 58.4], text: 'Alpha', size: 20, rotation: 30, color: '#ff0000' });
    const plain = toDrawItem(object(8, L, 'core.text', { type: 'Point', coordinates: [15.2, 58.4] }, { text: { value: 'a\nb' } }));
    expect(plain).toEqual({ id: uuid(8), layerId: L, kind: 'textobject', position: [15.2, 58.4], text: 'a\nb', size: TEXT_SIZE_DEFAULT, rotation: 0 }); // no colour: the look's
    // A text object without text or not on a point is a fallback marker, as any object that does not fit
    expect(toDrawItem(object(9, L, 'core.text', { type: 'Point', coordinates: [15.2, 58.4] }))?.kind).toBe('fallback');
    expect(toDrawItem(object(11, L, 'core.text', { type: 'Point', coordinates: [15.2, 58.4] }, { text: { value: '' } }))?.kind).toBe('fallback');
    expect(toDrawItem(object(10, L, 'core.text', { type: 'LineString', coordinates: [[15, 58], [16, 59]] }, { text: { value: 'x' } }))?.kind).toBe('fallback');
  });

  it('draws core.shape points, lines, polygons and circles with their style', () => {
    const style = { strokeColor: '#ff0000', strokeWidth: 3 };
    expect(toDrawItem(object(1, L, 'core.shape', { type: 'Point', coordinates: [15, 60] }, { style }))).toMatchObject({ kind: 'point', style });
    const line = toDrawItem(object(2, L, 'core.shape', { type: 'LineString', coordinates: [[10, 60], [30, 62]] }, { style }));
    expect(line?.kind).toBe('line');
    if (line?.kind === 'line') expect(line.positions.length).toBeGreaterThan(2); // densified
    const polygon = toDrawItem(object(3, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 60], [12, 60], [12, 61], [10, 60]]] }));
    expect(polygon?.kind).toBe('polygon');
    const circle = toDrawItem(object(4, L, 'core.shape', { type: 'Circle', center: [15, 60], radius: 1000 }));
    expect(circle?.kind).toBe('polygon');
    if (circle?.kind === 'polygon') expect(circle.rings[0]?.length).toBe(65);
  });

  it('criterion 10: draws a multipoint and an unknown type as a fallback marker at the first position', () => {
    const multipoint = object(5, L, 'core.multipoint', { type: 'MultiPoint', coordinates: [[15, 60], [16, 61]] });
    expect(toDrawItem(multipoint)).toEqual({ id: uuid(5), layerId: L, kind: 'fallback', position: [15, 60] });
    const pluginType = object(6, L, 'cot.track', { type: 'Point', coordinates: [18, 59] });
    expect(toDrawItem(pluginType)).toMatchObject({ kind: 'fallback', position: [18, 59] });
  });

  it('criterion 10: draws a symbol or shape that does not fit as a fallback marker', () => {
    const noSymbol = object(7, L, 'core.symbol', { type: 'Point', coordinates: [15, 60] });
    expect(toDrawItem(noSymbol)?.kind).toBe('fallback');
    const multiPoint = object(8, L, 'core.shape', { type: 'MultiPoint', coordinates: [[15, 60], [16, 61]] });
    expect(toDrawItem(multiPoint)).toMatchObject({ kind: 'fallback', position: [15, 60] });
  });

  it("criterion 35: carries a shape's name for its label, but not an empty one, and gives symbols none", () => {
    const named = toDrawItem(object(9, L, 'core.shape', { type: 'Polygon', coordinates: [[[10, 60], [12, 60], [12, 61], [10, 60]]] }, { properties: { name: 'Sector 7' } }));
    expect(named?.kind === 'polygon' ? named.name : null).toBe('Sector 7');
    const blank = toDrawItem(object(10, L, 'core.shape', { type: 'LineString', coordinates: [[10, 60], [12, 61]] }, { properties: { name: '   ' } }));
    expect(blank !== null && 'name' in blank).toBe(false);
    const symbol = toDrawItem(symbolObject(11, L, 15, 60));
    expect(symbol !== null && 'name' in symbol).toBe(false);
    const point = toDrawItem(object(12, L, 'core.shape', { type: 'Point', coordinates: [15, 60] }, { properties: { name: 'Spot' } }));
    expect(point !== null && 'name' in point).toBe(false); // only areas and lines are labelled
  });

  it('criterion 35: draws an ellipse as an area with its style, no longer as a fallback marker', () => {
    const style = { strokeColor: '#ff0000', fillPattern: 'hatch' } as const;
    const ellipse = object(8, L, 'core.shape', { type: 'Ellipse', center: [15, 60], semiMajorAxis: 10_000, semiMinorAxis: 4_000, rotation: 30 }, { style });
    const item = toDrawItem(ellipse);
    expect(item?.kind).toBe('polygon');
    expect(item?.kind === 'polygon' ? item.style : undefined).toEqual(style);
    const ring = item?.kind === 'polygon' ? item.rings[0] : undefined;
    expect(ring?.length).toBeGreaterThan(32);
    expect(ring?.[0]).toEqual(ring?.[(ring.length) - 1]);
  });

  it('criterion 10: never changes the object, its extensions included', () => {
    const withExtensions: MapObject = deepFreeze({
      ...symbolObject(9, L, 15, 60),
      extensions: { cot: { uid: 'ABC', precise: 1.2345678901234567 }, other: { x: [1, 2] } },
    });
    const copy = structuredClone(withExtensions);
    expect(() => toDrawItem(withExtensions)).not.toThrow();
    expect(withExtensions).toEqual(copy);
  });

  it('finds the first position of every geometry type', () => {
    expect(firstPosition({ type: 'Corridor', coordinates: [[1, 2], [3, 4]], width: 10 })).toEqual([1, 2]);
    expect(firstPosition({ type: 'ArcBand', center: [5, 6], innerRadius: 0, outerRadius: 10, startBearing: 0, endBearing: 90 })).toEqual([5, 6]);
    expect(firstPosition({ type: 'MultiPoint', coordinates: [] })).toBeNull();
  });

  it('keys symbol images by appearance with the canonical SIDC (20 and 30 digits are one symbol)', () => {
    const short = { standard: 'APP-6E', sidc: '13031000001211000000' } as const;
    const long = { standard: 'APP-6E', sidc: '130310000012110000000000000000' } as const;
    expect(appearanceKey(long)).toBe(appearanceKey(short));
    expect(appearanceKey(INFANTRY)).not.toBe(appearanceKey(short));
  });

  it('keys the image by appearance only: one image per SIDC whatever the heading or text', () => {
    const a = appearanceKey({ ...INFANTRY, modifiers: { direction: 44.6, uniqueDesignation: 'A' } });
    const b = appearanceKey({ ...INFANTRY, modifiers: { direction: 270, uniqueDesignation: 'B' } });
    expect(a).toBe(b);
    expect(a).toBe(appearanceKey(INFANTRY));
  });

  it('gives the direction of movement for the separate arrow, normalized to [0, 360)', () => {
    const item = toDrawItem({ ...symbolObject(12, L, 15, 60), symbol: { ...INFANTRY, modifiers: { direction: -10 } } });
    expect(item).toMatchObject({ kind: 'symbol', direction: 350 });
    expect(toDrawItem(symbolObject(13, L, 15, 60))).toMatchObject({ kind: 'symbol', direction: null });
    expect(directionOf({ ...INFANTRY, modifiers: { direction: 725.5 } })).toBe(5.5);
  });

  it('never asks the SymbolService for the direction; text modifiers only when drawing with text', () => {
    const symbol = { ...INFANTRY, modifiers: { direction: 90, uniqueDesignation: 'A' } };
    expect(symbolRequest(symbol, 30, false)).toEqual({ standard: 'APP-6D', sidc: INFANTRY.sidc, size: 30, withText: false });
    expect(symbolRequest(symbol, 30, true).modifiers).toEqual({ uniqueDesignation: 'A' });
    expect(symbolRequest({ ...INFANTRY, modifiers: { direction: 90 } }, 30, true)).not.toHaveProperty('modifiers');
  });

  it("vessels (brief function 33): the hull is part of the image, the arrow is not the map view's, and the request carries direction and speed", () => {
    const ship = (modifiers?: { direction?: number; speed?: number; uniqueDesignation?: string }) => ({ standard: 'vessel' as const, sidc: '0470', ...(modifiers === undefined ? {} : { modifiers }) });
    expect(vesselHeading(ship({ direction: 359.6 }))).toBe(0); // the nearest step of 10 degrees (T-200)
    expect(vesselHeading(ship({ direction: -10 }))).toBe(350);
    expect(vesselHeading(ship({ direction: 90, speed: 0 }))).toBeNull();
    expect(vesselHeading(ship({ direction: 90, speed: 3 }))).toBe(90);
    expect(vesselHeading(ship({ speed: 3 }))).toBeNull();
    expect(vesselHeading(ship())).toBeNull();
    expect(appearanceKey(ship({ direction: 90 }))).not.toBe(appearanceKey(ship({ direction: 100 })));
    expect(appearanceKey(ship({ direction: 90 }))).toBe(appearanceKey(ship({ direction: 94, uniqueDesignation: 'A' }))); // the same step
    expect(appearanceKey(ship({ direction: 90, speed: 0 }))).toBe(appearanceKey(ship()));
    expect(appearanceKey(ship())).not.toBe(appearanceKey({ standard: 'vessel', sidc: '0670' }));
    expect(directionOf(ship({ direction: 90 }))).toBeNull(); // no arrow of the map view's own
    expect(symbolRequest(ship({ direction: 90, speed: 4, uniqueDesignation: 'A' }), 30, false)).toEqual({ standard: 'vessel', sidc: '0470', size: 30, withText: false, modifiers: { direction: 90, speed: 4 } });
    expect(symbolRequest(ship({ direction: 90, uniqueDesignation: 'A' }), 30, true).modifiers).toEqual({ direction: 90, uniqueDesignation: 'A' });
    expect(symbolRequest(ship({ uniqueDesignation: 'A' }), 30, false)).not.toHaveProperty('modifiers');
    expect(toDrawItem({ ...symbolObject(14, L, 15, 60), symbol: ship({ direction: 90 }) })).toMatchObject({ kind: 'symbol', direction: null });
  });

  it('criterion 108 (T-200): a vessel\'s hull is in steps of 10 degrees, the nearest, a half step up; key and request agree, with text too; the object keeps its direction', () => {
    const ship = (direction: number, extra: { speed?: number; uniqueDesignation?: string } = {}) => ({ standard: 'vessel' as const, sidc: '0470', modifiers: { direction, ...extra } });
    const hull = (direction: number) => vesselHeading(ship(direction));
    expect([34, 35, 36, 356, 355, 354, 0, 4, 5, 360, 725].map(hull)).toEqual([30, 40, 40, 0, 0, 350, 0, 0, 10, 0, 10]);
    expect([-4, -5, -6, -15].map(hull)).toEqual([0, 0, 350, 350]); // -5 is 355; -15 is 345, which is 350 and not 340
    expect(appearanceKey(ship(34))).toBe('vessel|0470|hull 30');
    expect(appearanceKey(ship(35))).toBe(appearanceKey(ship(36)));
    expect(appearanceKey(ship(356))).toBe(appearanceKey(ship(0)));
    for (const withText of [false, true]) {
      expect(symbolRequest(ship(34, { speed: 5 }), 30, withText).modifiers).toMatchObject({ direction: 30, speed: 5 });
      expect(symbolRequest(ship(35, { speed: 5 }), 30, withText).modifiers).toMatchObject({ direction: 40 });
      expect(symbolRequest(ship(356), 30, withText).modifiers).toMatchObject({ direction: 0 });
    }
    expect(symbolRequest(ship(34, { uniqueDesignation: 'A' }), 30, true).modifiers).toEqual({ direction: 30, uniqueDesignation: 'A' }); // the text goes with the stepped hull
    // A mark (speed 0) is not turned: the request is as it was, and the key is the mark's.
    expect(symbolRequest(ship(34, { speed: 0 }), 30, false).modifiers).toEqual({ direction: 34, speed: 0 });
    expect(appearanceKey(ship(34, { speed: 0 }))).toBe('vessel|0470|mark');
    // The object keeps its exact direction: the symbol given is not changed, and the draw item carries the symbol as it is.
    const symbol = ship(34, { speed: 5 });
    expect(steppedSymbol(symbol).modifiers?.direction).toBe(30);
    expect(symbol.modifiers.direction).toBe(34);
    const exact = ship(30);
    expect(steppedSymbol(exact)).toBe(exact); // already at a step: the same symbol
    const item = toDrawItem({ ...symbolObject(14, L, 15, 60), symbol });
    expect(item).toMatchObject({ kind: 'symbol', symbol: { modifiers: { direction: 34 } } });
    expect(movementOf(symbol)).toBe(34);
    // Only a vessel is stepped.
    const land = { standard: 'APP-6D' as const, sidc: '10031000001211000000', modifiers: { direction: 34 } };
    expect(steppedSymbol(land)).toBe(land);
  });

  it('draws text up to the threshold of visible symbols (brief function 6)', () => {
    expect(drawWithText(2000, 2000)).toBe(true);
    expect(drawWithText(2001, 2000)).toBe(false);
  });
});

describe('items outside the projection (owner, 2026-10-12)', () => {
  const { projections } = registerProjections(DEFAULT_SETTINGS.projections);
  const byCode = (code: string) => projections.find((p) => p.def.code === code) as Projection;
  const drawn = (o: Parameters<typeof toDrawItem>[0]) => {
    const item = toDrawItem(o);
    if (item === null) throw new Error('no draw item');
    return item;
  };

  it('criterion 4 and 10 (owner, 2026-10-12): an item with no position in the world extent is not on that map; one with a position inside is', () => {
    const aroundNorthPole = drawn(object(20, L, 'core.shape', { type: 'Polygon', coordinates: [[[-180, 70], [-90, 70], [0, 70], [90, 70], [180, 70], [-180, 70]]] }));
    const northCircle = drawn(object(21, L, 'core.shape', { type: 'Circle', center: [0, 90], radius: 500_000 }));
    const symbol = drawn(symbolObject(22, L, 15, 60));
    const across = drawn(object(23, L, 'core.shape', { type: 'LineString', coordinates: [[15, 60], [15, -60]] }));
    const antarctic = byCode('EPSG:3031');
    expect([aroundNorthPole, northCircle, symbol].map((i) => inProjection(i, antarctic))).toEqual([false, false, false]);
    expect(inProjection(across, antarctic)).toBe(true); // partly inside: drawn whole
    expect([aroundNorthPole, northCircle, symbol].map((i) => inProjection(i, byCode('EPSG:3413')))).toEqual([true, true, true]);
  });

  it('criterion 10 (owner, 2026-10-12): a fallback marker and a line entirely outside are not on that map either; beyond the Mercator edge neither', () => {
    const arcticTrack = drawn(object(24, L, 'cot.track', { type: 'Point', coordinates: [20, 75] }));
    const arcticLine = drawn(object(25, L, 'core.shape', { type: 'LineString', coordinates: [[0, 70], [30, 75]] }));
    expect([arcticTrack, arcticLine].map((i) => inProjection(i, byCode('EPSG:3031')))).toEqual([false, false]);
    expect(inProjection(drawn(symbolObject(26, L, 15, 88)), byCode('EPSG:3857'))).toBe(false); // beyond 85.05° N
    expect(inProjection(drawn(symbolObject(27, L, 15, 85)), byCode('EPSG:3857'))).toBe(true);
  });
});
