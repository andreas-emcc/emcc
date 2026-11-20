// T-085, part 3 (brief, function 21, criterion 29): the Symbols panel has the same editor, under the data type, for the symbols about to be
// placed. Its values go with each create until the user changes them; they are kept in the plugin, not in the panel, and are gone after a
// reload.
import { act, cleanup, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import type { DataType, DeclaredField, FieldSet, WorkspaceInfo } from '@emc2/plugin-sdk';
import { FakeServer, layer } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels } from './harness.tsx';
import { addSet, clickMap, placeAt } from './scene.tsx';

isolateDocumentListeners();

const SIMULATION: WorkspaceInfo = { id: 'simulator.simulation', name: 'Simulation', editPermission: 'plugin.simulator.edit', order: 1 };
// SDK 1.5.0: Track brings the set `tracks.motion` (its Speed); a symbol of General carries no set until the user adds one with the "+".
const TRACK: Omit<DataType, 'behaviour'> = { id: 'x.track', name: 'Track', description: 'Tracks', declaredBy: 'tracks', defaults: {}, fieldSets: ['tracks.motion'] };
const UNIT: FieldSet = { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['callsign', 'team', 'staleSeconds'] };
const MOTION: FieldSet = { id: 'tracks.motion', plugin: 'tracks', name: 'motion', label: 'Track motion', fields: ['speed'] };
const FIELD_SETS: readonly FieldSet[] = [UNIT, MOTION];
const FIELDS: readonly DeclaredField[] = [
  { plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign', editableByOthers: true, maxLength: 12 },
  { plugin: 'tracks', name: 'speed', type: 'number', label: 'Speed', unit: 'm/s', minimum: 0, editableByOthers: true },
  { plugin: 'cot', name: 'team', type: 'choice', label: 'Team', editableByOthers: true, choices: [{ value: 'blue', label: 'Blue' }, { value: 'red', label: 'Red' }] },
  { plugin: 'cot', name: 'staleSeconds', type: 'integer', label: 'Stale after', unit: 's', minimum: 1, maximum: 3600, editableByOthers: true },
];
const STOCKHOLM: [number, number] = [18.0686, 59.3293];

async function scene(options: { readonly fields?: readonly DeclaredField[] | undefined; readonly user?: ReturnType<typeof createFakeUser> } = {}) {
  const lay = layer('Default', 0);
  const sim = layer('Sim layer', 1, undefined, SIMULATION.id);
  const server = new FakeServer([lay, sim], ['core.general', TRACK.id]);
  server.declaredFields = FIELDS;
  const declared = 'fields' in options ? options.fields : FIELDS;
  const one = await openBrowser(server, {
    dataTypes: [TRACK],
    workspaces: [SIMULATION],
    fieldSets: FIELD_SETS,
    ...(declared === undefined ? {} : { declaredFields: declared }),
    ...(options.user === undefined ? {} : { user: options.user }),
  });
  const panels = showPanels(one);
  act(() => {
    one.map.activeLayer.set(lay.id);
  });
  await settle();
  return { server, lay, sim, one, panels };
}

async function setText(field: HTMLElement, text: string): Promise<void> {
  fireEvent.change(field, { target: { value: text } });
  await settle();
}

const creates = (server: FakeServer) => server.requests.filter((r) => r.operation === 'create') as unknown as { fields?: unknown; data: { dataType: string; fieldSets?: string[] } }[];

describe('T-085: placing with declared fields (function 21, criterion 29)', () => {
  it('the values set in the Symbols panel go with each created symbol until they are changed', async () => {
    const { server, one, panels } = await scene();
    await addSet(panels.symbols, 'CoT unit');
    await setText(panels.symbols.getByLabelText('Callsign'), 'Hawk');
    fireEvent.change(panels.symbols.getByLabelText('Team'), { target: { value: 'blue' } });
    await settle();
    await placeAt(one, panels, STOCKHOLM);
    await clickMap(one, [16.5, 61.5]);
    expect(creates(server)).toHaveLength(2);
    for (const request of creates(server)) {
      expect(request.data.fieldSets).toEqual(['cot.unit']); // the set the user added
      expect(request.fields).toEqual([{ plugin: 'cot', name: 'callsign', value: 'Hawk' }, { plugin: 'cot', name: 'team', value: 'blue' }]);
    }
    expect([...server.objects.values()].map((o) => o.extensions)).toEqual([
      { cot: { callsign: 'Hawk', team: 'blue' } },
      { cot: { callsign: 'Hawk', team: 'blue' } },
    ]);
    // changed: the next symbol gets the new value
    await setText(panels.symbols.getByLabelText('Callsign'), 'Eagle');
    await clickMap(one, [17, 62]);
    expect(creates(server).at(-1)?.fields).toEqual([{ plugin: 'cot', name: 'callsign', value: 'Eagle' }, { plugin: 'cot', name: 'team', value: 'blue' }]);
  });

  it('a symbol placed without values carries no fields', async () => {
    const { server, one, panels } = await scene();
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)).toHaveLength(1);
    expect(creates(server)[0]).not.toHaveProperty('fields');
  });

  it('the added set and its values are gone after a reload', async () => {
    const { server, panels } = await scene();
    await addSet(panels.symbols, 'CoT unit');
    await setText(panels.symbols.getByLabelText('Callsign'), 'Hawk');
    const second = await openBrowser(server, { dataTypes: [TRACK], workspaces: [SIMULATION], declaredFields: FIELDS, fieldSets: FIELD_SETS });
    const again = showPanels(second);
    expect(again.symbols.queryByLabelText('Callsign')).toBeNull(); // no set yet
    await addSet(again.symbols, 'CoT unit');
    expect((again.symbols.getByLabelText('Callsign') as HTMLInputElement).value).toBe('');
  });

  it('a switch to Simulation and back, with the panel mounted again, keeps them', async () => {
    const { sim, lay, one, panels } = await scene();
    await addSet(panels.symbols, 'CoT unit');
    await setText(panels.symbols.getByLabelText('Callsign'), 'Hawk');
    act(() => {
      one.map.switchWorkspace();
      one.ctx.switchWorkspace(SIMULATION.id);
      one.map.activeLayer.set(sim.id);
    });
    await settle();
    cleanup(); // the shell unmounts the old workspace's panels and mounts the new one's
    const inSimulation = showPanels(one);
    expect((inSimulation.symbols.getByLabelText('Callsign') as HTMLInputElement).value).toBe('Hawk');
    act(() => {
      one.map.switchWorkspace();
      one.ctx.switchWorkspace('core.view');
      one.map.activeLayer.set(lay.id);
    });
    await settle();
    cleanup();
    const inView = showPanels(one);
    expect((inView.symbols.getByLabelText('Callsign') as HTMLInputElement).value).toBe('Hawk');
  });

  it('a data type brings its set at once (criterion 51), and the create lists no set the user did not add', async () => {
    const { server, one, panels } = await scene();
    expect(panels.symbols.queryByLabelText('Field set')).toBeNull(); // General has no set
    fireEvent.change(panels.symbols.getByLabelText('Data type'), { target: { value: TRACK.id } });
    await settle();
    expect((panels.symbols.getByLabelText('Field set') as HTMLSelectElement).value).toBe('tracks.motion'); // opens on the type's first set
    await setText(panels.symbols.getByLabelText('Speed (m/s)'), '12');
    await placeAt(one, panels, STOCKHOLM);
    const [create] = creates(server);
    expect(create?.data.dataType).toBe(TRACK.id);
    expect(create?.data.fieldSets).toBeUndefined(); // the store adds the type's sets
    expect(create?.fields).toEqual([{ plugin: 'tracks', name: 'speed', value: 12 }]);
    expect([...server.objects.values()][0]?.fieldSets).toEqual(['tracks.motion']);
  });

  it('a data type change keeps the added set and its values, and drops the values of a set the new symbols will not carry (function 21)', async () => {
    const { server, one, panels } = await scene();
    await addSet(panels.symbols, 'CoT unit');
    await setText(panels.symbols.getByLabelText('Callsign'), 'Hawk');
    fireEvent.change(panels.symbols.getByLabelText('Team'), { target: { value: 'red' } });
    await settle();
    fireEvent.change(panels.symbols.getByLabelText('Data type'), { target: { value: TRACK.id } });
    await settle();
    // Both sets are listed now, the type's first chosen; the added set and its values stay.
    expect([...(panels.symbols.getByLabelText('Field set') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['cot.unit', 'tracks.motion']);
    await setText(panels.symbols.getByLabelText('Speed (m/s)'), '12');
    fireEvent.change(panels.symbols.getByLabelText('Field set'), { target: { value: 'cot.unit' } });
    await settle();
    expect((panels.symbols.getByLabelText('Callsign') as HTMLInputElement).value).toBe('Hawk');
    expect((panels.symbols.getByLabelText('Team') as HTMLSelectElement).value).toBe('red');
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)[0]?.data.fieldSets).toEqual(['cot.unit']);
    expect(creates(server)[0]?.fields).toEqual([{ plugin: 'cot', name: 'callsign', value: 'Hawk' }, { plugin: 'cot', name: 'team', value: 'red' }, { plugin: 'tracks', name: 'speed', value: 12 }]);
    // Back to General: Track's set is not carried any more, so its value goes; the added set stays.
    fireEvent.change(panels.symbols.getByLabelText('Data type'), { target: { value: 'core.general' } });
    await settle();
    expect([...(panels.symbols.getByLabelText('Field set') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['cot.unit']);
    expect((panels.symbols.getByLabelText('Callsign') as HTMLInputElement).value).toBe('Hawk');
    await clickMap(one, [16.5, 61.5]);
    expect(creates(server).at(-1)?.fields).toEqual([{ plugin: 'cot', name: 'callsign', value: 'Hawk' }, { plugin: 'cot', name: 'team', value: 'red' }]);
    fireEvent.change(panels.symbols.getByLabelText('Data type'), { target: { value: TRACK.id } });
    await settle();
    fireEvent.change(panels.symbols.getByLabelText('Field set'), { target: { value: 'tracks.motion' } }); // the editor keeps the set chosen last for Track
    await settle();
    expect((panels.symbols.getByLabelText('Speed (m/s)') as HTMLInputElement).value).toBe(''); // its value was dropped
  });

  it('a value that breaks its declaration stops the placing click, and is shown at its field', async () => {
    const { server, one, panels } = await scene();
    await addSet(panels.symbols, 'CoT unit');
    await setText(panels.symbols.getByLabelText('Stale after (s)'), '99999');
    expect(panels.symbols.getByText(/above 3600/)).toBeTruthy();
    await placeAt(one, panels, STOCKHOLM);
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications.some((n) => n.severity === 'warning' && n.message.includes('above 3600'))).toBe(true);
    await setText(panels.symbols.getByLabelText('Stale after (s)'), '120');
    await clickMap(one, [16.5, 61.5]);
    expect(creates(server)).toHaveLength(1);
    expect(creates(server)[0]?.fields).toEqual([{ plugin: 'cot', name: 'staleSeconds', value: 120 }]);
  });

  it('with no declared fields the Symbols panel has no fields and a created symbol carries none', async () => {
    const { server, one, panels } = await scene({ fields: [] });
    expect(panels.symbols.queryByLabelText('Callsign')).toBeNull();
    expect(panels.symbols.queryByLabelText('Team')).toBeNull();
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)[0]).not.toHaveProperty('fields');
  });

  it('without the edit permission no value can be set and no field is shown', async () => {
    const { panels } = await scene({ user: createFakeUser({ permissions: [] }) });
    expect(panels.symbols.queryByRole('button', { name: 'Add a field set' })).toBeNull(); // read only: no "+"
    expect(panels.symbols.queryByLabelText('Callsign')).toBeNull();
  });
});
