// The pure parts: kinds, styles, change request content, geometry checks and settings.
import { describe, expect, it } from 'vitest';
import type { Geometry, MapObject, MapObjectContent } from '@emc2/plugin-sdk';
import manifest from '../../plugin.json' with { type: 'json' };
import {
  cleanGeometry, coreOf, kindLabelOf, kindOf, newShapeContent, normalizeText, validPosition, withDataType, withGeometry, withLayer, withName, withStyle,
} from '../src/content.ts';
import { drawKindOf, geometryTypeOf, isReshapable, SHAPE_KINDS, withArticle } from '../src/kinds.ts';
import { readSettings } from '../src/settings.ts';
import { applyChoice, choiceOf, DEFAULT_STYLE, readStyleSettings, styleFor } from '../src/style.ts';
import type { StyleChoice } from '../src/style.ts';
import { LABEL, shapeObject } from './fakeServer.ts';

const LAYER = '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01';
const CHOICE: StyleChoice = { ...DEFAULT_STYLE, outlineColor: '#aa3300', outlineWidth: 3, outlineDash: 'dash', fillColor: '#00aa33', fillOpacity: 0.4 };

describe('kinds', () => {
  it('maps every kind to the drawing service and to the geometry it returns', () => {
    expect(SHAPE_KINDS.map((k) => [k, drawKindOf(k), geometryTypeOf(k)])).toEqual([
      ['circle', 'circle', 'Circle'],
      ['ellipse', 'ellipse', 'Ellipse'],
      ['square', 'square', 'Polygon'],
      ['rectangle', 'rectangle', 'Polygon'],
      ['polygon', 'polygon', 'Polygon'],
      ['arrow', 'line', 'LineString'],
      ['route', 'line', 'LineString'],
    ]);
  });

  it('reshapes circles, ellipses, polygons and lines, and nothing else', () => {
    const geometries: Geometry[] = [
      { type: 'Circle', center: [18, 59], radius: 10 },
      { type: 'Ellipse', center: [18, 59], semiMajorAxis: 10, semiMinorAxis: 5, rotation: 0 },
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    ];
    expect(geometries.every(isReshapable)).toBe(true);
    expect(isReshapable({ type: 'Corridor', coordinates: [[0, 0], [1, 1]], width: 100 })).toBe(false);
    expect(isReshapable({ type: 'ArcBand', center: [0, 0], innerRadius: 0, outerRadius: 10, startBearing: 0, endBearing: 90 })).toBe(false);
    expect(isReshapable({ type: 'Point', coordinates: [0, 0] })).toBe(false);
  });
});

describe('wording', () => {
  it('puts the right article before a kind', () => {
    expect([withArticle('circle'), withArticle('ellipse'), withArticle('area'), withArticle('Ellipse'), withArticle('rectangle')]).toEqual([
      'a circle', 'an ellipse', 'an area', 'an Ellipse', 'a rectangle',
    ]);
  });
});

describe('style', () => {
  it('a new shape without a fill has an outline only', () => {
    expect(styleFor(CHOICE, 'rectangle')).toEqual({ strokeColor: '#aa3300', strokeWidth: 3, strokeDash: 'dash' });
  });

  it('a transparent fill has a colour and an opacity, a hatched fill also the hatch pattern (data model 1.1.0)', () => {
    expect(styleFor({ ...CHOICE, fill: 'transparent' }, 'circle')).toEqual({
      strokeColor: '#aa3300', strokeWidth: 3, strokeDash: 'dash', fillColor: '#00aa33', fillOpacity: 0.4,
    });
    expect(styleFor({ ...CHOICE, fill: 'hatched' }, 'polygon')).toEqual({
      strokeColor: '#aa3300', strokeWidth: 3, strokeDash: 'dash', fillColor: '#00aa33', fillOpacity: 0.4, fillPattern: 'hatch',
    });
  });

  it('an arrow gets an arrowhead and a route markers at its points, and neither gets a fill', () => {
    const filled: StyleChoice = { ...CHOICE, fill: 'hatched' };
    expect(styleFor(filled, 'arrow')).toEqual({ strokeColor: '#aa3300', strokeWidth: 3, strokeDash: 'dash', arrowhead: 'end' });
    expect(styleFor(filled, 'route')).toEqual({ strokeColor: '#aa3300', strokeWidth: 3, strokeDash: 'dash', pointMarkers: 'circle' });
  });

  it('reads a style back into the form, whatever fill it has', () => {
    expect(choiceOf({ strokeColor: '#112233' }).fill).toBe('none');
    expect(choiceOf({ fillColor: '#112233', fillOpacity: 0.3 })).toMatchObject({ fill: 'transparent', fillOpacity: 0.3 });
    expect(choiceOf({ fillColor: '#112233', fillPattern: 'hatch' })).toMatchObject({ fill: 'hatched', fillOpacity: 1 });
    expect(choiceOf({ arrowhead: 'end', pointMarkers: 'circle' })).toMatchObject({ arrowhead: true, markers: true });
    expect(choiceOf(undefined)).toEqual(DEFAULT_STYLE);
  });

  it('changing the form keeps the style fields the form does not show', () => {
    const old = { strokeColor: '#111111', strokeOpacity: 0.5, fillColor: '#222222', fillOpacity: 0.2 };
    expect(applyChoice(old, { ...CHOICE, fill: 'none' }, { area: true, line: false })).toEqual({
      strokeColor: '#aa3300', strokeWidth: 3, strokeDash: 'dash', strokeOpacity: 0.5,
    });
    // A line has no fill in the form: a fill that is there stays.
    expect(applyChoice(old, { ...CHOICE, fill: 'none' }, { area: false, line: true })).toMatchObject({ fillColor: '#222222', fillOpacity: 0.2 });
  });

  it('drops the hatch pattern when the fill becomes transparent, and the arrowhead when it is unchecked', () => {
    const hatched = { fillColor: '#222222', fillOpacity: 0.2, fillPattern: 'hatch' as const };
    expect(applyChoice(hatched, { ...CHOICE, fill: 'transparent' }, { area: true, line: false })).not.toHaveProperty('fillPattern');
    expect(applyChoice({ arrowhead: 'end' as const }, { ...CHOICE, arrowhead: false }, { area: false, line: true })).not.toHaveProperty('arrowhead');
  });

  it('has the same defaults as the manifest', () => {
    const defaults = Object.fromEntries(Object.entries(manifest.settings.properties).map(([k, v]) => [k, v.default]));
    expect(readStyleSettings(defaults)).toEqual({ style: DEFAULT_STYLE, problems: [] });
    expect(readSettings(defaults).settings.dataType).toBe('core.general');
  });

  it('reports a bad setting and uses the default', () => {
    const { style, problems } = readStyleSettings({ outlineColor: 'blue', outlineWidth: 99, outlineDash: 'wavy', fill: 'checked', fillColor: '#12', fillOpacity: 2 });
    expect(style).toEqual(DEFAULT_STYLE);
    expect(problems).toHaveLength(6);
  });
});

describe('content', () => {
  const geometry: Geometry = { type: 'Polygon', coordinates: [[[18, 59.3], [18.2, 59.3], [18.2, 59.4], [18, 59.4], [18, 59.3]]] };

  it('a new shape is a core.shape drawn by hand, with the kind in our own extension', () => {
    const content = newShapeContent({ kind: 'rectangle', geometry, style: { strokeColor: '#111111' }, name: ' Objective ', layerId: LAYER, dataType: 'core.general', label: LABEL });
    expect(content).toEqual({
      type: 'core.shape', dataType: 'core.general', dataSource: 'manual', layerId: LAYER, geometry, style: { strokeColor: '#111111' },
      properties: { name: 'Objective' }, label: LABEL, extensions: { 'draw-shapes': { kind: 'rectangle' } },
    });
  });

  it('an empty name is no name', () => {
    expect(newShapeContent({ kind: 'circle', geometry, style: {}, name: '   ', layerId: LAYER, dataType: 'core.general', label: LABEL })).not.toHaveProperty('properties');
  });

  it('an update carries every core field and no extensions, so the store keeps ours', () => {
    const object: MapObject = shapeObject(LAYER, { extensions: { 'draw-shapes': { kind: 'circle' }, other: { x: 1 } }, time: { observed: '2026-10-09T12:00:00.000Z' }, properties: { name: 'A', description: 'B' } });
    const core = coreOf(object);
    expect(core).not.toHaveProperty('extensions');
    expect(core).not.toHaveProperty('id');
    expect(core).not.toHaveProperty('version');
    expect(core).not.toHaveProperty('meta');
    expect(core).toMatchObject({ type: 'core.shape', dataType: 'core.general', dataSource: 'manual', layerId: LAYER, time: { observed: '2026-10-09T12:00:00.000Z' } });
  });

  it('changes one field and leaves the others', () => {
    const core: MapObjectContent = coreOf(shapeObject(LAYER, { properties: { name: 'A', description: 'B' } }));
    expect(withName(core, 'C').properties).toEqual({ name: 'C', description: 'B' });
    expect(withName(coreOf(shapeObject(LAYER, { properties: { name: 'A' } })), '  ')).not.toHaveProperty('properties');
    expect(withStyle(core, { strokeColor: '#000000' }).style).toEqual({ strokeColor: '#000000' });
    expect(withLayer(core, 'x').layerId).toBe('x');
    expect(withDataType(core, 'cot.cot')).toMatchObject({ dataType: 'cot.cot', dataSource: 'manual' });
    expect(withGeometry(core, geometry).geometry).toBe(geometry);
  });

  it('limits a name to 256 characters', () => {
    expect(Array.from(normalizeText('x'.repeat(300), 256) ?? '')).toHaveLength(256);
    expect(normalizeText('  ', 256)).toBeUndefined();
  });

  it('names a shape by its kind, or by its geometry when it has none of ours', () => {
    const rectangle = shapeObject(LAYER, { geometry, extensions: { 'draw-shapes': { kind: 'rectangle' } } });
    expect(kindOf(rectangle)).toBe('rectangle');
    expect(kindLabelOf(rectangle)).toBe('Rectangle');
    expect(kindLabelOf(shapeObject(LAYER, { geometry }))).toBe('Area');
    expect(kindLabelOf(shapeObject(LAYER))).toBe('Circle');
    // A kind that no longer fits the geometry (someone else reshaped the shape) is not trusted.
    expect(kindOf(shapeObject(LAYER, { extensions: { 'draw-shapes': { kind: 'rectangle' } } }))).toBeNull();
    expect(kindLabelOf(shapeObject(LAYER, { extensions: { 'draw-shapes': { kind: 'nonsense' } } }))).toBe('Circle');
    expect(kindLabelOf(shapeObject(LAYER, { geometry: { type: 'Corridor', coordinates: [[0, 0], [1, 1]], width: 10 } }))).toBe('Corridor');
  });
});

describe('geometry', () => {
  it('keeps longitude first and latitude second', () => {
    expect(validPosition([18.0686, 59.3293])).toEqual([18.0686, 59.3293]);
    expect(validPosition([59.3293, 18.0686])).toEqual([59.3293, 18.0686]); // a swapped pair is still valid: the order is the caller's
    expect(cleanGeometry({ type: 'Circle', center: [18.0686, 59.3293], radius: 2500 })).toEqual({ type: 'Circle', center: [18.0686, 59.3293], radius: 2500 });
  });

  it('brings a wrapped longitude back and refuses a latitude past a pole', () => {
    expect(validPosition([190, 10])).toEqual([-170, 10]);
    expect(validPosition([-540.5, 10])).toEqual([179.5, 10]);
    expect(validPosition([10, 91])).toBeNull();
    expect(validPosition([Number.NaN, 10])).toBeNull();
  });

  it('drops the altitude of a drawn position', () => {
    expect(cleanGeometry({ type: 'LineString', coordinates: [[18, 59, 12], [19, 60, 30]] })).toEqual({ type: 'LineString', coordinates: [[18, 59], [19, 60]] });
  });

  it('refuses what the model cannot store', () => {
    expect(cleanGeometry({ type: 'Circle', center: [18, 59], radius: 0 })).toBeNull();
    expect(cleanGeometry({ type: 'Circle', center: [18, 95], radius: 10 })).toBeNull();
    expect(cleanGeometry({ type: 'Ellipse', center: [18, 59], semiMajorAxis: 10, semiMinorAxis: -1, rotation: 0 })).toBeNull();
    expect(cleanGeometry({ type: 'LineString', coordinates: [[18, 59]] })).toBeNull();
    expect(cleanGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] })).toBeNull(); // not closed
    expect(cleanGeometry({ type: 'Point', coordinates: [0, 0] })).toBeNull();
  });

  it('turns an ellipse rotation into 0 to 360 degrees', () => {
    expect(cleanGeometry({ type: 'Ellipse', center: [18, 59], semiMajorAxis: 10, semiMinorAxis: 5, rotation: -90 })).toMatchObject({ rotation: 270 });
  });
});
