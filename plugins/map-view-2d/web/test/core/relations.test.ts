import { describe, expect, it } from 'vitest';
import type { MapObject, Position, Relation, RelationKind } from '@emc2/plugin-sdk';
import { distance } from '../../src/core/geodesic.ts';
import { anchorOf, relationItemId, relationLines, relationEnds, type RelationInput } from '../../src/core/relations.ts';
import { layer, object, symbolObject, uuid } from '../fixtures.ts';

const L = layer(1);
const PAIRING: RelationKind = {
  id: 'gmti.pairing', label: 'GMTI Pairing', defaultOn: false,
  line: { strokeColor: '#FFFF00', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none' },
};
const SEEN: RelationKind = {
  id: 'cot.seen', label: 'Seen', defaultOn: true,
  line: { strokeColor: '#00FF00', strokeWidth: 3, strokeDash: 'dash', arrowhead: 'end' },
};

function withRelations(o: MapObject, relations: readonly Relation[]): MapObject {
  return { ...o, relations };
}

function input(objects: readonly MapObject[], over: Partial<RelationInput> = {}): RelationInput {
  return {
    objects: new Map(objects.map((o) => [o.id, o])),
    kinds: [PAIRING, SEEN],
    on: () => true,
    shown: () => true,
    faded: () => false,
    ...over,
  };
}

const detection = (n: number, at: Position, relations: readonly Relation[] = []) => withRelations(symbolObject(n, L.id, at[0], at[1]), relations);
const rel = (kind: string, n: number): Relation => ({ kind, objectId: uuid(n) });

describe('relation lines (brief function 34, criteria 72, 73 and 75)', () => {
  it('criterion 72: a detection paired with a platform draws one line in the kind\'s style, between their positions (latitude differs from longitude)', () => {
    const lines = relationLines(input([detection(10, [15.2, 58.41], [rel('gmti.pairing', 11)]), detection(11, [15.9, 58.95])]));
    expect(lines.size).toBe(1);
    const line = lines.get(relationItemId('gmti.pairing', uuid(10), uuid(11)));
    expect(line).toMatchObject({ kind: 'line', aux: true, layerId: L.id, style: { strokeColor: '#FFFF00', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none' } });
    if (line?.kind !== 'line') return;
    expect(line.positions[0]).toEqual([15.2, 58.41]);
    expect(line.positions[line.positions.length - 1]).toEqual([15.9, 58.95]);
    expect(line.faded).toBeUndefined();
  });

  it('is a geodesic: a long line is densified along the great circle', () => {
    const lines = relationLines(input([detection(10, [10, 60], [rel('gmti.pairing', 11)]), detection(11, [30, 60])]));
    const line = lines.values().next().value;
    if (line?.kind !== 'line') throw new Error('no line');
    expect(line.positions.length).toBeGreaterThan(5);
    expect(Math.max(...line.positions.map((p) => p[1]))).toBeGreaterThan(60.3); // the great circle bulges north of the parallel (60.38 at the middle)
  });

  it('draws none for a kind that is switched off, and one kind\'s lines only while it is on', () => {
    const objects = [detection(10, [15.2, 58.41], [rel('gmti.pairing', 11), rel('cot.seen', 11)]), detection(11, [15.9, 58.95])];
    expect(relationLines(input(objects, { on: () => false })).size).toBe(0);
    const only = relationLines(input(objects, { on: (kind) => kind === 'cot.seen' }));
    expect([...only.keys()]).toEqual([relationItemId('cot.seen', uuid(10), uuid(11))]);
    expect(only.values().next().value).toMatchObject({ style: { strokeDash: 'dash', arrowhead: 'end', strokeWidth: 3 } });
  });

  it('criterion 73: one line for two objects that relate to each other in one kind, a line per kind otherwise', () => {
    const a = detection(10, [15, 58], [rel('gmti.pairing', 11), rel('cot.seen', 11)]);
    const b = detection(11, [16, 58.5], [rel('gmti.pairing', 10)]);
    const lines = relationLines(input([b, a]));
    expect([...lines.keys()].sort()).toEqual([relationItemId('cot.seen', uuid(10), uuid(11)), relationItemId('gmti.pairing', uuid(10), uuid(11))].sort());
  });

  it('criterion 73: an undeclared kind, an object the map does not hold, a hidden one and the object itself draw none', () => {
    const a = detection(10, [15, 58], [rel('other.kind', 11), rel('gmti.pairing', 99), rel('gmti.pairing', 12), rel('gmti.pairing', 10)]);
    const hidden = detection(12, [16, 58.5]);
    const lines = relationLines(input([a, detection(11, [16, 58]), hidden], { shown: (o) => o.id !== hidden.id }));
    expect(lines.size).toBe(0);
  });

  it('criterion 73: a line of zero length is not drawn (the ACA\'s R6)', () => {
    const lines = relationLines(input([detection(10, [15.2, 58.41], [rel('gmti.pairing', 11)]), detection(11, [15.2, 58.41])]));
    expect(lines.size).toBe(0);
  });

  it('criterion 103 (function 42): a line has the opacity of its carrier: faded with the detection, bright when only the platform is faded', () => {
    const objects = [detection(10, [15, 58], [rel('gmti.pairing', 11)]), detection(11, [16, 58.5])];
    expect(relationLines(input(objects, { faded: (id) => id === uuid(10) })).values().next().value).toMatchObject({ faded: true });
    expect(relationLines(input(objects, { faded: (id) => id === uuid(11) })).values().next().value).not.toHaveProperty('faded');
    expect(relationLines(input(objects)).values().next().value).not.toHaveProperty('faded');
  });

  it('criterion 103 (function 42): when both objects carry the relation the line is faded only when both are', () => {
    const objects = [detection(10, [15, 58], [rel('gmti.pairing', 11)]), detection(11, [16, 58.5], [rel('gmti.pairing', 10)])];
    const fadedWith = (...ids: number[]) => relationLines(input(objects, { faded: (id) => ids.some((n) => uuid(n) === id) }));
    expect(fadedWith(10).values().next().value).not.toHaveProperty('faded');
    expect(fadedWith(11).values().next().value).not.toHaveProperty('faded');
    expect(fadedWith(10, 11).values().next().value).toMatchObject({ faded: true });
    expect(fadedWith(10, 11).size).toBe(1);
  });

  it('criterion 107 (function 46): a line has the opacity of its carrier\'s step, as an opacity; of a pair that carry it both ways, the higher', () => {
    const one = [detection(10, [15, 58], [rel('gmti.pairing', 11)]), detection(11, [16, 58.5])];
    const steps = (map: Record<number, number>) => (id: string) => Object.entries(map).find(([n]) => uuid(Number(n)) === id)?.[1];
    expect(relationLines(input(one, { opacity: steps({ 10: 0.45 }) })).values().next().value).toMatchObject({ opacity: 0.45 });
    expect(relationLines(input(one, { opacity: steps({ 10: 0.45 }) })).values().next().value).not.toHaveProperty('faded');
    expect(relationLines(input(one, { opacity: steps({ 10: 1 }) })).values().next().value).not.toHaveProperty('opacity'); // a step that is full is not an opacity
    expect(relationLines(input(one, { opacity: steps({ 11: 0.2 }) })).values().next().value).not.toHaveProperty('opacity'); // only the platform steps
    const both = [detection(10, [15, 58], [rel('gmti.pairing', 11)]), detection(11, [16, 58.5], [rel('gmti.pairing', 10)])];
    expect(relationLines(input(both, { opacity: steps({ 10: 0.3, 11: 0.7 }) })).values().next().value).toMatchObject({ opacity: 0.7 });
    expect(relationLines(input(both, { opacity: steps({ 10: 0.3 }), faded: (id) => id === uuid(11) })).values().next().value).toMatchObject({ opacity: 0.4 }); // the other end is faded by the list or expiry
  });

  it('criterion 102 (function 41): a line runs to a far end the map does not hold, from the carrier, and to no id that was not fetched', () => {
    const carrier = detection(10, [15.2, 58.41], [rel('gmti.pairing', 11), rel('gmti.pairing', 12)]);
    const far = detection(11, [16.9, 59.6]); // not in `objects`
    const lines = relationLines(input([carrier], { farEnds: new Map([[far.id, far]]) }));
    expect([...lines.keys()]).toEqual([relationItemId('gmti.pairing', uuid(10), uuid(11))]); // 12 was not fetched: no line
    const line = [...lines.values()][0];
    if (line?.kind !== 'line') throw new Error('no line');
    expect(line.positions[0]).toEqual([15.2, 58.41]);
    expect(line.positions[line.positions.length - 1]).toEqual([16.9, 59.6]);
  });

  it('criterion 102: a far end that relates back still gets its line, from the carrier, whichever id is smaller; its fading does not matter', () => {
    const carrier = detection(11, [15.2, 58.41], [rel('gmti.pairing', 10)]);
    const far = detection(10, [16.9, 59.6], [rel('gmti.pairing', 11)]); // the smaller id, and a carrier too
    const lines = relationLines(input([carrier], { farEnds: new Map([[far.id, far]]), faded: (id) => id === uuid(10) }));
    expect([...lines.keys()]).toEqual([relationItemId('gmti.pairing', uuid(11), uuid(10))]);
    expect([...lines.values()][0]).not.toHaveProperty('faded');
  });

  it('wants the ids that drawn relations name and the map does not hold: not held ones, not those of a kind that is off, a layer that is hidden or itself', () => {
    const near = detection(11, [16, 58.5]);
    const carrier = detection(10, [15, 58], [rel('gmti.pairing', 11), rel('gmti.pairing', 12), rel('cot.seen', 13), rel('gmti.pairing', 10)]);
    const hidden = detection(20, [15, 58], [rel('gmti.pairing', 21)]);
    const ends = relationEnds(input([carrier, near, hidden], { on: (k) => k === 'gmti.pairing', shown: (o) => o.id !== hidden.id }));
    expect([...ends.far]).toEqual([uuid(12)]);
    expect([...ends.near.keys()]).toEqual([uuid(11)]); // the held target, for the far ends' sake
    expect(relationEnds(input([carrier], { on: () => false })).far.size).toBe(0);
  });

  it('is drawn in the carrying object\'s layer, whichever layer the other is in', () => {
    const other = layer(2);
    const a = detection(10, [15, 58], [rel('gmti.pairing', 11)]);
    const b = withRelations(symbolObject(11, other.id, 16, 58.5), []);
    expect(relationLines(input([a, b])).values().next().value).toMatchObject({ layerId: L.id });
  });

  it('continues past 180 degrees as one short line', () => {
    const lines = relationLines(input([detection(10, [179.5, 10], [rel('gmti.pairing', 11)]), detection(11, [-179.5, 10.5])]));
    const line = lines.values().next().value;
    if (line?.kind !== 'line') throw new Error('no line');
    const lons = line.positions.map((p) => p[0]);
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(2);
  });
});

describe('where an object is drawn, for the ends of a line (brief function 34)', () => {
  it('is the point of a point object, the first control point of a graphic', () => {
    expect(anchorOf(symbolObject(10, L.id, 15, 58))).toEqual([15, 58]);
    expect(anchorOf(object(11, L.id, 'core.shape', { type: 'Point', coordinates: [14, 57] }))).toEqual([14, 57]);
    expect(anchorOf(object(12, L.id, 'core.multipoint', { type: 'MultiPoint', coordinates: [[10, 50], [11, 51]] }, { symbol: { standard: 'APP-6D', sidc: '30031000001101000000' } }))).toEqual([10, 50]);
  });

  it('is the middle of a line along its length and an area\'s interior point', () => {
    const middle = anchorOf(object(10, L.id, 'core.shape', { type: 'LineString', coordinates: [[10, 58], [12, 58]] }));
    expect(middle?.[0]).toBeCloseTo(11, 1);
    expect(middle?.[1]).toBeCloseTo(58, 1);
    const inside = anchorOf(object(11, L.id, 'core.shape', { type: 'Polygon', coordinates: [[[10, 58], [12, 58], [12, 60], [10, 60], [10, 58]]] }));
    expect(inside?.[0]).toBeCloseTo(11, 1);
    expect(inside?.[1]).toBeCloseTo(59, 1);
  });

  it('puts the end of a line to a ring with a hole at the widest stretch outside the hole', () => {
    const outer: Position[] = [[10, 58], [14, 58], [14, 60], [10, 60], [10, 58]];
    const hole: Position[] = [[10.5, 58.5], [10.5, 59.5], [13.5, 59.5], [13.5, 58.5], [10.5, 58.5]];
    const point = anchorOf(object(10, L.id, 'core.shape', { type: 'Polygon', coordinates: [outer, hole] }));
    // Half way up (y 59) the stretches are 10 to 10.5 and 13.5 to 14: the interior point is on one of them, not in the hole.
    expect(point?.[0] ?? 12).toSatisfy((x: number) => x < 10.5 || x > 13.5);
  });

  it('is the middle of an arc band\'s area and null for an object without a position', () => {
    const point = anchorOf(object(10, L.id, 'core.shape', { type: 'ArcBand', center: [15.2, 58.41], innerRadius: 25_000, outerRadius: 35_000, startBearing: 80, endBearing: 100 }));
    expect(point).not.toBeNull();
    expect(distance(point as Position, [15.2, 58.41])).toBeGreaterThan(24_000);
    expect(anchorOf(object(11, L.id, 'core.shape', { type: 'LineString', coordinates: [] }))).toBeNull();
  });
});
