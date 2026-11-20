// SDK 1.4.0 part 3 (CR-0030 part 3, CR-0031): field sets, vessel symbols and relations in the web
// SDK: the helpers, changeRequests.withFieldSets, and the fakes' checks (model rules 17 and 18).
import { describe, expect, it } from 'vitest';
import {
  changeRequests, MAX_RELATIONS, parseVesselSidc, replaceRelations, vesselSidc,
  type FieldSet, type MapObject, type MapObjectContent, type RelationKind,
} from '../src/index.ts';
import { appliedEvent, createFakeContext, createFakeSymbolService, FAKE_VESSEL_GROUPS } from '../src/testing/index.ts';

const A = '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e21';
const B = '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e22';
const C = '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e23';
const UNIT: FieldSet = { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['callsign'] };
const PAIRING: RelationKind = { id: 'gmti.pairing', label: 'GMTI Pairing', line: { strokeColor: '#FFFF00', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none' }, defaultOn: false };

// lon differs from lat, so a swapped order would show
const content: MapObjectContent = {
  type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01',
  geometry: { type: 'Point', coordinates: [15.2003, 58.4108] }, symbol: { standard: 'APP-6D', sidc: '10030100001101000000' },
  label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
};
const stored = (extra: Partial<MapObjectContent>): MapObject => ({
  ...content, ...extra, id: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e30', version: 4,
  meta: { created: { at: '2026-11-06T09:00:00Z', by: { plugin: 'removed' } }, modified: { at: '2026-11-06T09:00:00Z', by: { plugin: 'removed' } } },
});

describe('relations (CR-0031)', () => {
  it('replaceRelations keeps other kinds and lists each id once', () => {
    const list = [{ kind: 'gmti.pairing', objectId: A }, { kind: 'other.link', objectId: C }, { kind: 'gmti.pairing', objectId: B }];
    expect(replaceRelations(list, 'gmti.pairing', [C, B, C])).toEqual([
      { kind: 'other.link', objectId: C }, { kind: 'gmti.pairing', objectId: C }, { kind: 'gmti.pairing', objectId: B },
    ]);
    expect(replaceRelations(undefined, 'gmti.pairing', [])).toEqual([]);
    const ids = Array.from({ length: MAX_RELATIONS + 1 }, (_, i) => `0192a5c4-3b1e-7c2d-9f00-${String(i).padStart(12, '0')}`);
    expect(() => replaceRelations([], 'gmti.pairing', ids)).toThrow('at most 1024');
  });

  it('the fake rejects a new relation of an undeclared kind, and lets a stored entry pass', async () => {
    const ctx = createFakeContext({ pluginId: 'simulator', relationKinds: [PAIRING] });
    expect(ctx.relationKinds).toEqual([PAIRING]);
    const bad = await ctx.changes.submit(changeRequests.createObject(A, { ...content, relations: [{ kind: 'gmti.pairing', objectId: B }, { kind: 'removed.link', objectId: C }] }));
    expect(bad.outcome === 'rejected' ? bad.rejection.details?.[0]?.path : null).toBe('/data/relations/1/kind');
    const platform = stored({ relations: [{ kind: 'removed.link', objectId: C }] });
    ctx.live.snapshot({ layers: [], objects: [platform] });
    const kept = await ctx.changes.submit(changeRequests.updateObject(platform, { ...content, relations: [{ kind: 'removed.link', objectId: C }, { kind: 'gmti.pairing', objectId: A }] }));
    expect(kept.outcome).toBe('applied');
    const added = await ctx.changes.submit(changeRequests.updateObject(platform, { ...content, relations: [{ kind: 'removed.link', objectId: A }] }));
    expect(added.outcome).toBe('rejected'); // a new entry of the undeclared kind
  });
});

describe('field sets (ADR-0050)', () => {
  it('withFieldSets adds sets once to an object create or update, and refuses others', () => {
    const object = stored({ fieldSets: ['cot.unit'] });
    const update = changeRequests.withFieldSets(changeRequests.updateObject(object, { ...content, fieldSets: ['cot.unit'] }), ['ais.ship', 'cot.unit']);
    expect(update).toMatchObject({ operation: 'update', data: { fieldSets: ['cot.unit', 'ais.ship'] } });
    const create = changeRequests.withFieldSets(changeRequests.createObject(A, content), ['cot.unit']);
    expect(create).toMatchObject({ operation: 'create', data: { fieldSets: ['cot.unit'] } });
    expect(changeRequests.withFieldSets(create, [])).toBe(create);
    expect(() => changeRequests.withFieldSets(changeRequests.deleteObject(object), ['cot.unit'])).toThrow('field sets');
    expect(() => changeRequests.withFieldSets(create, Array.from({ length: 64 }, (_, i) => `p${i}.set`))).toThrow('at most 64');
  });

  it('the fake rejects an undeclared set it adds, keeps a stored one, and adds listed sets on update', async () => {
    const ctx = createFakeContext({ pluginId: 'draw-symbols', fieldSets: [UNIT] });
    expect(ctx.fieldSets).toEqual([UNIT]);
    const bad = await ctx.changes.submit(changeRequests.withFieldSets(changeRequests.createObject(A, content), ['cot.unit', 'removed.unit']));
    expect(bad.outcome === 'rejected' ? bad.rejection.details?.[0]?.path : null).toBe('/data/fieldSets/1');
    const object = stored({ fieldSets: ['removed.unit'] });
    ctx.live.snapshot({ layers: [], objects: [object] });
    const update = await ctx.changes.submit(changeRequests.withFieldSets(changeRequests.updateObject(object, content), ['cot.unit']));
    expect(update.outcome === 'applied' ? (update.event.state as MapObject).fieldSets : null).toEqual(['removed.unit', 'cot.unit']);
    const event = appliedEvent({ ...changeRequests.updateObject(object, content), requestId: 'r', source: { plugin: 'draw-symbols' } } as never, 1, content.label, object);
    expect((event.state as MapObject).fieldSets).toEqual(['removed.unit']); // absent keeps the stored list
  });
});

describe('vessel symbols (ADR-0047)', () => {
  it('have four digits: context, identity, ship type', () => {
    expect(vesselSidc({ context: 0, identity: 4, shipType: 70 })).toBe('0470');
    expect(vesselSidc({ context: 2, identity: 6, shipType: 7 })).toBe('2607');
    expect(parseVesselSidc('0470')).toEqual({ context: 0, identity: 4, shipType: 70 });
    expect(parseVesselSidc('3470')).toBeNull();
    expect(parseVesselSidc('470')).toBeNull();
    expect(() => vesselSidc({ context: 0, identity: 4, shipType: 100 })).toThrow('0 to 99');
  });

  it('the fake symbol service validates and renders them, and every ship type is in one group', () => {
    const symbols = createFakeSymbolService();
    expect(symbols.validate('vessel', '0470')).toEqual({ valid: true });
    expect(symbols.validate('vessel', '3470').valid).toBe(false);
    expect(symbols.render({ standard: 'vessel', sidc: '0470', modifiers: { direction: 212.5, speed: 6.4 }, size: 32 }).width).toBe(32);
    const groups = symbols.vesselGroups?.() ?? [];
    expect(groups).toBe(FAKE_VESSEL_GROUPS);
    const codes = groups.flatMap((g) => g.shipTypes.map((s) => s.code)).sort((a, b) => a - b);
    expect(codes).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(groups.find((g) => g.shipTypes.some((s) => s.code === 70))?.id).toBe('cargo');
    expect(groups.every((g) => /^#[0-9A-F]{6}$/i.test(g.color))).toBe(true);
  });
});
