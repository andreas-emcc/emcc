// SDK 1.5.0 part 1 (CR-0038): a data type's field sets, the types users do not choose, and the
// fake store adding a data type's sets (model rule 21).
import { describe, expect, it } from 'vitest';
import { changeRequests, choosableDataTypes, withDataTypeSets, type MapObject, type MapObjectContent } from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

const LAYER = '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01';
// lon differs from lat, so a swapped order would show
const content = (dataType: string, extra: Partial<MapObjectContent> = {}): MapObjectContent => ({
  type: 'core.symbol', dataType, dataSource: 'manual', layerId: LAYER,
  geometry: { type: 'Point', coordinates: [18.0723, 59.3311] }, symbol: { standard: 'APP-6D', sidc: '10061000001211000000' },
  label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' }, ...extra,
});

const ctx = () => createFakeContext({
  fieldSets: [
    { id: 'ais.ship', plugin: 'ais', name: 'ship', label: 'AIS ship', fields: ['mmsi'] },
    { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['callsign'] },
  ],
  dataTypes: [
    { id: 'ais.vessel', name: 'AIS vessel', declaredBy: 'ais', defaults: { expiresAfterSeconds: 600 }, fieldSets: ['ais.ship'] },
    { id: 'cot.cot', name: 'CoT', declaredBy: 'cot', defaults: {}, fieldSets: ['cot.unit'] },
    { id: 'gmti.detection', name: 'GMTI detection', declaredBy: 'gmti', defaults: {}, manual: false },
  ],
});

describe('a data type brings its field sets (SDK 1.5.0, CR-0038)', () => {
  it('withDataTypeSets adds the type\'s sets after those listed, each once', () => {
    expect(withDataTypeSets(undefined, { fieldSets: ['ais.ship'] })).toEqual(['ais.ship']);
    expect(withDataTypeSets(['cot.unit', 'ais.ship'], { fieldSets: ['ais.ship'] })).toEqual(['cot.unit', 'ais.ship']);
    expect(withDataTypeSets(['cot.unit'], undefined)).toEqual(['cot.unit']);
    expect(withDataTypeSets(['cot.unit'], { id: 'core.general' } as { fieldSets?: readonly string[] })).toEqual(['cot.unit']);
  });

  it('choosableDataTypes leaves out the types users do not choose, unless the object has one', () => {
    const types = ctx().dataTypes;
    expect(choosableDataTypes(types).map((t) => t.id)).toEqual(['core.general', 'ais.vessel', 'cot.cot']);
    expect(choosableDataTypes(types, 'gmti.detection').map((t) => t.id)).toEqual(['core.general', 'ais.vessel', 'cot.cot', 'gmti.detection']);
  });

  it('the fake store adds the data type\'s sets on a create and on a data type change, and keeps the old ones', async () => {
    const c = ctx();
    const created = await c.changes.submit(changeRequests.createObject(c.newId(), content('ais.vessel')));
    expect(created.outcome).toBe('applied');
    const object = (created as { event: { state: MapObject } }).event.state;
    expect(object.fieldSets).toEqual(['ais.ship']);
    c.live.snapshot({ objects: [object] });
    const changed = await c.changes.submit(changeRequests.updateObject(object, content('cot.cot')));
    expect((changed as { event: { state: MapObject } }).event.state.fieldSets).toEqual(['ais.ship', 'cot.unit']);
    const general = await c.changes.submit(changeRequests.createObject(c.newId(), content('core.general', { fieldSets: ['cot.unit'] })));
    expect((general as { event: { state: MapObject } }).event.state.fieldSets).toEqual(['cot.unit']);
  });

  it('the fake store adds no sets to a shape, whatever its data type (owner, NO A)', async () => {
    const c = ctx();
    const shape = await c.changes.submit(changeRequests.createObject(c.newId(), { ...content('ais.vessel'), type: 'core.shape', symbol: undefined } as unknown as MapObjectContent));
    expect(shape.outcome).toBe('applied');
    expect((shape as { event: { state: MapObject } }).event.state.fieldSets).toBeUndefined();
  });
});
