// M6 (brief, function 30, criteria 50 to 53; T-165; CR-0038, SDK 1.5.0 part 1): a data type brings its field sets. The data type select leaves out
// the types users do not choose, a chosen data type shows its sets at once, and the editor shows one set at a time with a "+" for the others.
import { act, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import type { DataType, DeclaredField, FieldSet, MapObject } from '@emc2/plugin-sdk';
import { DATA_TYPE_KEY } from '../src/keptChoice.ts';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels, STOCKHOLM } from './harness.tsx';
import { addSet, choose, commit, placeAt, select } from './scene.tsx';

isolateDocumentListeners();

const type = (id: string, name: string, extra: Partial<Omit<DataType, 'behaviour'>> = {}): Omit<DataType, 'behaviour'> => ({ id, name, description: name, declaredBy: id.split('.')[0] ?? '', defaults: {}, ...extra });
const COT = type('cot.cot', 'CoT', { fieldSets: ['cot.unit'] });
const AIS = type('ais.vessel', 'AIS vessel', { fieldSets: ['ais.ship'] });
const ROUTE = type('simulator.route', 'Route', { manual: false });
const DETECTION = type('gmti.detection', 'GMTI detection', { manual: false });
const CARGO = type('ais.cargo', 'AIS cargo', { fieldSets: ['ais.ship'] }); // brings the same set as AIS vessel
const DATA_TYPES = [COT, AIS, CARGO, ROUTE, DETECTION];
const UNIT: FieldSet = { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['callsign'] };
const SHIP: FieldSet = { id: 'ais.ship', plugin: 'ais', name: 'ship', label: 'AIS ship', fields: ['mmsi'] };
const FIELD_SETS = [UNIT, SHIP];
const FIELDS: readonly DeclaredField[] = [
  { plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign', editableByOthers: true },
  { plugin: 'ais', name: 'mmsi', type: 'integer', label: 'MMSI', editableByOthers: true, minimum: 1 },
];

async function scene(options: { readonly overrides?: Partial<MapObject>; readonly locked?: boolean; readonly user?: ReturnType<typeof createFakeUser>; readonly select?: boolean; readonly settings?: Record<string, string> } = {}) {
  const lay = layer('Default', 0);
  const server = new FakeServer([lay], ['core.general', ...DATA_TYPES.map((t) => t.id)]);
  server.declaredFields = FIELDS;
  const symbol = server.seed(symbolObject(lay.id, options.overrides ?? {}));
  if (options.locked === true) server.setLocked(lay.id, true);
  const one = await openBrowser(server, {
    declaredFields: FIELDS,
    fieldSets: FIELD_SETS,
    dataTypes: DATA_TYPES,
    ...(options.user === undefined ? {} : { user: options.user }),
  });
  const panels = showPanels(one);
  act(() => { one.map.activeLayer.set(lay.id); });
  if (options.select !== false) await select(one, symbol.id);
  return { server, lay, symbol, one, panels, stored: () => server.objects.get(symbol.id) as MapObject };
}

const updates = (server: FakeServer) => server.requests.filter((r) => r.operation === 'update') as unknown as { fields?: { plugin: string; name: string; value: unknown }[]; data: MapObject }[];
const creates = (server: FakeServer) => server.requests.filter((r) => r.operation === 'create') as unknown as { fields?: unknown; data: MapObject }[];
const optionsOf = (element: HTMLElement) => [...(element as HTMLSelectElement).options].map((o) => o.value);
const plus = (view: ReturnType<typeof showPanels>['properties']) => view.queryByRole('button', { name: 'Add a field set' });
const chosenSet = (view: ReturnType<typeof showPanels>['properties']) => (view.getByLabelText('Field set') as HTMLSelectElement).value;

describe('the data type select (criterion 50)', () => {
  it('offers the types users choose, and leaves out routes and detections', async () => {
    const { panels } = await scene({ select: false });
    expect(optionsOf(panels.symbols.getByLabelText('Data type'))).toEqual(['core.general', 'cot.cot', 'ais.vessel', 'ais.cargo']);
  });

  it('in Symbol properties offers the same, and the symbol\'s own type even when it is one users do not choose', async () => {
    const plain = await scene();
    expect(optionsOf(plain.panels.properties.getByLabelText('Data type'))).toEqual(['core.general', 'cot.cot', 'ais.vessel', 'ais.cargo']);
    const detection = await scene({ overrides: { dataType: 'gmti.detection' } });
    const select = detection.panels.properties.getByLabelText('Data type') as HTMLSelectElement;
    expect(optionsOf(select)).toEqual(['core.general', 'cot.cot', 'ais.vessel', 'ais.cargo', 'gmti.detection']);
    expect(select.selectedOptions[0]?.text).toBe('GMTI detection');
  });

  it('saving another field of a detection keeps its data type', async () => {
    const { server, panels, stored } = await scene({ overrides: { dataType: 'gmti.detection', dataSource: 'manual' } });
    await commit(panels.properties.getByLabelText('Name') as HTMLInputElement, 'Alpha');
    expect(updates(server)[0]?.data.dataType).toBe('gmti.detection');
    expect(stored().dataType).toBe('gmti.detection');
  });

  it('a kept choice that names such a type falls back to General, and a symbol is placed as General', async () => {
    window.localStorage.setItem(DATA_TYPE_KEY, 'simulator.route');
    const { server, one, panels } = await scene({ select: false });
    expect((panels.symbols.getByLabelText('Data type') as HTMLSelectElement).value).toBe('core.general');
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)[0]?.data.dataType).toBe('core.general');
  });

  it('a kept choice of a type users do choose is used', async () => {
    window.localStorage.setItem(DATA_TYPE_KEY, AIS.id);
    const { panels } = await scene({ select: false });
    expect((panels.symbols.getByLabelText('Data type') as HTMLSelectElement).value).toBe(AIS.id);
  });
});

describe('placing by type (criterion 51)', () => {
  it('choosing AIS vessel shows its set at once, opened on "AIS ship", before anything is placed', async () => {
    const { panels } = await scene({ select: false });
    expect(panels.symbols.queryByLabelText('Field set')).toBeNull(); // General has no set
    await choose(panels.symbols.getByLabelText('Data type'), AIS.id);
    expect(chosenSet(panels.symbols)).toBe('ais.ship');
    expect(panels.symbols.getByLabelText('MMSI')).toBeTruthy();
    expect(within(panels.symbols.getByRole('group', { name: 'AIS ship' })).getByLabelText('MMSI')).toBeTruthy();
  });

  it('a symbol placed with an MMSI typed carries the set from the store and the value, and the create lists no set the user did not add', async () => {
    const { server, one, panels } = await scene({ select: false });
    await choose(panels.symbols.getByLabelText('Data type'), AIS.id);
    fireEvent.change(panels.symbols.getByLabelText('MMSI'), { target: { value: '265123456' } });
    await settle();
    await placeAt(one, panels, STOCKHOLM);
    const [create] = creates(server);
    expect(create?.data.dataType).toBe(AIS.id);
    expect(create?.data.fieldSets).toBeUndefined();
    expect(create?.fields).toEqual([{ plugin: 'ais', name: 'mmsi', value: 265123456 }]);
    const placed = [...server.objects.values()].find((o) => o.dataType === AIS.id);
    expect(placed?.fieldSets).toEqual(['ais.ship']);
    expect(placed?.extensions).toEqual({ ais: { mmsi: 265123456 } });
  });
});

describe('a data type change (criterion 52)', () => {
  it('shows the sets of the data type of the symbol at once, also a stored symbol that does not carry them yet', async () => {
    const { panels } = await scene({ overrides: { dataType: AIS.id } });
    expect(chosenSet(panels.properties)).toBe('ais.ship');
    expect(panels.properties.getByLabelText('MMSI')).toBeTruthy();
    expect(plus(panels.properties)).not.toBeNull(); // CoT unit is still to add
  });

  it('General to CoT is one update with the new dataType, and the editor shows "CoT unit" chosen', async () => {
    const { server, panels, stored } = await scene();
    expect(panels.properties.queryByLabelText('Field set')).toBeNull();
    await choose(panels.properties.getByLabelText('Data type'), COT.id);
    expect(server.requests).toHaveLength(1);
    expect(updates(server)[0]?.data.dataType).toBe(COT.id);
    expect(updates(server)[0]?.data.fieldSets).toBeUndefined(); // the store adds the set
    expect(stored().fieldSets).toEqual(['cot.unit']);
    expect(chosenSet(panels.properties)).toBe('cot.unit');
    expect(panels.properties.getByLabelText('Callsign')).toBeTruthy();
  });

  it('CoT on to AIS vessel keeps cot.unit and its values and adds ais.ship, shown chosen', async () => {
    const { panels, stored } = await scene({ overrides: { dataType: COT.id, fieldSets: ['cot.unit'], extensions: { cot: { callsign: 'Hawk' } } } });
    await choose(panels.properties.getByLabelText('Data type'), AIS.id);
    expect(stored().dataType).toBe(AIS.id);
    expect(stored().fieldSets).toEqual(['cot.unit', 'ais.ship']);
    expect(chosenSet(panels.properties)).toBe('ais.ship');
    await choose(panels.properties.getByLabelText('Field set'), 'cot.unit');
    expect((panels.properties.getByLabelText('Callsign') as HTMLInputElement).value).toBe('Hawk');
    expect(stored().extensions).toEqual({ cot: { callsign: 'Hawk' } });
  });
});

describe('values placed with a data type change (function 21)', () => {
  it('stay when the new data type brings the same set, and go when it does not', async () => {
    const { server, one, panels } = await scene({ select: false });
    await choose(panels.symbols.getByLabelText('Data type'), AIS.id);
    fireEvent.change(panels.symbols.getByLabelText('MMSI'), { target: { value: '265123456' } });
    await settle();
    await choose(panels.symbols.getByLabelText('Data type'), CARGO.id);
    expect((panels.symbols.getByLabelText('MMSI') as HTMLInputElement).value).toBe('265123456');
    await choose(panels.symbols.getByLabelText('Data type'), COT.id);
    await choose(panels.symbols.getByLabelText('Data type'), AIS.id);
    expect((panels.symbols.getByLabelText('MMSI') as HTMLInputElement).value).toBe(''); // CoT does not carry Ais ship
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)[0]).not.toHaveProperty('fields');
  });
});

describe('the "+" and read only (criterion 53)', () => {
  it('a symbol of AIS vessel with ais.ship offers CoT unit in the "+" menu; adding it is one update and chooses it; then the "+" is gone', async () => {
    const { server, panels, stored } = await scene({ overrides: { dataType: AIS.id, fieldSets: ['ais.ship'] } });
    fireEvent.click(panels.properties.getByRole('button', { name: 'Add a field set' }));
    expect(within(panels.properties.getByRole('menu', { name: 'Field sets to add' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['CoT unit']);
    fireEvent.click(panels.properties.getByRole('menuitem', { name: 'CoT unit' }));
    await settle();
    expect(updates(server)).toHaveLength(1);
    expect(updates(server)[0]?.data.fieldSets).toEqual(['ais.ship', 'cot.unit']);
    expect(stored().fieldSets).toEqual(['ais.ship', 'cot.unit']);
    expect(chosenSet(panels.properties)).toBe('cot.unit');
    expect(plus(panels.properties)).toBeNull();
  });

  it('without the edit permission there is no "+", and the drop-down chooses the set to see, its fields read only', async () => {
    const { panels } = await scene({ user: createFakeUser({ permissions: [] }), overrides: { dataType: AIS.id, fieldSets: ['ais.ship', 'cot.unit'], extensions: { ais: { mmsi: 1 }, cot: { callsign: 'Hawk' } } } });
    expect(plus(panels.properties)).toBeNull();
    expect((panels.properties.getByLabelText('MMSI') as HTMLInputElement).disabled).toBe(true);
    await choose(panels.properties.getByLabelText('Field set'), 'cot.unit');
    expect((panels.properties.getByLabelText('Callsign') as HTMLInputElement).disabled).toBe(true);
  });

  it('in a locked layer there is no "+", and the fields are read only', async () => {
    const { panels } = await scene({ locked: true, overrides: { dataType: AIS.id, fieldSets: ['ais.ship'] } });
    expect(plus(panels.properties)).toBeNull();
    expect((panels.properties.getByLabelText('MMSI') as HTMLInputElement).disabled).toBe(true);
  });

  it('in the Symbols panel the "+" adds a set to the type\'s and the create lists only the added one', async () => {
    const { server, one, panels } = await scene({ select: false });
    await choose(panels.symbols.getByLabelText('Data type'), AIS.id);
    await addSet(panels.symbols, 'CoT unit');
    expect(chosenSet(panels.symbols)).toBe('cot.unit');
    expect(optionsOf(panels.symbols.getByLabelText('Field set'))).toEqual(['cot.unit', 'ais.ship']); // the added sets, then the type's
    await placeAt(one, panels, STOCKHOLM);
    expect(creates(server)[0]?.data.fieldSets).toEqual(['cot.unit']);
    expect([...server.objects.values()].find((o) => o.dataType === AIS.id)?.fieldSets).toEqual(['cot.unit', 'ais.ship']);
  });
});
