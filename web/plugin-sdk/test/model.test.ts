/**
 * Contract test of the hand-written TypeScript model types against model/examples/ (model README:
 * "Types are written by hand ... and checked by contract tests with these examples").
 *
 * The key sets below are checked by the compiler to equal the types' keys exactly
 * (`satisfies Record<keyof T, true>` fails on a missing or an extra key). The test then checks
 * that every valid example uses only those keys, at every level the types describe. The JSON
 * Schema tests in model/ check required fields and values.
 */
import { describe, expect, it } from 'vitest';
import type {
  ArcBand, ChangeEvent, ChangeRejection, ChangeRequest, Circle, Corridor, Ellipse, Layer, LineString, MapObject, Meta, MilSymbol, Modifiers, MultiPoint,
  Point, Polygon, SecurityLabel, Style, TextContent, TimeAttributes,
} from '../src/model.ts';

const MAP_OBJECT = {
  id: true, version: true, meta: true, type: true, dataType: true, dataSource: true, time: true, layerId: true, geometry: true, symbol: true, style: true,
  properties: true, label: true, extensions: true, fieldSets: true, relations: true, text: true, displayClass: true,
} satisfies Record<keyof MapObject, true>;
const TEXT = { value: true, rotation: true, size: true } satisfies Record<keyof TextContent, true>;
const TIME = { observed: true, validFrom: true, expires: true } satisfies Record<keyof TimeAttributes, true>;
const LAYER = { id: true, version: true, meta: true, name: true, drawOrder: true, visible: true, label: true, extensions: true, workspace: true, locked: true } satisfies Record<keyof Layer, true>;
const SYMBOL = { standard: true, sidc: true, modifiers: true } satisfies Record<keyof MilSymbol, true>;
const MODIFIERS = {
  additionalInformation: true, altitudeDepth: true, auxiliaryEquipmentIndicator: true, combatEffectiveness: true, commonIdentifier: true,
  country: true, dtg: true, engagementBar: true, engagementType: true, equipmentTeardownTime: true, evaluationRating: true, guardedUnit: true,
  headquartersElement: true, higherFormation: true, hostile: true, iffSif: true, installationComposition: true, location: true, platformType: true,
  quantity: true, reinforcedReduced: true, sigint: true, signatureEquipment: true, specialDesignator: true, specialHeadquarters: true,
  staffComments: true, type: true, uniqueDesignation: true, direction: true, speed: true,
  dtg1: true, targetNumber: true, uniqueDesignation1: true, uniqueDesignation2: true, distances: true, azimuths: true,
} satisfies Record<keyof Modifiers, true>;
const STYLE = { strokeColor: true, strokeWidth: true, strokeOpacity: true, strokeDash: true, fillColor: true, fillOpacity: true, fillPattern: true, arrowhead: true, pointMarkers: true } satisfies Record<keyof Style, true>;
const LABEL = { policyIdentifier: true, classification: true, categories: true, creationDateTime: true, reviewDateTime: true } satisfies Record<keyof SecurityLabel, true>;
const META = { created: true, modified: true, externalRef: true } satisfies Record<keyof Meta, true>;
const GEOMETRY: Record<string, Record<string, true>> = {
  Point: { type: true, coordinates: true } satisfies Record<keyof Point, true>,
  MultiPoint: { type: true, coordinates: true } satisfies Record<keyof MultiPoint, true>,
  LineString: { type: true, coordinates: true } satisfies Record<keyof LineString, true>,
  Polygon: { type: true, coordinates: true } satisfies Record<keyof Polygon, true>,
  Circle: { type: true, center: true, radius: true } satisfies Record<keyof Circle, true>,
  Ellipse: { type: true, center: true, semiMajorAxis: true, semiMinorAxis: true, rotation: true } satisfies Record<keyof Ellipse, true>,
  Corridor: { type: true, coordinates: true, width: true } satisfies Record<keyof Corridor, true>,
  ArcBand: { type: true, center: true, innerRadius: true, outerRadius: true, startBearing: true, endBearing: true } satisfies Record<keyof ArcBand, true>,
};
/** The keys of every variant of a union. */
type AllKeys<T> = T extends unknown ? keyof T : never;
const CHANGE_REQUEST = {
  requestId: true, entityType: true, operation: true, entityId: true, baseVersion: true, data: true, externalRef: true, source: true, fields: true,
} satisfies Record<AllKeys<ChangeRequest>, true>;
const CHANGE_EVENT = {
  sequenceNo: true, requestId: true, entityType: true, operation: true, entityId: true, version: true, previousVersion: true, baseVersion: true,
  state: true, label: true, at: true, by: true,
} satisfies Record<keyof ChangeEvent, true>;
const CHANGE_REJECTION = {
  requestId: true, entityType: true, operation: true, entityId: true, code: true, message: true, details: true, at: true,
} satisfies Record<keyof ChangeRejection, true>;

type Json = Record<string, unknown>;
const problems: string[] = [];

function keys(value: unknown, allowed: Record<string, true>, where: string): Json {
  const object = value as Json;
  for (const k of Object.keys(object)) {
    if (!(k in allowed)) problems.push(`${where}: unknown member "${k}"`);
  }
  return object;
}

function label(value: unknown, where: string) {
  keys(value, LABEL, `${where}.label`);
}

function objectContent(o: Json, where: string, allowed: Record<string, true>) {
  keys(o, allowed, where);
  const g = o.geometry as Json;
  const shape = GEOMETRY[g.type as string];
  if (!shape) problems.push(`${where}: unknown geometry type ${String(g.type)}`);
  else keys(g, shape, `${where}.geometry`);
  if (o.text) keys(o.text, TEXT, `${where}.text`);
  if (o.symbol) {
    const s = keys(o.symbol, SYMBOL, `${where}.symbol`);
    if (s.modifiers) keys(s.modifiers, MODIFIERS, `${where}.symbol.modifiers`);
  }
  if (o.style) keys(o.style, STYLE, `${where}.style`);
  if (o.time) keys(o.time, TIME, `${where}.time`);
  label(o.label, where);
  if (o.meta) keys(o.meta, META, `${where}.meta`);
}

function layerContent(o: Json, where: string, allowed: Record<string, true>) {
  keys(o, allowed, where);
  label(o.label, where);
  if (o.meta) keys(o.meta, META, `${where}.meta`);
}

const examples = import.meta.glob<Json>(['../../../model/examples/valid/*.json', '../../../model/examples/migration/0.1.0-to-1.0.0/after/*.json'], {
  eager: true, import: 'default',
});

describe('TypeScript model types match model/examples/valid', () => {
  const names = Object.keys(examples);

  it('finds the examples', () => {
    expect(names.length).toBeGreaterThan(10);
  });

  it.each(names)('%s uses only members the types know', (path) => {
    problems.length = 0;
    const doc = examples[path] as Json;
    const file = path.split('/').pop() ?? path;
    if (file.startsWith('object-')) objectContent(doc, file, MAP_OBJECT);
    else if (file.startsWith('layer')) layerContent(doc, file, LAYER);
    else if (file.startsWith('change-request-')) {
      keys(doc, CHANGE_REQUEST, file);
      const data = doc.data as Json | undefined;
      if (data) (doc.entityType === 'object' ? objectContent(data, `${file}.data`, MAP_OBJECT) : layerContent(data, `${file}.data`, LAYER));
    } else if (file.startsWith('change-event-')) {
      keys(doc, CHANGE_EVENT, file);
      label(doc.label, file);
      const state = doc.state as Json | null;
      if (state) (doc.entityType === 'object' ? objectContent(state, `${file}.state`, MAP_OBJECT) : layerContent(state, `${file}.state`, LAYER));
    } else if (file.startsWith('change-rejection-')) keys(doc, CHANGE_REJECTION, file);
    else if (!file.startsWith('manifest-')) problems.push(`unknown example prefix: ${file}`);
    expect(problems).toEqual([]);
  });
});

// Compile-time check: real examples, written as literals, are accepted by the types.
const symbolExample: MapObject = {
  id: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e11',
  type: 'core.symbol',
  dataType: 'core.general',
  dataSource: 'manual',
  layerId: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01',
  version: 3,
  geometry: { type: 'Point', coordinates: [18.0686, 59.3293] },
  symbol: { standard: 'APP-6D', sidc: '10031000001211000000', modifiers: { uniqueDesignation: '1', higherFormation: '2 BDE', direction: 45 } },
  properties: { name: '1st Company', description: 'Placed by hand in the internal demo.' },
  label: {
    policyIdentifier: { name: 'NATO' },
    classification: 'UNCLASSIFIED',
    categories: [{ tagName: 'Releasable to', type: 'permissive', values: ['SWE', 'NATO'] }],
  },
  extensions: { 'draw-symbols': { placedWith: 'symbol-palette' } },
  meta: {
    created: { at: '2026-10-03T08:15:30.250Z', by: { plugin: 'draw-symbols', user: '3f2c9a10-5d7e-4b8a-9c41-2e6f8d0a7b15' } },
    modified: { at: '2026-10-03T08:21:02.004Z', by: { plugin: 'draw-symbols', user: '3f2c9a10-5d7e-4b8a-9c41-2e6f8d0a7b15' } },
  },
};

// Data model 1.1.0 (CR-0014): the new style fields are typed.
const routeStyle: Style = { strokeColor: '#2C784C', strokeWidth: 2, pointMarkers: 'circle', arrowhead: 'none' };
const hatchStyle: Style = { fillColor: '#1F3A93', fillOpacity: 0.6, fillPattern: 'hatch' };

describe('typed literals', () => {
  it('take the 1.1.0 style fields', () => {
    expect([routeStyle.pointMarkers, hatchStyle.fillPattern]).toEqual(['circle', 'hatch']);
  });
  it('compile and keep longitude first', () => {
    expect(symbolExample.geometry.type === 'Point' && symbolExample.geometry.coordinates[0]).toBe(18.0686);
  });
});
