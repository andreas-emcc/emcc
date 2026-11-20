/**
 * The user's display settings and the relation lines at the plugin's level (brief functions 34 and 35,
 * criteria 72 to 77, 82): `ctx.display` from the shell's fake, the engine as the controller drives it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DataType, DisplayChoices, MapObject, Position, Relation, RelationKind, Uuid } from '@emc2/plugin-sdk';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import { relationItemId } from '../src/core/relations.ts';
import { cotDataType, cotObject, event, layer, object, symbolObject, uuid } from './fixtures.ts';
import { activate } from './harness.ts';

const L = layer(1);
const PAIRING: RelationKind = {
  id: 'gmti.pairing', label: 'GMTI Pairing', defaultOn: false,
  line: { strokeColor: '#FFFF00', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none' },
};

function start(display?: DisplayChoices, kinds: readonly RelationKind[] = [PAIRING], dataTypes: readonly Omit<DataType, 'behaviour'>[] = []) {
  const ctx = createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], relationKinds: kinds, dataTypes, ...(display === undefined ? {} : { display }) });
  const run = activate({ ctx });
  if (run.engine === null) throw new Error('no engine');
  return { ...run, engine: run.engine, ctx };
}

/** Lets the promises of a fetch settle. */
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const withRelations = (o: MapObject, relations: readonly Relation[]): MapObject => ({ ...o, relations });

/** The ids of the relation lines the engine holds in a layer. */
const lineIds = (engine: { readonly items: ReadonlyMap<Uuid, ReadonlyMap<Uuid, { readonly kind: string }>> }, layerId: Uuid = L.id) =>
  [...(engine.items.get(layerId)?.keys() ?? [])].filter((id) => id.startsWith('rel:'));

describe('display settings: the size and the labels (brief function 35, criteria 77 and 78)', () => {
  it('criterion 77: the engine draws at the size ctx.display gives, and again at a new one, without a reload', () => {
    const { engine, ctx } = start({ symbolSize: 48 });
    expect(engine.symbolOptions?.symbolSize).toBe(48);
    ctx.setDisplay({ symbolSize: 20 });
    expect(engine.symbolOptions?.symbolSize).toBe(20);
  });

  it("criterion 78 (CR-0043 part A): the engine gets the user's labels by place and the arrow switch, the defaults first, and the new ones at once", () => {
    const { engine, ctx } = start();
    expect(engine.displayOptions).toMatchObject({ labelPlaces: { topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: null, below: 'name' }, directionArrow: true });
    ctx.setDisplay({ labelPlaces: { topLeft: 'speed', topRight: null, bottomLeft: null, bottomRight: 'type', below: 'name' }, directionArrow: false });
    expect(engine.displayOptions).toMatchObject({ labelPlaces: { topLeft: 'speed', topRight: null, bottomLeft: null, bottomRight: 'type', below: 'name' }, directionArrow: false });
    ctx.setDisplay({ labelPlaces: { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null, below: null }, directionArrow: true });
    expect(engine.displayOptions).toMatchObject({ labelPlaces: { below: null, topRight: null }, directionArrow: true });
  });

  it('criterion 78 (CR-0043 part A): a stored 1.7.0 list is read as places, with the arrow on', () => {
    const { engine, ctx } = start();
    ctx.setDisplay({ labels: ['speed', 'name'] });
    expect(engine.displayOptions).toMatchObject({ labelPlaces: { topRight: 'speed', below: 'name', topLeft: null }, directionArrow: true });
    ctx.setDisplay({ labels: ['name', 'direction'] });
    expect(engine.displayOptions).toMatchObject({ labelPlaces: { below: 'name', topRight: null }, directionArrow: true });
  });

  it('passes the speed vector\'s minutes, and changes them at once (criterion 82)', () => {
    const { engine, ctx } = start();
    expect(engine.displayOptions?.speedVectorSeconds).toBe(0);
    ctx.setDisplay({ speedVectorMinutes: 10 });
    expect(engine.displayOptions?.speedVectorSeconds).toBe(600);
    ctx.setDisplay({ speedVectorMinutes: 0 });
    expect(engine.displayOptions?.speedVectorSeconds).toBe(0);
  });

  it('criterion 95 (function 38): passes the speed vector in seconds, a step at a time, at once and without a new subscription', () => {
    const { engine, ctx } = start();
    const before = ctx.liveSubscriptions.length;
    for (const seconds of [5, 30, 1800, 0] as const) {
      ctx.setDisplay({ speedVectorSeconds: seconds });
      expect(engine.displayOptions?.speedVectorSeconds).toBe(seconds);
    }
    ctx.setDisplay({ speedVectorSeconds: 15 });
    expect(engine.displayOptions?.speedVectorSeconds).toBe(15); // 15 s is 1/4 minute: nothing is rounded to whole minutes
    expect(ctx.liveSubscriptions).toHaveLength(before);
  });

  it('does not subscribe again to the live picture when the settings change', () => {
    const { ctx } = start();
    const before = ctx.liveSubscriptions.length;
    ctx.setDisplay({ symbolSize: 40, labels: ['type'], speedVectorMinutes: 5, relations: { 'gmti.pairing': true } });
    expect(ctx.liveSubscriptions).toHaveLength(before);
  });
});

describe('relation lines (brief function 34, criteria 72, 73, 74, 75 and 82)', () => {
  const detection = withRelations(symbolObject(10, L.id, 15.2, 58.41), [{ kind: 'gmti.pairing', objectId: uuid(11) }]);
  const platform = symbolObject(11, L.id, 15.9, 58.95);
  const id = relationItemId('gmti.pairing', uuid(10), uuid(11));

  it('criterion 72: none until the kind is switched on (its default is off), then one yellow line, off again at once', () => {
    const { engine, ctx } = start();
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    expect(lineIds(engine)).toEqual([]);
    ctx.setDisplay({ relations: { 'gmti.pairing': true } });
    expect(lineIds(engine)).toEqual([id]);
    const line = engine.items.get(L.id)?.get(id);
    expect(line).toMatchObject({ kind: 'line', aux: true, style: { strokeColor: '#FFFF00', strokeWidth: 1 } });
    ctx.setDisplay({ relations: { 'gmti.pairing': false } });
    expect(lineIds(engine)).toEqual([]);
  });

  it('draws a kind whose default is on without any choice', () => {
    const { engine, ctx } = start(undefined, [{ ...PAIRING, defaultOn: true }]);
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    expect(lineIds(engine)).toEqual([id]);
  });

  it('criterion 104 (function 43): the line takes the colour ctx.relationLines gives, and a new colour at once, without a new subscription', () => {
    const kind: RelationKind = { ...PAIRING, line: { ...PAIRING.line, strokeColorSetting: '/pairingColour' } };
    const ctx = createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], relationKinds: [kind], display: { relations: { 'gmti.pairing': true } }, pluginSettings: { gmti: { pairingColour: '#00FF00' } } });
    const run = activate({ ctx });
    const engine = run.engine;
    if (engine === null) throw new Error('no engine');
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    const colour = () => {
      const line = engine.items.get(L.id)?.get(id);
      return line?.kind === 'line' ? line.style?.strokeColor : undefined;
    };
    expect(colour()).toBe('#00FF00');
    const subscriptions = ctx.liveSubscriptions.length;
    ctx.setPluginSettings('gmti', { pairingColour: '#FF00FF' });
    expect(colour()).toBe('#FF00FF');
    expect(ctx.liveSubscriptions).toHaveLength(subscriptions);
    ctx.setPluginSettings('gmti', { pairingColour: 'not a colour' }); // the manifest's colour is the fallback
    expect(colour()).toBe('#FFFF00');
  });

  it('function 43: width, dash and arrowhead stay those of the manifest, as ctx.relationLines gives them', () => {
    const kind: RelationKind = { ...PAIRING, line: { strokeColor: '#FFFF00', strokeWidth: 3, strokeDash: 'dash', arrowhead: 'end' } };
    const ctx = createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], relationKinds: [kind], display: { relations: { 'gmti.pairing': true } } });
    const run = activate({ ctx });
    const engine = run.engine;
    if (engine === null) throw new Error('no engine');
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    expect(engine.items.get(L.id)?.get(id)).toMatchObject({ style: { strokeColor: '#FFFF00', strokeWidth: 3, strokeDash: 'dash', arrowhead: 'end' } });
  });

  it('criterion 72: the line follows the platform when it moves, and goes when either object is deleted', async () => {
    const { engine, ctx, clock } = start({ relations: { 'gmti.pairing': true } });
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    const ends = () => {
      const line = engine.items.get(L.id)?.get(id);
      return line?.kind === 'line' ? line.positions[line.positions.length - 1] : undefined;
    };
    expect(ends()).toEqual([15.9, 58.95]);
    ctx.live.changes([event(2, { ...platform, version: 2, geometry: { type: 'Point', coordinates: [16.4, 59.2] } })]);
    clock.advance(1000);
    expect(ends()).toEqual([16.4, 59.2]);
    ctx.live.changes([event(3, null, { id: platform.id, type: 'object' })]);
    clock.advance(1000);
    await flush(); // the line goes on from the object held a moment ago until the fetch says there is no such object
    expect(lineIds(engine)).toEqual([]);
  });

  it('criterion 73: a line whose ends are at one position is not in the engine', () => {
    const { engine, ctx } = start({ relations: { 'gmti.pairing': true } });
    ctx.live.snapshot({ layers: [L], objects: [detection, symbolObject(11, L.id, 15.2, 58.41)] });
    expect(lineIds(engine)).toEqual([]);
  });

  it('criterion 74: a click on the line selects nothing, and nothing of it is a pick or a box candidate', () => {
    const { engine, ctx, result: run } = start({ relations: { 'gmti.pairing': true } });
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    expect(engine.items.get(L.id)?.get(id)?.kind).toBe('line');
    const middle = engine.projection.forward([15.55, 58.68]);
    if (middle === null) throw new Error('not on the map');
    engine.show(middle, 100);
    const view = engine.view;
    if (view === null) throw new Error('no view');
    const centre: [number, number] = [view.width / 2, view.height / 2];
    expect(run.controller.service.pick(centre, 1000)).not.toContain(id);
    expect(engine.pickCandidates(centre, 1000).map((c) => c.id)).not.toContain(id);
    expect(engine.boxCandidates().map((c) => c.id)).not.toContain(id);
  });

  it('criterion 75: the line of a faded detection is faded with it', () => {
    const { engine, ctx, result: run } = start({ relations: { 'gmti.pairing': true } });
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    const list = run.controller.service.createFadeList();
    expect(engine.items.get(L.id)?.get(id)).not.toHaveProperty('faded');
    list.set([detection.id]);
    expect(engine.items.get(L.id)?.get(id)).toMatchObject({ faded: true });
    list.clear();
    expect(engine.items.get(L.id)?.get(id)).not.toHaveProperty('faded');
  });

  it('criterion 103 (function 42): a detection that expires fades its line in the same step, and the line goes with the detection', () => {
    const { engine, ctx, clock } = start({ relations: { 'gmti.pairing': true } }, [PAIRING], [cotDataType()]);
    const expiring = withRelations(cotObject(10, L.id, 15.2, 58.41, 30_000), [{ kind: 'gmti.pairing', objectId: uuid(11) }]);
    ctx.live.snapshot({ layers: [L], objects: [expiring, platform] });
    expect(engine.items.get(L.id)?.get(id)).not.toHaveProperty('faded');
    clock.advance(31_000);
    expect(engine.items.get(L.id)?.get(expiring.id)).toMatchObject({ faded: true });
    expect(engine.items.get(L.id)?.get(id)).toMatchObject({ faded: true });
    ctx.live.changes([event(9, null, { id: expiring.id, type: 'object' })]);
    clock.advance(1000);
    expect(lineIds(engine)).toEqual([]);
  });

  it('criterion 103 (function 42): a faded platform with a bright detection leaves the line bright', () => {
    const { engine, ctx, result: run } = start({ relations: { 'gmti.pairing': true } });
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    const list = run.controller.service.createFadeList();
    list.set([platform.id]);
    expect(engine.items.get(L.id)?.get(platform.id)).toMatchObject({ faded: true });
    expect(engine.items.get(L.id)?.get(id)).not.toHaveProperty('faded');
  });

  it('a new snapshot draws the lines again, and a line to an object of a hidden layer goes', async () => {
    const { engine, ctx, result: run } = start({ relations: { 'gmti.pairing': true } });
    const other = layer(2);
    const farPlatform = symbolObject(11, other.id, 15.9, 58.95);
    ctx.live.snapshot({ layers: [L, other], objects: [detection, farPlatform] });
    expect(lineIds(engine)).toEqual([id]);
    run.controller.service.setLayerVisible(other.id, false);
    expect(lineIds(engine)).toEqual([]);
    run.controller.service.setLayerVisible(other.id, true);
    expect(lineIds(engine)).toEqual([id]);
    ctx.live.snapshot({ layers: [L, other], objects: [detection, farPlatform] });
    expect(lineIds(engine)).toEqual([id]);
    ctx.live.snapshot({ layers: [L, other], objects: [detection] });
    await flush(); // the platform left the area: its line goes on from the object held a moment ago until the fetch says there is no such object
    expect(lineIds(engine)).toEqual([]);
  });

  it('a kind that is no longer declared draws nothing (its switch is not in ctx.display)', () => {
    const { engine, ctx } = start({ relations: { 'gmti.pairing': true } }, []);
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    expect(lineIds(engine)).toEqual([]);
  });
});

describe('display classes (brief function 40, criterion 101; owner, QN B and Q58 A)', () => {
  const ring = (lon: number, lat: number): Position[] => [[lon, lat], [lon + 0.2, lat], [lon + 0.2, lat + 0.2], [lon, lat + 0.2], [lon, lat]];
  const shape = (n: number, lon: number, extra: Partial<MapObject> = {}) => object(n, L.id, 'core.shape', { type: 'Polygon', coordinates: [ring(lon, 58)] }, extra);
  const dwell = shape(20, 14.0, { displayClass: 'dwell-area' });
  const coverage = shape(21, 15.0, { displayClass: 'sensor-coverage' });
  const plain = shape(22, 16.0);
  /** Something to click on, at the shape's first corner. */
  const corner = (o: MapObject): Position => (o.geometry.type === 'Polygon' ? (o.geometry.coordinates[0]?.[0] ?? [0, 0]) : [0, 0]);

  it('criterion 101: switching "Dwell areas" off takes its shapes and overlay areas off the map and leaves the others, and on shows both again', () => {
    const { engine, ctx, result: run } = start();
    ctx.live.snapshot({ layers: [L], objects: [dwell, coverage, plain] });
    const overlay = run.controller.service.createOverlay();
    const area = (displayClass?: 'dwell-area' | 'sensor-coverage') => ({ kind: 'area' as const, rings: [ring(14, 59)], ...(displayClass === undefined ? {} : { displayClass }) });
    overlay.set([area('dwell-area'), area('sensor-coverage'), area()]);
    const overlayCount = () => [...engine.overlays.values()].flat().length;
    expect(engine.idsIn(L.id)).toEqual([dwell.id, coverage.id, plain.id]);
    expect(overlayCount()).toBe(3);
    const subscriptions = ctx.liveSubscriptions.length;
    ctx.setDisplay({ classes: { 'dwell-area': false, 'sensor-coverage': true } });
    expect(engine.idsIn(L.id)).toEqual([coverage.id, plain.id]);
    expect(overlayCount()).toBe(2);
    expect(ctx.liveSubscriptions).toHaveLength(subscriptions); // no new subscription
    ctx.setDisplay({ classes: { 'dwell-area': true, 'sensor-coverage': true } });
    expect(engine.idsIn(L.id).sort()).toEqual([dwell.id, coverage.id, plain.id].sort());
    expect(overlayCount()).toBe(3);
    ctx.setDisplay({ classes: { 'dwell-area': true, 'sensor-coverage': false } });
    expect(engine.idsIn(L.id).sort()).toEqual([dwell.id, plain.id].sort());
    expect(overlayCount()).toBe(2);
  });

  it('criterion 101: a hidden shape is not picked by a click or a box, keeps its id in the selection, and is drawn and selectable again when switched on', () => {
    const { engine, ctx, result: run } = start();
    const map = run.controller.service;
    ctx.live.snapshot({ layers: [L], objects: [dwell, plain] });
    const centre = engine.projection.forward([15, 58.1]);
    if (centre === null) throw new Error('not on the map');
    engine.show(centre, 1000);
    map.selection.set([dwell.id]);
    expect(engine.highlighted).toEqual([dwell.id]);
    ctx.setDisplay({ classes: { 'dwell-area': false, 'sensor-coverage': true } });
    expect(map.selection.value).toEqual([dwell.id]); // the id stays
    expect(engine.highlighted).toEqual([]);
    expect(map.pick(engine.pixelOf(corner(dwell)))).toEqual([]);
    expect(map.pick(engine.pixelOf(corner(plain)))).toEqual([plain.id]);
    engine.selectBox([0, 0], [1600, 1200]);
    expect(map.selection.value).toEqual([plain.id]);
    ctx.setDisplay({ classes: { 'dwell-area': true, 'sensor-coverage': true } });
    expect(map.pick(engine.pixelOf(corner(dwell)))).toEqual([dwell.id]);
    expect(engine.pickCandidates(engine.pixelOf(corner(dwell)), 10).map((c) => c.id)).toContain(dwell.id);
  });

  it('a user with no setting of their own sees both classes, and an object that arrives while its class is off is not drawn until it is on', () => {
    const { engine, ctx, clock } = start();
    ctx.live.snapshot({ layers: [L], objects: [dwell, coverage] });
    expect(engine.idsIn(L.id)).toHaveLength(2);
    ctx.setDisplay({ classes: { 'dwell-area': false, 'sensor-coverage': true } });
    ctx.live.changes([event(5, shape(23, 17.0, { displayClass: 'dwell-area' })), event(6, { ...coverage, version: 2 })]);
    clock.advance(1000);
    expect(engine.idsIn(L.id)).toEqual([coverage.id]);
    ctx.setDisplay({ classes: { 'dwell-area': true, 'sensor-coverage': true } });
    expect(engine.idsIn(L.id)).toHaveLength(3);
  });

  it('a relation line whose carrying object is of a switched-off class goes with it, and comes back when it is switched on', () => {
    const { engine, ctx } = start({ relations: { 'gmti.pairing': true } });
    const carrier = withRelations(symbolObject(30, L.id, 15.2, 58.41), [{ kind: 'gmti.pairing', objectId: uuid(31) }]);
    const hidden = { ...carrier, displayClass: 'sensor-coverage' as const };
    ctx.live.snapshot({ layers: [L], objects: [hidden, symbolObject(31, L.id, 15.9, 58.95)] });
    expect(lineIds(engine)).toHaveLength(1);
    ctx.setDisplay({ relations: { 'gmti.pairing': true }, classes: { 'dwell-area': true, 'sensor-coverage': false } });
    expect(lineIds(engine)).toEqual([]);
    ctx.setDisplay({ relations: { 'gmti.pairing': true }, classes: { 'dwell-area': true, 'sensor-coverage': true } });
    expect(lineIds(engine)).toHaveLength(1);
  });

  it('an object of a switched-off class that expires is not drawn faded either', () => {
    const { engine, ctx, clock } = start(undefined, [PAIRING], [cotDataType()]);
    const expiring = { ...cotObject(40, L.id, 15.2, 58.41, 30_000), displayClass: 'dwell-area' as const };
    ctx.live.snapshot({ layers: [L], objects: [expiring] });
    ctx.setDisplay({ classes: { 'dwell-area': false, 'sensor-coverage': true } });
    expect(engine.idsIn(L.id)).toEqual([]);
    clock.advance(31_000);
    expect(engine.idsIn(L.id)).toEqual([]);
    ctx.setDisplay({ classes: { 'dwell-area': true, 'sensor-coverage': true } });
    expect(engine.items.get(L.id)?.get(expiring.id)).toMatchObject({ faded: true });
  });

  it('nothing is deleted: the relation line between two objects of no class stays while both classes are off', () => {
    const detection = withRelations(symbolObject(10, L.id, 15.2, 58.41), [{ kind: 'gmti.pairing', objectId: uuid(11) }]);
    const platform = symbolObject(11, L.id, 15.9, 58.95);
    const { engine, ctx } = start({ relations: { 'gmti.pairing': true } });
    ctx.live.snapshot({ layers: [L], objects: [detection, platform, dwell] });
    ctx.setDisplay({ relations: { 'gmti.pairing': true }, classes: { 'dwell-area': false, 'sensor-coverage': false } });
    expect(lineIds(engine)).toEqual([relationItemId('gmti.pairing', uuid(10), uuid(11))]);
  });
});

describe('sensor reports at the level of the plugin (brief function 39, criteria 96 and 98)', () => {
  const DETECTION: Omit<DataType, 'behaviour'> = { id: 'gmti.detection', name: 'GMTI detection', declaredBy: 'gmti', defaults: {}, sensorReport: true };
  const detection = { ...withRelations(symbolObject(10, L.id, 15.2, 58.41), [{ kind: 'gmti.pairing', objectId: uuid(11) }]), dataType: 'gmti.detection' };
  const platform = symbolObject(11, L.id, 15.9, 58.95);

  it('flags the objects of a data type that declares sensorReport for the engine, and only them, and keeps the pairing line of a detection', () => {
    const { engine, ctx } = start({ relations: { 'gmti.pairing': true } }, [PAIRING], [DETECTION]);
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    expect(engine.items.get(L.id)?.get(detection.id)).toMatchObject({ kind: 'symbol', sensorReport: true });
    expect(engine.items.get(L.id)?.get(platform.id)).not.toHaveProperty('sensorReport');
    expect(lineIds(engine)).toEqual([relationItemId('gmti.pairing', uuid(10), uuid(11))]);
  });

  it('flags nothing without the flag, or with a data type nobody declared', () => {
    for (const types of [[{ ...DETECTION, sensorReport: false }], [] as Omit<DataType, 'behaviour'>[]]) {
      const { engine, ctx } = start(undefined, [PAIRING], types);
      ctx.live.snapshot({ layers: [L], objects: [detection] });
      expect(engine.items.get(L.id)?.get(detection.id)).not.toHaveProperty('sensorReport');
    }
  });
});

describe('relation lines to far ends (brief function 41, criterion 102; owner, Q59 B)', () => {
  const detection = withRelations(symbolObject(10, L.id, 15.2, 58.41), [{ kind: 'gmti.pairing', objectId: uuid(11) }]);
  const platform = symbolObject(11, L.id, 15.9, 58.95);
  const id = relationItemId('gmti.pairing', uuid(10), uuid(11));
  const endOf = (engine: ReturnType<typeof start>['engine']) => {
    const line = engine.items.get(L.id)?.get(id);
    return line?.kind === 'line' ? line.positions[line.positions.length - 1] : undefined;
  };
  const begin = (objects: readonly MapObject[] = [platform]) => {
    const run = start({ relations: { 'gmti.pairing': true } });
    run.ctx.setServerObjects(objects);
    const get = vi.spyOn(run.ctx.objects, 'get');
    return { ...run, get };
  };

  it('keeps the line when the platform leaves the area, at once and from the object the map held, with no gap while the fetch is on its way', async () => {
    const { engine, ctx } = begin();
    ctx.live.snapshot({ layers: [L], objects: [detection, platform] });
    expect(endOf(engine)).toEqual([15.9, 58.95]);
    ctx.live.snapshot({ layers: [L], objects: [detection] }); // the area moved: the platform is not in the picture, but it exists
    expect(endOf(engine)).toEqual([15.9, 58.95]);
    await flush();
    expect(endOf(engine)).toEqual([15.9, 58.95]);
  });

  it('draws the line to a platform the live picture does not hold, from the detection to the fetched position', async () => {
    const { engine, ctx } = begin();
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    expect(lineIds(engine)).toEqual([]); // the fetch is on its way
    await flush();
    expect(lineIds(engine)).toEqual([id]);
    expect(endOf(engine)).toEqual([15.9, 58.95]);
  });

  it('follows the next move of the far end within about 2 s, and goes when it is deleted', async () => {
    const { engine, ctx, clock } = begin();
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    await flush();
    ctx.setServerObjects([{ ...platform, version: 2, geometry: { type: 'Point', coordinates: [16.4, 59.2] } }]);
    clock.advance(1000);
    await flush();
    expect(endOf(engine)).toEqual([15.9, 58.95]); // not asked yet
    clock.advance(1000);
    await flush();
    expect(endOf(engine)).toEqual([16.4, 59.2]);
    ctx.setServerObjects([]);
    clock.advance(2000);
    await flush();
    expect(lineIds(engine)).toEqual([]);
  });

  it('fetches once for an id the server does not return, draws no line, and again only at the 2 s turn', async () => {
    const { engine, ctx, clock, get } = begin([]);
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    await flush();
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    ctx.live.changes([event(5, { ...detection, version: 2 })]);
    clock.advance(0);
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    expect(lineIds(engine)).toEqual([]);
    clock.advance(2000);
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('forgets the far end when no held object names it any more: the line goes, and nothing is fetched again', async () => {
    const { engine, ctx, clock, get } = begin();
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    await flush();
    expect(lineIds(engine)).toEqual([id]);
    ctx.live.changes([event(5, null, { id: detection.id, type: 'object' })]);
    clock.advance(0);
    await flush();
    expect(lineIds(engine)).toEqual([]);
    const calls = get.mock.calls.length;
    clock.advance(10_000);
    await flush();
    expect(get).toHaveBeenCalledTimes(calls);
  });

  it('keeps nothing of a far end that was forgotten: a carrier that comes back is not drawn to the old position, nor to one fetched after it went', async () => {
    const { engine, ctx, clock } = begin();
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    await flush();
    expect(lineIds(engine)).toEqual([id]);
    ctx.live.changes([event(5, null, { id: detection.id, type: 'object' })]);
    clock.advance(0);
    await flush();
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    clock.advance(0);
    expect(lineIds(engine)).toEqual([]); // not from the position held before: fetched again first
    await flush();
    expect(lineIds(engine)).toEqual([id]);
    // A fetch that is still on its way when the carrier goes is not kept either.
    ctx.live.changes([event(7, null, { id: detection.id, type: 'object' })]);
    clock.advance(0);
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    clock.advance(0);
    ctx.live.changes([event(9, null, { id: detection.id, type: 'object' })]);
    clock.advance(0);
    await flush();
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    clock.advance(0);
    expect(lineIds(engine)).toEqual([]);
    await flush();
    expect(lineIds(engine)).toEqual([id]);
  });

  it('is no far end once the live picture holds it: the line stays, from the held object, and is not fetched again', async () => {
    const { engine, ctx, clock, get } = begin();
    ctx.live.snapshot({ layers: [L], objects: [detection] });
    await flush();
    ctx.live.changes([event(5, platform)]);
    clock.advance(0);
    await flush();
    expect(lineIds(engine)).toEqual([id]);
    const calls = get.mock.calls.length;
    clock.advance(10_000);
    await flush();
    expect(get).toHaveBeenCalledTimes(calls);
  });

  it('fetches nothing for a kind that is switched off, and draws no line', async () => {
    const run = start({ relations: { 'gmti.pairing': false } });
    run.ctx.setServerObjects([platform]);
    const get = vi.spyOn(run.ctx.objects, 'get');
    run.ctx.live.snapshot({ layers: [L], objects: [detection] });
    await flush();
    expect(get).not.toHaveBeenCalled();
    expect(lineIds(run.engine)).toEqual([]);
    run.ctx.setDisplay({ relations: { 'gmti.pairing': true } });
    await flush();
    expect(lineIds(run.engine)).toEqual([id]);
  });

  it('holds at most 1 000 far ends, draws the first 1 000 lines, and logs one warning', async () => {
    const targets = Array.from({ length: 1001 }, (_, i) => symbolObject(2000 + i, L.id, 16 + (i % 50) / 100, 59 + Math.floor(i / 50) / 100));
    const carrier = withRelations(symbolObject(10, L.id, 15.2, 58.41), targets.map((t) => ({ kind: 'gmti.pairing', objectId: t.id })));
    const { engine, ctx, clock, get } = begin(targets);
    const warn = vi.spyOn(ctx.log, 'warn');
    ctx.live.snapshot({ layers: [L], objects: [carrier] });
    await flush();
    expect(lineIds(engine)).toHaveLength(1000);
    expect(get.mock.calls.every(([ids]) => ids.length <= 1000)).toBe(true);
    clock.advance(2000);
    await flush();
    expect(warn.mock.calls.filter(([text]) => text.includes('far ends'))).toHaveLength(1);
  });
});
