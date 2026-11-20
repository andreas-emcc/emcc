import { describe, expect, it } from 'vitest';
import type { MapObject, ObjectAction } from '../src/index.ts';
import {
  applicableMapActions, applicableObjectActions, isReservedPluginId, layerQueryOptions, MAX_FETCH_IDS, ObjectQueryError, PERMISSIONS, SHELL_SOURCE_PLUGIN,
} from '../src/index.ts';
import { createFakeContext, createFakeUser } from '../src/testing/index.ts';

const LAYER = '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01';
const OTHER_LAYER = '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e02';
const label = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' } as const;
const meta = { created: { at: '2026-10-15T09:00:00.000Z', by: { plugin: 'draw-shapes' } }, modified: { at: '2026-10-15T09:00:00.000Z', by: { plugin: 'draw-shapes' } } };

function shape(id: string, layerId = LAYER, dataType = 'core.general'): MapObject {
  return { id, type: 'core.shape', dataType, dataSource: 'manual', layerId, version: 1, geometry: { type: 'Point', coordinates: [18.07, 59.33] }, label, meta };
}
function symbol(id: string): MapObject {
  return {
    id, type: 'core.symbol', dataType: 'cot.cot', dataSource: 'tak-north', layerId: LAYER, version: 1, geometry: { type: 'Point', coordinates: [18.07, 59.33] },
    symbol: { standard: 'APP-6D', sidc: '10031000001211000000' }, label, meta,
  };
}
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `0192a5c4-3b1e-7c2d-9f00-${(from + i).toString(16).padStart(12, '0')}`);

const edit: ObjectAction = { id: 'edit', label: 'Edit', group: 'edit', appliesTo: { types: ['core.shape'] }, multiple: false, permission: PERMISSIONS.objectsEdit, run: () => undefined };
const centre: ObjectAction = { id: 'centre', label: 'Centre on', group: 'view', order: 10, appliesTo: {}, multiple: true, run: () => undefined };
const zoom: ObjectAction = { id: 'zoom', label: 'Zoom to', group: 'view', order: 20, appliesTo: {}, multiple: true, run: () => undefined };
const deleteAll: ObjectAction = { id: 'delete', label: 'Delete', group: 'delete', appliesTo: {}, multiple: true, permission: PERMISSIONS.objectsEdit, run: () => undefined };
const cotOnly: ObjectAction = { id: 'cot-info', label: 'CoT details', group: 'cot', appliesTo: { dataTypes: ['cot.cot'] }, multiple: false, run: () => undefined };

describe('which object actions the menu offers (ADR-0032)', () => {
  const all = [deleteAll, cotOnly, edit, zoom, centre];
  const everyone = () => true;

  it('keeps one-object actions off a selection of several, and orders view, edit, others, delete', () => {
    expect(applicableObjectActions(all, [shape(ids(1)[0]!)], everyone).map((a) => a.id)).toEqual(['centre', 'zoom', 'edit', 'delete']);
    expect(applicableObjectActions(all, [shape(ids(1)[0]!), shape(ids(1, 1)[0]!)], everyone).map((a) => a.id)).toEqual(['centre', 'zoom', 'delete']);
  });

  it('applies by type and by data type to every object, and hides actions the user may not use', () => {
    expect(applicableObjectActions(all, [symbol(ids(1)[0]!)], everyone).map((a) => a.id)).toEqual(['centre', 'zoom', 'cot-info', 'delete']);
    expect(applicableObjectActions(all, [shape(ids(1)[0]!)], () => false).map((a) => a.id)).toEqual(['centre', 'zoom']);
    expect(applicableObjectActions(all, [], everyone)).toEqual([]);
    const tested: ObjectAction = { ...centre, id: 'named', appliesTo: { test: (o) => o.properties?.name !== undefined } };
    expect(applicableObjectActions([tested], [shape(ids(1)[0]!)], everyone)).toEqual([]);
  });

  it('filters map actions by permission', () => {
    const centreMap = { id: 'centre-map', label: 'Centre map', group: 'view', run: () => undefined };
    const admin = { id: 'admin', label: 'Admin', permission: PERMISSIONS.settingsAdmin, run: () => undefined };
    expect(applicableMapActions([admin, centreMap], () => false).map((a) => a.id)).toEqual(['centre-map']);
  });
});

describe('the fake context: actions and the menu', () => {
  it('records actions and menus, and runs an action as the menu would', async () => {
    const ctx = createFakeContext({ pluginId: 'draw-shapes', user: createFakeUser({ permissions: [PERMISSIONS.objectsEdit] }) });
    const ran: (readonly string[])[] = [];
    ctx.actions.addObjectAction({ ...edit, run: (chosen) => void ran.push(chosen) });
    const [a, b] = ids(2);
    ctx.setServerObjects([shape(a!), shape(b!)]);
    await ctx.runObjectAction('edit', [a!]);
    expect(ran).toEqual([[a]]);
    await expect(ctx.runObjectAction('edit', [a!, b!])).rejects.toThrow(/would not offer edit/);
    ctx.actions.openMenu([120, 80], { choose: [a!, b!] });
    expect(ctx.openedMenus).toEqual([{ at: [120, 80], target: { choose: [a, b] } }]);
    expect(() => ctx.actions.addObjectAction(edit)).toThrow(/already has/);
  });

  it('runs a map action with its position, and refuses one the user may not use', async () => {
    const ctx = createFakeContext({ user: createFakeUser({ permissions: [] }) });
    const at: unknown[] = [];
    ctx.actions.addMapAction({ id: 'centre-map', label: 'Centre map', run: (p) => void at.push(p) });
    ctx.actions.addMapAction({ id: 'admin', label: 'Admin', permission: PERMISSIONS.settingsAdmin, run: () => undefined });
    await ctx.runMapAction('centre-map', [18.07, 59.33]);
    expect(at).toEqual([[18.07, 59.33]]);
    await expect(ctx.runMapAction('admin', [0, 0])).rejects.toThrow(/may not use/);
  });
});

describe('objects by id and the layer query (CR-0015 items 8 and 9)', () => {
  it('fetches objects by id, also ones the live picture never sent, and names the missing', async () => {
    const ctx = createFakeContext();
    const [a, b] = ids(2);
    ctx.setServerObjects([shape(a!)]);
    expect(await ctx.objects.get([b!, a!])).toEqual({ found: [shape(a!)], missing: [b] });
    await expect(ctx.objects.get(ids(MAX_FETCH_IDS + 1))).rejects.toBeInstanceOf(ObjectQueryError);
  });

  it('pages a layer in the order of creation, with the total', async () => {
    const ctx = createFakeContext();
    const layerIds = ids(250);
    ctx.setServerObjects([...layerIds].reverse().map((id) => shape(id)).concat([shape(ids(1, 999)[0]!, OTHER_LAYER)]));
    const first = await ctx.objects.queryLayer(LAYER, { pageSize: 100 });
    expect([first.total, first.objects.length, first.objects[0]?.id]).toEqual([250, 100, layerIds[0]]);
    const last = await ctx.objects.queryLayer(LAYER, { page: 2, pageSize: 100 });
    expect(last.objects.map((o) => o.id)).toEqual(layerIds.slice(200));
    expect((await ctx.objects.queryLayer(LAYER, { page: 9 })).objects).toEqual([]);
  });

  it('refuses bad page options, and fails like a lost connection when told to', async () => {
    expect(layerQueryOptions()).toEqual({ page: 0, pageSize: 100 });
    expect(() => layerQueryOptions({ pageSize: 501 })).toThrow(ObjectQueryError);
    expect(() => layerQueryOptions({ page: -1 })).toThrow(ObjectQueryError);
    const ctx = createFakeContext();
    ctx.failObjectQueries(true);
    await expect(ctx.objects.queryLayer(LAYER)).rejects.toBeInstanceOf(ObjectQueryError);
    await expect(ctx.objects.get([])).rejects.toBeInstanceOf(ObjectQueryError);
  });
});

describe('the shell\'s own source.plugin (CR-0015 item 10)', () => {
  it('is core-shell, which no plugin may take', () => {
    expect(SHELL_SOURCE_PLUGIN).toBe('core-shell');
    expect(isReservedPluginId(SHELL_SOURCE_PLUGIN)).toBe(true);
    expect(isReservedPluginId('core')).toBe(true);
    expect(isReservedPluginId('draw-shapes')).toBe(false);
    expect(isReservedPluginId('corex')).toBe(false);
  });
});
