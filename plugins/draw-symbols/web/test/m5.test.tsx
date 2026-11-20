// M5 (brief, functions 27 to 29, criteria 44 to 49; T-132, T-139, T-150): field sets in "Symbol properties" and the Symbols panel, vessel
// symbols in the picker and in the properties, and relations and field sets sent back on every update (SDK 1.4.0 part 3), as SDK 1.5.0 part 1 shows them: one set at a time, the "+" a menu of the sets the symbol lacks.
import { act, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import type { DataType, DeclaredField, FieldSet, MapObject } from '@emc2/plugin-sdk';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels, STOCKHOLM } from './harness.tsx';
import { addSet, choose, commit, dataOf, placeAt, select } from './scene.tsx';

isolateDocumentListeners();

const UNIT: FieldSet = { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['callsign', 'team'] };
const EXTRA: FieldSet = { id: 'ops.extra', plugin: 'ops', name: 'extra', label: 'Extra', fields: ['note'] };
const FIELD_SETS: readonly FieldSet[] = [UNIT, EXTRA];
// The fields show through their sets only (SDK 1.5.0); Track brings the set Extra.
const FIELDS: readonly DeclaredField[] = [
  { plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign', editableByOthers: true },
  { plugin: 'cot', name: 'team', type: 'choice', label: 'Team', editableByOthers: true, choices: [{ value: 'blue', label: 'Blue' }, { value: 'red', label: 'Red' }] },
  { plugin: 'ops', name: 'note', type: 'text', label: 'Note', editableByOthers: true },
];
const TRACK: Omit<DataType, 'behaviour'> = { id: 'x.track', name: 'Track', description: 'Tracks', declaredBy: 'tracks', defaults: {}, fieldSets: ['ops.extra'] };
const RELATIONS = [{ kind: 'gmti.pairing', objectId: '01900000-0000-7000-8000-00000000000a' }, { kind: 'gmti.pairing', objectId: '01900000-0000-7000-8000-00000000000b' }];

async function scene(options: { readonly overrides?: Partial<MapObject>; readonly locked?: boolean; readonly user?: ReturnType<typeof createFakeUser>; readonly vessels?: boolean; readonly select?: boolean; readonly identities?: readonly { readonly code: string; readonly name: string }[] } = {}) {
  const lay = layer('Default', 0);
  const server = new FakeServer([lay], ['core.general', TRACK.id]);
  server.declaredFields = FIELDS;
  const symbol = server.seed(symbolObject(lay.id, options.overrides ?? {}));
  if (options.locked === true) server.setLocked(lay.id, true);
  const one = await openBrowser(server, {
    declaredFields: FIELDS,
    fieldSets: FIELD_SETS,
    dataTypes: [TRACK],
    ...(options.vessels === undefined ? {} : { vessels: options.vessels }),
    ...(options.identities === undefined ? {} : { identities: options.identities }),
    ...(options.user === undefined ? {} : { user: options.user }),
  });
  const panels = showPanels(one);
  act(() => { one.map.activeLayer.set(lay.id); });
  if (options.select !== false) await select(one, symbol.id);
  const stored = () => server.objects.get(symbol.id) as MapObject;
  return { server, lay, symbol, one, panels, stored };
}

const updates = (server: FakeServer) => server.requests.filter((r) => r.operation === 'update') as unknown as { fields?: { plugin: string; name: string; value: unknown }[]; data: MapObject }[];
const creates = (server: FakeServer) => server.requests.filter((r) => r.operation === 'create') as unknown as { fields?: unknown; data: MapObject }[];
const group = (view: ReturnType<typeof showPanels>['properties'], name: string) => view.queryByRole('group', { name });
const plus = (view: ReturnType<typeof showPanels>['properties']) => view.queryByRole('button', { name: 'Add a field set' });
const menuOf = (view: ReturnType<typeof showPanels>['properties']) => {
  fireEvent.click(view.getByRole('button', { name: 'Add a field set' }));
  const items = within(view.getByRole('menu', { name: 'Field sets to add' })).getAllByRole('menuitem').map((i) => i.textContent);
  fireEvent.keyDown(view.getByRole('menu', { name: 'Field sets to add' }), { key: 'Escape' });
  return items;
};

describe('field sets in Symbol properties (criteria 44 and 45)', () => {
  it('a symbol without a set has no drop-down and no field, and the "+" offers every declared set', async () => {
    const { panels } = await scene();
    expect(panels.properties.queryByLabelText('Field set')).toBeNull();
    expect(panels.properties.queryByLabelText('Callsign')).toBeNull(); // in no set the symbol has
    expect(panels.properties.queryByRole('button', { name: /^Other fields/ })).toBeNull();
    expect(menuOf(panels.properties)).toEqual(['CoT unit', 'Extra']);
  });

  it('the "+" sends one update with the set listed, and the set shows with Callsign editable; the "+" then offers the other sets only', async () => {
    const { server, symbol, panels, stored } = await scene();
    await addSet(panels.properties, 'CoT unit');
    expect(server.requests).toHaveLength(1);
    const [request] = updates(server);
    expect(request?.data.fieldSets).toEqual(['cot.unit']);
    expect(request?.fields).toBeUndefined();
    expect(request?.data.geometry).toEqual(symbol.geometry); // nothing else changed
    expect(stored().fieldSets).toEqual(['cot.unit']);
    expect((panels.properties.getByLabelText('Field set') as HTMLSelectElement).value).toBe('cot.unit');
    const unit = within(group(panels.properties, 'CoT unit') as HTMLElement);
    expect(unit.getByLabelText<HTMLInputElement>('Callsign').disabled).toBe(false);
    expect(menuOf(panels.properties)).toEqual(['Extra']);
  });

  it('a second set is added after the first and chosen, both stay, and with no set left the "+" is gone', async () => {
    const { server, panels, stored } = await scene({ overrides: { fieldSets: ['cot.unit'] } });
    await addSet(panels.properties, 'Extra');
    expect(updates(server)[0]?.data.fieldSets).toEqual(['cot.unit', 'ops.extra']);
    expect(stored().fieldSets).toEqual(['cot.unit', 'ops.extra']);
    expect((panels.properties.getByLabelText('Field set') as HTMLSelectElement).value).toBe('ops.extra');
    expect(plus(panels.properties)).toBeNull();
  });

  it('a value set in the set sends only that field, and an emptied one sends null', async () => {
    const { server, panels, stored } = await scene({ overrides: { fieldSets: ['cot.unit'] } });
    await commit(panels.properties.getByLabelText('Callsign') as HTMLInputElement, 'Hawk');
    expect(server.requests).toHaveLength(1);
    expect(updates(server)[0]?.fields).toEqual([{ plugin: 'cot', name: 'callsign', value: 'Hawk' }]);
    expect(stored().extensions).toEqual({ cot: { callsign: 'Hawk' } });
    await commit(panels.properties.getByLabelText('Callsign') as HTMLInputElement, '');
    expect(updates(server)[1]?.fields).toEqual([{ plugin: 'cot', name: 'callsign', value: null }]);
    expect(stored().extensions).toBeUndefined();
  });

  it('a field typed into and emptied again on a symbol that had no value sends nothing', async () => {
    const { server, panels } = await scene({ overrides: { fieldSets: ['cot.unit'] } });
    fireEvent.change(panels.properties.getByLabelText('Callsign'), { target: { value: 'x' } });
    await commit(panels.properties.getByLabelText('Callsign') as HTMLInputElement, '');
    expect(server.requests).toHaveLength(0);
  });

  it('a value in a set the symbol lacks shows read only, marked "not added", until the set is added', async () => {
    const { server, panels } = await scene({ overrides: { extensions: { ops: { note: 'seen' } } } });
    expect(((panels.properties.getByLabelText('Field set') as HTMLSelectElement).selectedOptions[0] as HTMLOptionElement).text).toBe('Extra (not added)');
    const note = within(group(panels.properties, 'Extra') as HTMLElement).getByLabelText<HTMLInputElement>('Note');
    expect(note.value).toBe('seen');
    expect(note.disabled).toBe(true);
    await addSet(panels.properties, 'Extra');
    expect((panels.properties.getByLabelText('Note') as HTMLInputElement).disabled).toBe(false);
    expect(updates(server)[0]?.data.fieldSets).toEqual(['ops.extra']);
  });

  it('a set that no loaded plugin declares any more is kept and not shown', async () => {
    const { server, panels, stored } = await scene({ overrides: { fieldSets: ['gone.set', 'cot.unit'] } });
    expect([...(panels.properties.getByLabelText('Field set') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['cot.unit']);
    await commit(panels.properties.getByLabelText('Name') as HTMLInputElement, 'Alpha');
    expect(updates(server)[0]?.data.fieldSets).toEqual(['gone.set', 'cot.unit']);
    expect(stored().fieldSets).toEqual(['gone.set', 'cot.unit']);
  });

  it('two choices of the same set before the object comes back send it once', async () => {
    const { server, one, panels } = await scene();
    one.connection.hold = true;
    await addSet(panels.properties, 'CoT unit');
    await addSet(panels.properties, 'CoT unit'); // the object has not come back: the menu still offers it
    one.connection.release();
    await settle();
    expect(updates(server)).toHaveLength(1); // the second finds the set stored
    expect(server.objects.get([...server.objects.keys()][0] as string)?.fieldSets).toEqual(['cot.unit']);
  });

  it('keeps the sets and their values when the data type changes, and the store adds the new type\'s set (ADR-0050 point 8)', async () => {
    const { server, panels, stored } = await scene({ overrides: { fieldSets: ['cot.unit'], extensions: { cot: { callsign: 'Hawk' } } } });
    await choose(panels.properties.getByLabelText('Data type'), TRACK.id);
    expect(updates(server)[0]?.data.dataType).toBe(TRACK.id);
    expect(updates(server)[0]?.data.fieldSets).toEqual(['cot.unit']); // the update lists what the symbol had; the store adds Extra
    expect(stored().fieldSets).toEqual(['cot.unit', 'ops.extra']);
    expect((panels.properties.getByLabelText('Field set') as HTMLSelectElement).value).toBe('ops.extra'); // opens on the new type's first set
    await choose(panels.properties.getByLabelText('Field set'), 'cot.unit');
    expect((panels.properties.getByLabelText('Callsign') as HTMLInputElement).value).toBe('Hawk');
  });
});

describe('field sets read only (criterion 47)', () => {
  it('without the edit permission there is no "+", the drop-down still chooses the set to see, and its fields are read only', async () => {
    const { panels } = await scene({ user: createFakeUser({ permissions: [] }), overrides: { fieldSets: ['cot.unit'], extensions: { cot: { callsign: 'Hawk' } } } });
    expect(panels.properties.getByLabelText('Field set')).toBeTruthy();
    expect(plus(panels.properties)).toBeNull();
    expect((panels.properties.getByLabelText('Callsign') as HTMLInputElement).disabled).toBe(true);
  });

  it('in a locked layer there is no "+" and the fields are read only, and an unlock gives the "+" back', async () => {
    const { server, lay, panels } = await scene({ locked: true, overrides: { fieldSets: ['cot.unit'], extensions: { cot: { callsign: 'Hawk' } } } });
    expect(plus(panels.properties)).toBeNull();
    expect((panels.properties.getByLabelText('Callsign') as HTMLInputElement).disabled).toBe(true);
    expect(server.requests).toHaveLength(0);
    act(() => { server.setLocked(lay.id, false); });
    await settle();
    expect(plus(panels.properties)).not.toBeNull();
    expect((panels.properties.getByLabelText('Callsign') as HTMLInputElement).disabled).toBe(false);
  });
});

describe('placing with a set (criterion 46)', () => {
  it('a set added in the Symbols panel, with a Callsign, goes with each create', async () => {
    const { server, one, panels } = await scene({ select: false });
    expect(panels.symbols.queryByLabelText('Field set')).toBeNull();
    await addSet(panels.symbols, 'CoT unit');
    expect(menuOf(panels.symbols)).toEqual(['Extra']);
    fireEvent.change(panels.symbols.getByLabelText('Callsign'), { target: { value: 'Hawk' } });
    await settle();
    await placeAt(one, panels, STOCKHOLM);
    const [create] = creates(server);
    expect(create?.data.fieldSets).toEqual(['cot.unit']);
    expect(create?.fields).toEqual([{ plugin: 'cot', name: 'callsign', value: 'Hawk' }]);
    const stored = [...server.objects.values()].find((o) => o.id === (create as unknown as { entityId: string }).entityId);
    expect(stored?.fieldSets).toEqual(['cot.unit']);
    expect(stored?.extensions).toEqual({ cot: { callsign: 'Hawk' } });
  });

  it('the added set and its values stay when the data type changes, and the new type\'s set is listed with it (ADR-0050 point 8)', async () => {
    const { server, one, panels } = await scene({ select: false });
    await addSet(panels.symbols, 'CoT unit');
    fireEvent.change(panels.symbols.getByLabelText('Callsign'), { target: { value: 'Hawk' } });
    fireEvent.change(panels.symbols.getByLabelText('Team'), { target: { value: 'blue' } });
    await settle();
    await choose(panels.symbols.getByLabelText('Data type'), TRACK.id);
    expect([...(panels.symbols.getByLabelText('Field set') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['cot.unit', 'ops.extra']);
    await choose(panels.symbols.getByLabelText('Field set'), 'cot.unit');
    expect((panels.symbols.getByLabelText('Callsign') as HTMLInputElement).value).toBe('Hawk');
    expect((panels.symbols.getByLabelText('Team') as HTMLSelectElement).value).toBe('blue');
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)[0]?.data.fieldSets).toEqual(['cot.unit']); // not the type's: the store adds it
    expect(creates(server)[0]?.data.dataType).toBe(TRACK.id);
    expect(creates(server)[0]?.fields).toEqual([{ plugin: 'cot', name: 'callsign', value: 'Hawk' }, { plugin: 'cot', name: 'team', value: 'blue' }]);
  });

  it('two sets added in the panel both go with the create, in the order added', async () => {
    const { server, one, panels } = await scene({ select: false });
    await addSet(panels.symbols, 'CoT unit');
    await addSet(panels.symbols, 'Extra');
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)[0]?.data.fieldSets).toEqual(['cot.unit', 'ops.extra']);
  });

  it('a set that no loaded plugin declares any more does not go with the create', async () => {
    const { server, one, panels } = await scene({ select: false });
    await addSet(panels.symbols, 'CoT unit');
    (one.ctx.fieldSets as FieldSet[]).splice(0); // its plugin is gone: the store would refuse the create (rule 18)
    server.fieldSets = [];
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)[0]?.data.fieldSets).toBeUndefined();
    expect(server.objects.size).toBe(2); // the seeded symbol and the new one
  });

  it('a panel without a set sends no set', async () => {
    const { server, one, panels } = await scene({ select: false });
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)[0]?.data.fieldSets).toBeUndefined();
  });

  it('without the edit permission the panel has no "+"', async () => {
    const { panels } = await scene({ select: false, user: createFakeUser({ permissions: [] }) });
    expect(plus(panels.symbols)).toBeNull();
  });
});

describe('vessel symbols in the picker (criterion 48)', () => {
  const vesselCategory = async (view: Awaited<ReturnType<typeof scene>>['panels']['symbols']) => {
    await choose(view.getByLabelText('Category'), 'vessels');
  };

  it('has the category Vessels after the APP-6 ones when the service has vesselGroups, and none without', async () => {
    const { panels } = await scene({ select: false });
    const names = [...(panels.symbols.getByLabelText('Category') as HTMLSelectElement).options].map((o) => o.text);
    expect(names.at(-1)).toBe('Vessels');
    expect(names).toEqual(['Land unit', 'Vessels']); // the test catalog has the one symbol set, Land unit
    const without = await scene({ select: false, vessels: false });
    expect([...(without.panels.symbols.getByLabelText('Category') as HTMLSelectElement).options].map((o) => o.text)).not.toContain('Vessels');
  });

  it('lists one entry per ship-type group, each with a Ship type drop-down of its types, and no echelon', async () => {
    const { one, panels } = await scene({ select: false });
    await vesselCategory(panels.symbols);
    const grid = within(panels.symbols.getByRole('group', { name: 'Symbols' }));
    for (const name of ['Cargo', 'Tanker', 'Passenger', 'Fishing', 'Pleasure craft', 'High-speed craft', 'Tug and special craft', 'Other', 'Unknown']) {
      expect(grid.getByRole('group', { name })).toBeTruthy();
    }
    const cargo = within(grid.getByRole('group', { name: 'Cargo' }));
    const select = cargo.getByLabelText<HTMLSelectElement>('Ship type');
    expect([...select.options].map((o) => o.value)).toEqual(['70', '71', '72', '73', '74', '75', '76', '77', '78', '79']);
    expect(select.value).toBe('70'); // the first
    expect(panels.symbols.queryByLabelText('Echelon')).toBeNull();
    // The picture of a group is drawn through `render` as a vessel of its first type, with a direction of 0 so that the hull shows.
    const drawn = one.symbols.renderRequests.filter((r) => r.standard === 'vessel');
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.find((r) => r.sidc === '0370')?.modifiers).toEqual({ direction: 0 }); // friend (3), type 70
  });

  it('places a vessel of the chosen type and identity, without a direction, at the clicked point', async () => {
    const { server, one, panels } = await scene({ select: false });
    await vesselCategory(panels.symbols);
    await choose(panels.symbols.getByLabelText('Identity'), '4'); // neutral
    const cargo = within(panels.symbols.getByRole('group', { name: 'Cargo' }));
    await choose(cargo.getByLabelText('Ship type'), '71');
    expect(panels.symbols.getByText('0471')).toBeTruthy(); // the preview names it
    await placeAt(one, panels, STOCKHOLM, 'Cargo');
    const [create] = creates(server);
    expect(create?.data.symbol).toEqual({ standard: 'vessel', sidc: '0471' });
    expect(create?.data.geometry).toEqual({ type: 'Point', coordinates: [18.0686, 59.3293] }); // longitude, latitude: the two differ
    expect(create?.data.dataType).toBe('core.general');
  });

  it('keeps the category, and a type chosen in a group stays chosen while the identity changes', async () => {
    const { panels } = await scene({ select: false });
    await vesselCategory(panels.symbols);
    expect(window.localStorage.getItem('draw-symbols.category')).toBe('vessels');
    const cargo = () => within(panels.symbols.getByRole('group', { name: 'Cargo' })).getByLabelText<HTMLSelectElement>('Ship type');
    await choose(cargo(), '73');
    await choose(panels.symbols.getByLabelText('Identity'), '6');
    expect(cargo().value).toBe('73');
    fireEvent.click(panels.symbols.getByRole('button', { name: 'Cargo' }));
    expect(panels.symbols.getByText('0673')).toBeTruthy();
  });

  it('takes a typed SIDC as a vessel code and refuses one that is not', async () => {
    const { server, one, panels } = await scene({ select: false });
    await vesselCategory(panels.symbols);
    const advanced = panels.symbols.getByLabelText('SIDC (vessel)') as HTMLInputElement;
    fireEvent.change(advanced, { target: { value: '9999' } });
    await settle();
    expect(panels.symbols.getByText('not a valid vessel SIDC')).toBeTruthy();
    fireEvent.change(advanced, { target: { value: '0580' } });
    await settle();
    fireEvent.click(panels.symbols.getByRole('button', { name: 'Place on map' })); // the typed SIDC is the choice; a click on an entry would replace it
    await settle();
    await act(async () => { one.map.completeInteraction(STOCKHOLM); await Promise.resolve(); });
    await settle();
    expect(creates(server)[0]?.data.symbol).toEqual({ standard: 'vessel', sidc: '0580' });
  });

  it('after a category of APP-6 symbols the picker places APP-6 again', async () => {
    const { server, one, panels } = await scene({ select: false });
    await vesselCategory(panels.symbols);
    await choose(panels.symbols.getByLabelText('Category'), '10');
    await placeAt(one, panels, STOCKHOLM, 'Infantry');
    expect(creates(server)[0]?.data.symbol?.standard).toBe('APP-6D');
  });

  it('opens on the first category when Vessels was kept but the service has no vessel groups', async () => {
    window.localStorage.setItem('draw-symbols.category', 'vessels');
    const { panels } = await scene({ select: false, vessels: false });
    expect((panels.symbols.getByLabelText('Category') as HTMLSelectElement).value).toBe('10');
    expect(panels.symbols.getByRole('button', { name: 'Infantry' })).toBeTruthy(); // the land units are listed, not an empty Vessels
  });
});

describe('vessel symbols in Symbol properties (criterion 48)', () => {
  const VESSEL: Partial<MapObject> = { symbol: { standard: 'vessel', sidc: '0471' } };

  it('shows the identity and the ship type instead of the SIDC parts, with the SIDC', async () => {
    const { panels } = await scene({ overrides: VESSEL });
    expect((panels.properties.getByLabelText('Identity') as HTMLSelectElement).value).toBe('4');
    expect(((panels.properties.getByLabelText('Identity') as HTMLSelectElement).selectedOptions[0] as HTMLOptionElement).text).toBe('Neutral');
    expect((panels.properties.getByLabelText('Ship type') as HTMLSelectElement).value).toBe('71');
    expect(panels.properties.queryByLabelText('Echelon')).toBeNull();
    expect(panels.properties.queryByLabelText('Category')).toBeNull();
    expect(panels.properties.queryByLabelText('Entity')).toBeNull();
    expect((panels.properties.getByLabelText('SIDC') as HTMLInputElement).value).toBe('0471');
  });

  it('a change of identity or ship type is one update of the vessel code, and the standard stays vessel', async () => {
    const { server, panels, stored } = await scene({ overrides: VESSEL });
    await choose(panels.properties.getByLabelText('Identity'), '6');
    expect(stored().symbol).toEqual({ standard: 'vessel', sidc: '0671' });
    await choose(panels.properties.getByLabelText('Ship type'), '80');
    expect(stored().symbol).toEqual({ standard: 'vessel', sidc: '0680' });
    expect(server.requests).toHaveLength(2);
  });

  it('the advanced SIDC field validates with the vessel standard', async () => {
    const { server, panels, stored } = await scene({ overrides: VESSEL });
    await commit(panels.properties.getByLabelText('SIDC') as HTMLInputElement, '9999');
    expect(panels.properties.getByText('not a valid vessel SIDC')).toBeTruthy();
    expect(server.requests).toHaveLength(0);
    await commit(panels.properties.getByLabelText('SIDC') as HTMLInputElement, '0172');
    expect(stored().symbol).toEqual({ standard: 'vessel', sidc: '0172' });
  });

  it('a heading and a speed are set as for an APP-6 symbol', async () => {
    const { panels, stored } = await scene({ overrides: VESSEL });
    await commit(panels.properties.getByLabelText('Heading (°)') as HTMLInputElement, '90');
    await commit(panels.properties.getByLabelText('Speed (km/h)') as HTMLInputElement, '36');
    expect(stored().symbol).toEqual({ standard: 'vessel', sidc: '0471', modifiers: { direction: 90, speed: 10 } });
  });

  it('offers the identities a vessel has, 0 to 6, and no other', async () => {
    const identities = [{ code: '3', name: 'Friend' }, { code: '4', name: 'Neutral' }, { code: '7', name: 'Exercise pending' }];
    const { panels } = await scene({ overrides: VESSEL, identities });
    expect([...(panels.properties.getByLabelText('Identity') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['3', '4']);
  });

  it('a ship type the service does not list is shown as it is, and read only without the permission', async () => {
    const { panels } = await scene({ overrides: { symbol: { standard: 'vessel', sidc: '0400' } }, user: createFakeUser({ permissions: [] }) });
    expect((panels.properties.getByLabelText('Ship type') as HTMLSelectElement).value).toBe('0'); // type 0 is in the group Unknown
    expect((panels.properties.getByLabelText('Ship type') as HTMLSelectElement).disabled).toBe(true);
    expect((panels.properties.getByLabelText('Identity') as HTMLSelectElement).disabled).toBe(true);
  });
});

describe('relations and field sets forwarded (criterion 49)', () => {
  const TWO: Partial<MapObject> = { relations: RELATIONS, fieldSets: ['cot.unit'] };

  it('a rename sends both relations and the set unchanged, and the stored symbol keeps them', async () => {
    const { server, panels, stored } = await scene({ overrides: TWO });
    await commit(panels.properties.getByLabelText('Name') as HTMLInputElement, 'Alpha');
    const [request] = updates(server);
    expect(request?.data.relations).toEqual(RELATIONS);
    expect(request?.data.fieldSets).toEqual(['cot.unit']);
    expect(stored().relations).toEqual(RELATIONS);
    expect(stored().fieldSets).toEqual(['cot.unit']);
    expect(stored().properties?.name).toBe('Alpha');
  });

  it('every other change forwards them too: the position, the heading, a declared field and the data type', async () => {
    const { server, panels, stored } = await scene({ overrides: TWO });
    await commit(panels.properties.getByLabelText(/^Position/) as HTMLInputElement, '12.5 S 130.25 W');
    await commit(panels.properties.getByLabelText('Heading (°)') as HTMLInputElement, '45');
    await commit(panels.properties.getByLabelText('Callsign') as HTMLInputElement, 'Hawk');
    await choose(panels.properties.getByLabelText('Data type'), TRACK.id);
    expect(updates(server)).toHaveLength(4);
    for (const request of updates(server)) {
      expect(request.data.relations).toEqual(RELATIONS);
      expect(request.data.fieldSets).toEqual(['cot.unit']);
    }
    expect(stored().relations).toEqual(RELATIONS);
  });

  it('a symbol without relations sends none, and none appear', async () => {
    const { server, panels } = await scene();
    await commit(panels.properties.getByLabelText('Name') as HTMLInputElement, 'Alpha');
    expect(Object.hasOwn(dataOf(server.requests[0]), 'relations')).toBe(false);
    expect(Object.hasOwn(dataOf(server.requests[0]), 'fieldSets')).toBe(false);
  });

  it('adding a set to a symbol with relations keeps the relations', async () => {
    const { server, panels, stored } = await scene({ overrides: { relations: RELATIONS } });
    await addSet(panels.properties, 'CoT unit');
    expect(updates(server)[0]?.data.relations).toEqual(RELATIONS);
    expect(stored().relations).toEqual(RELATIONS);
    expect(stored().fieldSets).toEqual(['cot.unit']);
  });
});
