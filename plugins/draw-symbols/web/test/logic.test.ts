// The plain functions: request content, the tracker, settings, SIDC parts.
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@emc2/plugin-sdk';
import type { ChangeEvent, MapObject, MapObjectContent } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import {
  coreOf, isInsideRing, MAX_NAME_LENGTH, MAX_TEXT_LENGTH, newSymbolContent, normalizeText, sameJson, validPosition, withLayer, withModifier, withName, withPosition, withSidc,
} from '../src/content.ts';
import { DEFAULT_SETTINGS, readSettings } from '../src/settings.ts';
import { composeChoice, composeVessel, partsOf, vesselIdentityOf, vesselOf, withParts, withVessel } from '../src/symbolParts.ts';
import { ObjectTracker } from '../src/tracker.ts';
import { AreaWatch, areaAround, WATCH_HALF_SIDE_M } from '../src/watch.ts';
import type { TrackerChange } from '../src/tracker.ts';
import { LABEL, layer, modelExample, symbolObject } from './fakeServer.ts';

const LAYER = uuidv7();

function core(overrides: Partial<MapObjectContent> = {}): MapObjectContent {
  return { type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId: LAYER, geometry: { type: 'Point', coordinates: [18.0686, 59.3293] }, symbol: { standard: 'APP-6D', sidc: '10031000001211000000' }, label: LABEL, ...overrides };
}

describe('coreOf', () => {
  it('keeps the core fields and drops id, version, meta and extensions', () => {
    const track = modelExample('object-track-from-cot.json');
    const result = coreOf(track);
    expect(Object.keys(result).sort()).toEqual(['dataSource', 'dataType', 'geometry', 'label', 'layerId', 'symbol', 'time', 'type']);
    // The data type, the unchanged data source and the time attributes travel with every update (rules 5, 14, 15).
    expect(result).toMatchObject({ dataType: 'cot-in.cot', dataSource: 'tak-north', time: track.time });
    expect(result.symbol).toEqual(track.symbol);
    expect(result.geometry).toEqual(track.geometry);
  });
});

describe('text edits', () => {
  it('trims, and empty text removes the name; no empty properties are left behind', () => {
    const named = withName(core(), '  Alpha  ');
    expect(named.properties).toEqual({ name: 'Alpha' });
    const cleared = withName(named, '   ');
    expect('properties' in cleared).toBe(false);
  });

  it('keeps the description when the name is removed', () => {
    const result = withName(core({ properties: { name: 'x', description: 'd' } }), '');
    expect(result.properties).toEqual({ description: 'd' });
  });

  it('bounds the name and modifiers by characters, not by UTF-16 units', () => {
    expect(Array.from(withName(core(), 'é'.repeat(MAX_NAME_LENGTH + 50)).properties?.name ?? '')).toHaveLength(MAX_NAME_LENGTH);
    const emoji = '😀'.repeat(MAX_TEXT_LENGTH + 5);
    const text = withModifier(core(), 'uniqueDesignation', emoji).symbol?.modifiers?.uniqueDesignation ?? '';
    expect(Array.from(text)).toHaveLength(MAX_TEXT_LENGTH);
    expect(text.at(-1)).not.toBe('\ud83d'); // no half of a surrogate pair
  });

  it('sets and removes one modifier and keeps the others, including direction and speed', () => {
    const base = core({ symbol: { standard: 'APP-6D', sidc: '10031000001211000000', modifiers: { speed: 4.2, direction: 270, higherFormation: 'HQ' } } });
    const set = withModifier(base, 'uniqueDesignation', 'VIPER 2');
    expect(set.symbol?.modifiers).toEqual({ speed: 4.2, direction: 270, higherFormation: 'HQ', uniqueDesignation: 'VIPER 2' });
    const removed = withModifier(set, 'higherFormation', '');
    expect(removed.symbol?.modifiers).toEqual({ speed: 4.2, direction: 270, uniqueDesignation: 'VIPER 2' });
  });

  it('writes no empty modifiers object when the last modifier goes', () => {
    const one = withModifier(core(), 'additionalInformation', 'x');
    const none = withModifier(one, 'additionalInformation', '');
    expect(none.symbol).toEqual({ standard: 'APP-6D', sidc: '10031000001211000000' });
    expect('modifiers' in (none.symbol ?? {})).toBe(false);
  });

  it('does not touch the input', () => {
    const input = core({ properties: { name: 'a' } });
    const snapshot = JSON.stringify(input);
    withName(input, 'b');
    withModifier(input, 'uniqueDesignation', 'c');
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('position', () => {
  it('moves a point in longitude, latitude order, keeps the altitude, and does not touch the rest', () => {
    const track = modelExample('object-track-from-cot.json'); // altitude 45.2
    const moved = withPosition(coreOf(track), [-130.25, -12.5]);
    expect(moved.geometry).toEqual({ type: 'Point', coordinates: [-130.25, -12.5, 45.2] });
    const flat = withPosition(core(), [18.0686, 59.3293]);
    expect(flat.geometry).toEqual({ type: 'Point', coordinates: [18.0686, 59.3293] });
  });

  it('accepts valid positions and brings a wrapped longitude back; refuses a latitude beyond the pole and non-numbers', () => {
    expect(validPosition([18.0686, 59.3293])).toEqual([18.0686, 59.3293]);
    expect(validPosition([-180, 0])).toEqual([-180, 0]);
    expect(validPosition([190, 10])).toEqual([-170, 10]);
    expect(validPosition([-540.5, 10])).toEqual([179.5, 10]);
    expect(validPosition([10, 90])).toEqual([10, 90]);
    expect(validPosition([10, 90.0001])).toBeNull();
    expect(validPosition([Number.NaN, 10])).toBeNull();
    expect(validPosition([10, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it('a new symbol is at the clicked point (latitude ≠ longitude), without altitude, with the given label', () => {
    const label = { ...LABEL, classification: 'RESTRICTED' };
    const content = newSymbolContent({ layerId: LAYER, position: [18.0686, 59.3293, 7], symbol: { standard: 'APP-6D', sidc: '10031000001211000000' }, label, dataType: 'core.general' });
    expect(content).toEqual({
      type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId: LAYER, geometry: { type: 'Point', coordinates: [18.0686, 59.3293] },
      symbol: { standard: 'APP-6D', sidc: '10031000001211000000' }, label,
    });
  });
});

describe('SIDCs', () => {
  it('writes the 20-digit form when digits 21-30 are zero, and compares the two forms as equal', () => {
    const long = '130310000012110000000000000000';
    const symbol = { standard: 'APP-6E', sidc: long } as const;
    expect(withSidc(core({ symbol }), long).symbol?.sidc).toBe('13031000001211000000');
    expect(sameJson(withSidc(core({ symbol }), long), core({ symbol: { standard: 'APP-6E', sidc: '13031000001211000000' } }))).toBe(true);
    expect(withSidc(core({ symbol: { standard: 'APP-6E', sidc: '13031000001211000000' } }), '130310000012110000000000000001').symbol?.sidc).toBe('130310000012110000000000000001');
  });

  it('composes a catalog choice and changes one part of an existing SIDC', () => {
    const symbols = createFakeSymbolService();
    const sidc = composeChoice(symbols, 'APP-6D', { standardIdentity: '3', echelon: '15', symbolSet: '10', entity: '121100' });
    expect(sidc).toBe('10031000151211000000');
    expect(partsOf(symbols, { standard: 'APP-6D', sidc })).toMatchObject({ standardIdentity: '3', echelonMobility: '15', entity: '121100' });
    expect(withParts(symbols, { standard: 'APP-6D', sidc }, { standardIdentity: '6' })).toBe('10061000151211000000');
    expect(withParts(symbols, { standard: 'APP-6D', sidc }, { echelonMobility: '16' })).toBe('10031000161211000000');
  });

  it('has no parts for APP-6B, a vessel symbol (SDK 1.4.0) or a SIDC the service cannot describe', () => {
    const symbols = createFakeSymbolService();
    expect(partsOf(symbols, { standard: 'APP-6B', sidc: 'SFGPUCI--------' })).toBeNull();
    expect(partsOf(symbols, { standard: 'vessel', sidc: '1234' })).toBeNull();
    expect(vesselOf({ standard: 'vessel', sidc: '0471' })).toEqual({ context: 0, identity: 4, shipType: 71 });
    expect(vesselOf({ standard: 'vessel', sidc: '9999' })).toBeNull();
    expect(vesselOf({ standard: 'APP-6D', sidc: '10031000001211000000' })).toBeNull();
    expect(withVessel({ standard: 'vessel', sidc: '1471' }, { identity: 6 })).toBe('1671'); // the context stays
    expect(withVessel({ standard: 'vessel', sidc: '0471' }, { shipType: 5 })).toBe('0405');
    expect(withVessel({ standard: 'APP-6D', sidc: '10031000001211000000' }, { shipType: 5 })).toBeNull();
    expect(composeVessel('4', 71)).toBe('0471');
    expect(['0', '6'].map(vesselIdentityOf)).toEqual([0, 6]);
    expect(['7', '9', '', '33', 'x'].map(vesselIdentityOf)).toEqual([null, null, null, null, null]); // a vessel has the identities 0 to 6
    expect(composeVessel('7', 71)).toBeNull();
    expect(withParts(symbols, { standard: 'vessel', sidc: '1234' }, { standardIdentity: '6' })).toBeNull();
    const refusing = { ...symbols, describe: () => { throw new RangeError('no'); } };
    expect(partsOf(refusing, { standard: 'APP-6D', sidc: 'x' })).toBeNull();
    expect(withParts(symbols, { standard: 'APP-6B', sidc: 'SFGPUCI--------' }, { standardIdentity: '6' })).toBeNull();
  });

  it('passes on an error that is not a RangeError', () => {
    const broken = { ...createFakeSymbolService(), describe: () => { throw new Error('boom'); } };
    expect(() => partsOf(broken, { standard: 'APP-6D', sidc: 'x' })).toThrow('boom');
  });

  it('moves a layer id without touching the rest', () => {
    const other = uuidv7();
    expect(withLayer(core(), other)).toEqual(core({ layerId: other }));
  });
});

describe('helpers', () => {
  it('normalizes text', () => {
    expect(normalizeText('  a  ', 5)).toBe('a');
    expect(normalizeText('   ', 5)).toBeUndefined();
    expect(normalizeText('abcdefgh', 5)).toBe('abcde');
  });

  it('compares JSON values deeply and regardless of key order', () => {
    expect(sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameJson([1], { 0: 1 })).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });
});

describe('settings', () => {
  it('has the defaults of plugin.json', () => {
    const declared = manifest.settings.properties;
    expect(DEFAULT_SETTINGS).toEqual({
      standard: declared.standard.default, pickerSymbolSize: declared.pickerSymbolSize.default, dataType: declared.dataType.default,
    });
    expect(readSettings({})).toEqual({ settings: DEFAULT_SETTINGS, problems: [] });
  });

  it('uses valid values and reports bad ones', () => {
    expect(readSettings({ standard: 'APP-6E', pickerSymbolSize: 64, dataType: 'cot-in.cot' })).toEqual({
      settings: { standard: 'APP-6E', pickerSymbolSize: 64, dataType: 'cot-in.cot' }, problems: [],
    });
    for (const bad of [
      { standard: 'APP-6B' }, { standard: 5 }, { pickerSymbolSize: 3 }, { pickerSymbolSize: 129 }, { pickerSymbolSize: 40.5 }, { pickerSymbolSize: '40' },
      { dataType: '' }, { dataType: 7 }, { dataType: 'x'.repeat(129) },
    ]) {
      const { settings, problems } = readSettings(bad);
      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(problems).toHaveLength(1);
    }
  });
});

describe('ObjectTracker', () => {
  function event(object: MapObject, operation: 'create' | 'update', version: number, state: MapObject | null = { ...object, version }): ChangeEvent {
    return { sequenceNo: version, requestId: uuidv7(), entityType: 'object', operation, entityId: object.id, version, previousVersion: version - 1, state, label: LABEL, at: 'x', by: { plugin: 'p' } };
  }

  it('orders layers top first, ties by the higher id', () => {
    const tracker = new ObjectTracker();
    const low = { ...layer('low', 1), id: '0192a5c4-3b1e-7c2d-9f00-000000000001' };
    const tieA = { ...layer('tie-a', 5), id: '0192a5c4-3b1e-7c2d-9f00-000000000002' };
    const tieB = { ...layer('tie-b', 5), id: '0192a5c4-3b1e-7c2d-9f00-000000000003' };
    tracker.snapshot({ layers: [low, tieA, tieB], objects: [], sequenceNo: 0 });
    expect(tracker.layers.map((l) => l.name)).toEqual(['tie-b', 'tie-a', 'low']);
  });

  it('applies newer events once and ignores older ones', () => {
    const tracker = new ObjectTracker();
    const object = symbolObject(LAYER);
    tracker.snapshot({ layers: [], objects: [object], sequenceNo: 0 });
    const update = event(object, 'update', 2, { ...object, version: 2, properties: { name: 'new' } });
    tracker.applyEvent(update);
    expect(tracker.get(object.id)?.properties?.name).toBe('new');
    tracker.changes([event(object, 'update', 2, { ...object, version: 2, properties: { name: 'same version' } })]);
    expect(tracker.get(object.id)?.properties?.name).toBe('new');
    tracker.changes([event(object, 'update', 1)]);
    expect(tracker.get(object.id)?.version).toBe(2);
  });

  it('reports a deleted object once and does not bring it back from a late older update', () => {
    const tracker = new ObjectTracker();
    const object = symbolObject(LAYER);
    tracker.snapshot({ layers: [], objects: [object], sequenceNo: 0 });
    const changes: TrackerChange[] = [];
    tracker.onChange((change) => changes.push(change));
    tracker.changes([event(object, 'update', 2, null)]);
    expect(tracker.get(object.id)).toBeUndefined();
    tracker.changes([event(object, 'update', 2, null)]);
    tracker.changes([event(object, 'update', 2)]); // a late update from before the delete
    expect(tracker.get(object.id)).toBeUndefined();
    const none = new Map();
    expect(changes).toEqual([
      { removed: [object.id], removedBy: new Map([[object.id, { plugin: 'p' }]]), removedObjects: new Map([[object.id, object]]), left: [] },
      { removed: [], removedBy: none, removedObjects: none, left: [] },
      { removed: [], removedBy: none, removedObjects: none, left: [] },
    ]);
  });

  it('says who deleted an object: the actor of the delete event, for the notice only others get', () => {
    const tracker = new ObjectTracker();
    const object = symbolObject(LAYER);
    tracker.snapshot({ layers: [], objects: [object], sequenceNo: 0 });
    const changes: TrackerChange[] = [];
    tracker.onChange((change) => changes.push(change));
    tracker.changes([{ ...event(object, 'update', 2, null), by: { plugin: 'core-shell', user: 'u-7' } }]);
    expect(changes[0]?.removedBy.get(object.id)).toEqual({ plugin: 'core-shell', user: 'u-7' });
  });

  it('adds an object it does not hold when an event for it arrives (area mode: it entered the area)', () => {
    const tracker = new ObjectTracker();
    const object = symbolObject(LAYER);
    tracker.snapshot({ layers: [], objects: [], sequenceNo: 0 });
    tracker.changes([event(object, 'update', 2)]);
    expect(tracker.get(object.id)?.version).toBe(2);
  });

  it('ignores a delete of an object it does not hold', () => {
    const tracker = new ObjectTracker();
    const object = symbolObject(LAYER);
    tracker.snapshot({ layers: [], objects: [], sequenceNo: 0 });
    const changes: TrackerChange[] = [];
    tracker.onChange((change) => changes.push(change));
    tracker.changes([event(object, 'update', 2, null)]);
    expect(changes).toEqual([{ removed: [], removedBy: new Map(), removedObjects: new Map(), left: [] }]);
  });

  it('a snapshot replaces everything; what it lacks is reported as left, not as deleted', () => {
    const tracker = new ObjectTracker();
    const [one, two] = [symbolObject(LAYER), symbolObject(LAYER)];
    tracker.snapshot({ layers: [], objects: [one, two], sequenceNo: 0 });
    const changes: TrackerChange[] = [];
    tracker.onChange((change) => changes.push(change));
    tracker.snapshot({ layers: [], objects: [two], sequenceNo: 5 });
    expect(changes).toEqual([{ removed: [], removedBy: new Map(), removedObjects: new Map(), left: [one.id] }]);
    expect(tracker.get(one.id)).toBeUndefined();
    expect(tracker.get(two.id)).toBeDefined();
  });

  it('area: objects that left are dropped (reported as left, not removed) and objects that entered are added', () => {
    const tracker = new ObjectTracker();
    const [inside, outside] = [symbolObject(LAYER), symbolObject(LAYER)];
    tracker.snapshot({ layers: [], objects: [inside], sequenceNo: 0 });
    const changes: TrackerChange[] = [];
    tracker.onChange((change) => changes.push(change));
    tracker.area({ sequenceNo: 1, entered: [outside], left: [inside.id, 'not-held'] });
    expect(tracker.get(inside.id)).toBeUndefined();
    expect(tracker.get(outside.id)).toBeDefined();
    expect(changes).toEqual([{ removed: [], removedBy: new Map(), removedObjects: new Map(), left: [inside.id] }]);
    // It enters again, at a newer version.
    tracker.area({ sequenceNo: 2, entered: [{ ...inside, version: 3 }], left: [] });
    expect(tracker.get(inside.id)?.version).toBe(3);
  });

  it('area: an entered object that is older than a delete we saw is not brought back', () => {
    const tracker = new ObjectTracker();
    const object = symbolObject(LAYER);
    tracker.snapshot({ layers: [], objects: [object], sequenceNo: 0 });
    tracker.changes([event(object, 'update', 4, null)]);
    tracker.area({ sequenceNo: 5, entered: [{ ...object, version: 3 }], left: [] });
    expect(tracker.get(object.id)).toBeUndefined();
  });
});

describe('the tracker holds the layers and the objects of two subscriptions apart', () => {
  it('a layer snapshot leaves the objects, an object snapshot leaves the layers', () => {
    const tracker = new ObjectTracker();
    const lay = layer('Default', 0);
    const object = symbolObject(lay.id);
    tracker.layerSnapshot({ layers: [lay] });
    expect(tracker.layers.map((l) => l.id)).toEqual([lay.id]);
    expect(tracker.loaded).toBe(true);
    tracker.objectSnapshot({ objects: [object] });
    expect(tracker.get(object.id)).toBe(object);
    tracker.layerSnapshot({ layers: [layer('Other', 1)] });
    expect(tracker.get(object.id)).toBe(object); // not touched by the layers
    tracker.objectSnapshot({ objects: [] });
    expect(tracker.layers).toHaveLength(1); // not touched by the objects
  });

  it('an object snapshot reports what it lacks as left, not removed', () => {
    const tracker = new ObjectTracker();
    const object = symbolObject(LAYER);
    tracker.objectSnapshot({ objects: [object] });
    const changes: TrackerChange[] = [];
    tracker.onChange((change) => changes.push(change));
    tracker.objectSnapshot({ objects: [] });
    expect(changes[0]).toMatchObject({ removed: [], left: [object.id] });
  });

  it('dropping the objects forgets them without reporting them as left or removed, and does nothing when there are none', () => {
    const tracker = new ObjectTracker();
    const object = symbolObject(LAYER);
    tracker.objectSnapshot({ objects: [object] });
    const changes: TrackerChange[] = [];
    tracker.onChange((change) => changes.push(change));
    tracker.dropObjects();
    expect(tracker.get(object.id)).toBeUndefined();
    expect(changes).toEqual([{ removed: [], removedBy: new Map(), removedObjects: new Map(), left: [] }]);
    tracker.dropObjects();
    expect(changes).toHaveLength(1);
  });
});

describe('the small area round the selected symbol', () => {
  const span = (values: readonly number[]) => Math.max(...values) - Math.min(...values);

  it('is a closed ring round the position, with the position inside, about the size asked for', () => {
    const area = areaAround([15.5, 60.25]);
    expect(area.inside).toEqual([15.5, 60.25]);
    expect(area.ring).toHaveLength(5);
    expect(area.ring[0]).toEqual(area.ring[4]);
    const lats = area.ring.map(([, lat]) => lat);
    expect(span(lats) / 2).toBeCloseTo(WATCH_HALF_SIDE_M / 111_320, 6);
    const lons = area.ring.map(([lon]) => lon);
    expect(Math.min(...lons)).toBeLessThan(15.5);
    expect(Math.max(...lons)).toBeGreaterThan(15.5);
    // latitude and longitude steps differ at 60 degrees north: the longitude step is about twice the latitude step
    expect(span(lons) / span(lats)).toBeCloseTo(2, 1);
  });

  it('keeps longitude first: swapped numbers would put the ring somewhere else', () => {
    const area = areaAround([-130.25, -12.5]);
    expect(area.inside).toEqual([-130.25, -12.5]);
    for (const [lon, lat] of area.ring) {
      expect(Math.abs(lon - -130.25)).toBeLessThan(0.1);
      expect(Math.abs(lat - -12.5)).toBeLessThan(0.1);
    }
  });

  it('wraps across the antimeridian and is clamped at the poles', () => {
    const across = areaAround([179.999, 10]);
    expect(across.ring.every(([lon]) => lon >= -180 && lon <= 180)).toBe(true);
    expect(across.ring.some(([lon]) => lon < 0)).toBe(true); // the east side wrapped to -179.99
    for (const lat of [89.999, 90, -90]) {
      const pole = areaAround([10, lat]);
      expect(pole.ring.every(([, y]) => y < 90 && y > -90)).toBe(true);
      expect(pole.ring.every(([x]) => Number.isFinite(x))).toBe(true);
      // no edge of no length, and the centre inside the ring's latitudes
      for (let i = 0; i + 1 < pole.ring.length; i++) expect(pole.ring[i]).not.toEqual(pole.ring[i + 1]);
      const south = Math.min(...pole.ring.map(([, y]) => y));
      const north = Math.max(...pole.ring.map(([, y]) => y));
      expect(pole.inside[1]).toBeGreaterThan(south);
      expect(pole.inside[1]).toBeLessThan(north);
    }
  });
});

describe('whether a position is inside the map view\'s visible ring', () => {
  const ring: [number, number][] = [[-10, 50], [40, 50], [40, 72], [-10, 72], [-10, 50]];

  it('tests a position in lon, lat order', () => {
    expect(isInsideRing([15.5, 60.25], ring)).toBe(true);
    expect(isInsideRing([60.25, 15.5], ring)).toBe(false); // swapped: lon 60 is outside, lat 15 too
    expect(isInsideRing([-130.25, -12.5], ring)).toBe(false);
    expect(isInsideRing([41, 60], ring)).toBe(false);
  });

  it('counts a ring it cannot test in lon/lat (an edge spanning more than 180 degrees of longitude, or too few points) as showing everything', () => {
    expect(isInsideRing([0, 0], [[170, -10], [-170, -10], [-170, 10], [170, 10], [170, -10]])).toBe(true);
    expect(isInsideRing([0, 0], [[1, 1], [2, 2]])).toBe(true);
  });
});

describe('AreaWatch', () => {
  function watching() {
    const ctx = createFakeContext({ pluginId: manifest.id });
    const tracker = new ObjectTracker();
    return { ctx, tracker, watch: new AreaWatch(ctx.livePicture, tracker) };
  }

  it('subscribes once round a position and says what it follows', () => {
    const { ctx, watch } = watching();
    expect(watch.id).toBeNull();
    watch.around('a', [15.5, 60.25]);
    expect(watch.id).toBe('a');
    expect(watch.isAround('a', [15.5, 60.25])).toBe(true);
    expect(watch.isAround('a', [60.25, 15.5])).toBe(false);
    expect(watch.isAround('b', [15.5, 60.25])).toBe(false);
    expect(ctx.liveSubscriptions).toHaveLength(1);
    expect(ctx.liveSubscriptions[0]?.area).toEqual(areaAround([15.5, 60.25]));
  });

  it('replaces the area when it follows something else, and ends it on stop, forgetting the objects', () => {
    const { ctx, tracker, watch } = watching();
    watch.around('a', [15.5, 60.25]);
    watch.around('b', [20, 63]);
    expect(ctx.liveSubscriptions).toHaveLength(1);
    expect(ctx.liveSubscriptions[0]?.area).toEqual(areaAround([20, 63]));
    const object = symbolObject(LAYER);
    ctx.live.snapshot({ objects: [object] });
    expect(tracker.get(object.id)).toBeDefined();
    watch.stop();
    expect(ctx.liveSubscriptions).toHaveLength(0);
    expect(tracker.get(object.id)).toBeUndefined();
    expect(watch.id).toBeNull();
    watch.stop(); // nothing to stop: no error
  });

  it('brings the snapshot, the changes and the area changes of its subscription into the tracker', () => {
    const { ctx, tracker, watch } = watching();
    watch.around('a', [15.5, 60.25]);
    const one = symbolObject(LAYER);
    const two = symbolObject(LAYER);
    ctx.live.snapshot({ objects: [one] });
    ctx.live.area({ sequenceNo: 3, entered: [two], left: [one.id] });
    expect(tracker.get(one.id)).toBeUndefined();
    expect(tracker.get(two.id)).toBeDefined();
  });
});
