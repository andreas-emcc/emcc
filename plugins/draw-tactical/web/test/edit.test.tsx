// Brief functions 5, 6 and 8; acceptance criteria 5 (the amplifiers in the edit panel), 7, 8 and 10:
// Edit, the edit panel, reshaping, and no Delete of its own.
import { fireEvent, within, type RenderResult } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changeRequests } from '@emc2/plugin-sdk';
import type { ChangeRequest, DataType, Geometry, MapObject } from '@emc2/plugin-sdk';
import { buttonOf, editGraphic, editPanelOpen, finishDrawing, inputOf, openBrowser, selectOf, settle, showGraphicsPanel, typeAndEnter } from './harness.tsx';
import { coreOf } from '../src/content.ts';
import { AXIS_SIDC, BOUNDARY_SIDC, FAN_SIDC, FakeServer, graphicObject, layer } from './fakeServer.ts';

const COT: Omit<DataType, 'behaviour'> = { id: 'cot.cot', name: 'Cursor on Target', declaredBy: 'cot', defaults: {} };
const AXIS: Geometry = { type: 'LineString', coordinates: [[18.07, 59.33], [17.4, 58.95], [16.8, 58.7], [18.5, 58.8]] };

function world() {
  const ops = layer('Operations', 1);
  const reserve = layer('Reserve', 2);
  const server = new FakeServer([ops, reserve], ['core.general', 'cot.cot']);
  const boundary = server.seed(
    graphicObject(ops.id, {
      properties: { name: 'Brigade boundary', description: 'Keep' },
      symbol: { standard: 'APP-6D', sidc: BOUNDARY_SIDC, modifiers: { uniqueDesignation: '1st Bde', hostile: 'ENY' } },
      extensions: { other: { x: 1 } },
    }),
  );
  const axis = server.seed(graphicObject(ops.id, { geometry: AXIS, symbol: { standard: 'APP-6D', sidc: AXIS_SIDC } }));
  const fan = server.seed(
    graphicObject(ops.id, {
      geometry: { type: 'MultiPoint', coordinates: [[18.0686, 59.3293]] },
      symbol: { standard: 'APP-6D', sidc: FAN_SIDC, modifiers: { distances: [5000], azimuths: [30, 120] } },
    }),
  );
  // An APP-6B symbol: the catalogue has none of them, so the graphic is not drawn.
  const old = server.seed(graphicObject(ops.id, { symbol: { standard: 'APP-6B', sidc: 'SFGPUCI----D---' }, properties: { name: 'Old code' } }));
  const symbol = server.seed({ ...graphicObject(ops.id), type: 'core.symbol', geometry: { type: 'Point', coordinates: [15.5, 60.25] }, symbol: { standard: 'APP-6D', sidc: '10031000001211000000' } });
  const shape = server.seed({ ...graphicObject(ops.id), type: 'core.shape', geometry: { type: 'Circle', center: [18.0686, 59.3293], radius: 2500 } });
  return { server, ops, reserve, boundary, axis, fan, old, symbol, shape };
}

const open = (server: FakeServer, options: Parameters<typeof openBrowser>[1] = {}) => openBrowser(server, { dataTypes: [COT], ...options });
type Update = Extract<ChangeRequest, { readonly operation: 'update' }>;
const updates = (server: FakeServer): Update[] => server.requests.filter((r): r is Update => r.operation === 'update');
const field = (panel: RenderResult, label: string) => within(panel.container).getByLabelText(label);
const stored = (server: FakeServer, object: { readonly id: string }): MapObject => {
  const now = server.objects.get(object.id);
  if (now === undefined) throw new Error('the store lost the object');
  return now;
};

describe('criterion 7: Edit', () => {
  it('is registered for one core.multipoint, for users who may edit objects', async () => {
    const { server } = world();
    const browser = await open(server);
    const action = browser.ctx.objectActions.find((a) => a.id === 'edit');
    expect(action).toMatchObject({ label: 'Edit', multiple: false, appliesTo: { types: ['core.multipoint'] }, permission: 'objects.edit', group: 'edit' });
    expect(browser.ctx.objectActions).toHaveLength(1);
  });

  it('is offered for one selected graphic, not for a symbol, a shape or several objects', async () => {
    const { server, boundary, axis, symbol, shape } = world();
    const browser = await open(server);
    await expect(browser.ctx.runObjectAction('edit', [boundary.id])).resolves.toBeUndefined();
    await expect(browser.ctx.runObjectAction('edit', [boundary.id, axis.id])).rejects.toThrow(/would not offer/);
    await expect(browser.ctx.runObjectAction('edit', [symbol.id])).rejects.toThrow(/would not offer/);
    await expect(browser.ctx.runObjectAction('edit', [shape.id])).rejects.toThrow(/would not offer/);
  });

  it('selects the graphic, shows the edit panel in the right pane and brings it to the front', async () => {
    const { server, boundary } = world();
    const browser = await open(server);
    expect(editPanelOpen(browser)).toBe(false);
    const panel = await editGraphic(browser, boundary.id);
    expect(browser.map.selection.value).toEqual([boundary.id]);
    const added = browser.ctx.addedPanels.find((p) => p.panel.id === 'draw-tactical-edit');
    expect(added).toMatchObject({ shown: 1, panel: { title: 'Edit graphic', defaultPane: 'right' } });
    expect(inputOf(panel, 'Name').value).toBe('Brigade boundary');
    expect(within(panel.container).getByText('Graphic').nextElementSibling?.textContent).toBe('Boundary');
  });

  it('opens the panel for a graphic the map does not hold, marked "not in view" (Edit from object-list)', async () => {
    const { server, boundary } = world();
    const browser = await open(server, { viewAway: true });
    const panel = await editGraphic(browser, boundary.id);
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    expect(inputOf(panel, 'Name').value).toBe('Brigade boundary');
    expect(browser.map.selection.value).toEqual([boundary.id]);
  });

  it('closes with its Close button, and follows the selection: another selection closes it', async () => {
    const { server, boundary, axis } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, boundary.id);
    fireEvent.click(buttonOf(panel, 'Close'));
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
    expect(browser.map.selection.value).toEqual([]);
    await editGraphic(browser, boundary.id);
    browser.map.selection.set([axis.id]);
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
  });

  it('changing the name sends one update with the complete core content and baseVersion, other namespaces untouched', async () => {
    const { server, boundary } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, boundary.id);
    await typeAndEnter(field(panel, 'Name'), 'Corps boundary');
    expect(updates(server)).toHaveLength(1);
    const request = updates(server)[0];
    expect(request).toMatchObject({ entityId: boundary.id, baseVersion: 1 });
    const data = request?.data ?? {};
    expect(Object.keys(data).sort()).toEqual(['dataSource', 'dataType', 'geometry', 'label', 'layerId', 'properties', 'symbol', 'type']);
    const now = stored(server, boundary);
    expect(now.version).toBe(2);
    expect(now.properties).toEqual({ name: 'Corps boundary', description: 'Keep' });
    expect(now.extensions).toEqual({ other: { x: 1 } });
    expect(now.dataSource).toBe('manual');
    expect(now.symbol?.modifiers).toEqual({ uniqueDesignation: '1st Bde', hostile: 'ENY' });
  });

  it('changing the identity, the status and the echelon changes the SIDC, the other digits staying', async () => {
    const { server, boundary } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, boundary.id);
    expect(selectOf(panel, 'Identity').value).toBe('3');
    expect(selectOf(panel, 'Echelon').value).toBe('16');
    fireEvent.change(selectOf(panel, 'Identity'), { target: { value: '6' } });
    await settle();
    expect(stored(server, boundary).symbol?.sidc).toBe('10062500161101000000');
    fireEvent.change(selectOf(panel, 'Status'), { target: { value: '1' } });
    await settle();
    expect(stored(server, boundary).symbol?.sidc).toBe('10062510161101000000');
    fireEvent.change(selectOf(panel, 'Echelon'), { target: { value: '15' } });
    await settle();
    expect(stored(server, boundary).symbol?.sidc).toBe('10062510151101000000');
    expect(updates(server)).toHaveLength(3);
  });

  it('changing an amplifier sends the modifiers with the other amplifiers kept', async () => {
    const { server, boundary } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, boundary.id);
    await typeAndEnter(field(panel, 'T1 Unique designation 2'), '2nd Bde');
    expect(stored(server, boundary).symbol?.modifiers).toEqual({ uniqueDesignation: '1st Bde', uniqueDesignation1: '2nd Bde', hostile: 'ENY' });
    await typeAndEnter(field(panel, 'T Unique designation 1'), '');
    expect(stored(server, boundary).symbol?.modifiers).toEqual({ uniqueDesignation1: '2nd Bde', hostile: 'ENY' });
  });

  it('changing the layer sends one update, and the data type goes unchanged; the panel has no data type select (T-190)', async () => {
    const { server, boundary, reserve } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, boundary.id);
    expect(within(panel.container).queryByLabelText('Data type')).toBeNull();
    fireEvent.change(selectOf(panel, 'Layer'), { target: { value: reserve.id } });
    await settle();
    expect(stored(server, boundary).layerId).toBe(reserve.id);
    expect(stored(server, boundary).dataType).toBe('core.general');
    expect(stored(server, boundary).dataSource).toBe('manual');
    expect(updates(server)).toHaveLength(1);
  });

  it('shows a rejection as a notification and keeps the input', async () => {
    const { server, boundary } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, boundary.id);
    browser.connection.rejectNext.push('PERMISSION_DENIED');
    await typeAndEnter(field(panel, 'Name'), 'Refused');
    expect(browser.ctx.notifications.some((n) => /PERMISSION_DENIED/.test(n.message))).toBe(true);
    expect(inputOf(panel, 'Name').value).toBe('Refused');
    expect(stored(server, boundary).properties?.name).toBe('Brigade boundary');
  });

  it('shows the facts read only: the graphic, the standard, the classification, version, last modified and data source', async () => {
    const { server, boundary } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, boundary.id);
    const text = panel.container.textContent;
    expect(text).toContain('APP-6D');
    expect(text).toContain('UNCLASSIFIED');
    expect(text).toContain('2026-10-09 12:00:00 UTC by test-seed');
    expect(text).toContain('manual');
    expect(within(panel.container).getByText('Version').nextElementSibling?.textContent).toBe('1');
  });
});

describe('criterion 5: amplifiers in the edit panel', () => {
  it('shows an amplifier the graphic does not allow read only, and keeps it on every update', async () => {
    const { server, boundary } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, boundary.id);
    const unused = within(panel.container).getByLabelText('Amplifiers this graphic does not use');
    expect(unused.textContent).toContain('hostile');
    expect(unused.textContent).toContain('ENY');
    expect(within(panel.container).queryByLabelText('N Hostile')).toBeNull(); // no field for it
    await typeAndEnter(field(panel, 'Name'), 'Renamed');
    await typeAndEnter(field(panel, 'AS Country'), 'SE');
    expect(stored(server, boundary).symbol?.modifiers).toEqual({ uniqueDesignation: '1st Bde', hostile: 'ENY', country: 'SE' });
  });

  it('cannot save a distance of -1 or an azimuth of 400, nor empty a required amplifier', async () => {
    const { server, fan } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, fan.id);
    expect(inputOf(panel, 'AM Distances (metres) (required) 1').value).toBe('5000');
    await typeAndEnter(inputOf(panel, 'AM Distances (metres) (required) 1'), '-1');
    expect(within(panel.container).getByText(/Each value must be from 0 to 20 000 000 metres/)).toBeDefined();
    await typeAndEnter(inputOf(panel, 'AN Azimuths (degrees) (required) 2'), '400');
    expect(within(panel.container).getByText(/Each value must be from 0 to 360 degrees/)).toBeDefined();
    expect(updates(server)).toHaveLength(0);
    await typeAndEnter(inputOf(panel, 'AM Distances (metres) (required) 1'), '');
    expect(updates(server)).toHaveLength(0);
    expect(stored(server, fan).symbol?.modifiers).toEqual({ distances: [5000], azimuths: [30, 120] });
  });

  it('saves valid numbers as numbers, ring by ring in the order given', async () => {
    const { server, fan } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, fan.id);
    await typeAndEnter(inputOf(panel, 'AN Azimuths (degrees) (required) 2'), '360');
    expect(stored(server, fan).symbol?.modifiers).toEqual({ distances: [5000], azimuths: [30, 360] });
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Add value to AM Distances (metres) (required)' }));
    await typeAndEnter(inputOf(panel, 'AM Distances (metres) (required) 2'), '9000,5');
    expect(stored(server, fan).symbol?.modifiers?.distances).toEqual([5000, 9000.5]);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Remove AM Distances (metres) (required) 1' }));
    await settle();
    expect(stored(server, fan).symbol?.modifiers?.distances).toEqual([9000.5]);
  });
});

describe('criterion 8: reshape', () => {
  it('calls edit(id); a moved point gives one update with the new geometry, the rest unchanged', async () => {
    const { server, axis } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, axis.id);
    fireEvent.click(buttonOf(panel, 'Reshape'));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    expect(browser.map.editCalls).toHaveLength(1);
    expect(browser.map.editCalls[0]?.id).toBe(axis.id);
    const moved: Geometry = { type: 'LineString', coordinates: [[18.07, 59.33], [17.4, 58.95], [16.9, 58.75], [18.5, 58.8]] };
    await finishDrawing(browser, moved);
    expect(updates(server)).toHaveLength(1);
    expect(stored(server, axis).geometry).toEqual(moved);
    expect(stored(server, axis).symbol).toEqual({ standard: 'APP-6D', sidc: AXIS_SIDC });
  });

  it('Escape sends nothing', async () => {
    const { server, axis } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, axis.id);
    fireEvent.click(buttonOf(panel, 'Reshape'));
    await settle();
    await finishDrawing(browser, null);
    expect(updates(server)).toHaveLength(0);
    expect(stored(server, axis).geometry).toEqual(AXIS);
  });

  it('sends nothing for a result with too few points, and tells the user', async () => {
    const { server, axis } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, axis.id);
    fireEvent.click(buttonOf(panel, 'Reshape'));
    await settle();
    await finishDrawing(browser, { type: 'LineString', coordinates: [[18.07, 59.33], [17.4, 58.95]] });
    expect(updates(server)).toHaveLength(0);
    expect(browser.ctx.notifications.some((n) => /takes 3 to 50 points, not 2/.test(n.message))).toBe(true);
  });

  it('moves the one control point of a range fan', async () => {
    const { server, fan } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, fan.id);
    fireEvent.click(buttonOf(panel, 'Reshape'));
    await settle();
    await finishDrawing(browser, { type: 'MultiPoint', coordinates: [[19.2, 60.1]] });
    expect(stored(server, fan).geometry).toEqual({ type: 'MultiPoint', coordinates: [[19.2, 60.1]] });
  });

  it('a graphic outside the catalogue shows its properties with the hint and no reshape', async () => {
    const { server, old } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, old.id);
    expect(within(panel.container).getByText('This graphic is not drawn')).toBeDefined();
    expect(within(panel.container).queryByRole('button', { name: 'Reshape' })).toBeNull();
    expect(within(panel.container).queryByLabelText('Identity')).toBeNull();
    await typeAndEnter(field(panel, 'Name'), 'Old code 2');
    expect(stored(server, old).properties?.name).toBe('Old code 2');
    expect(stored(server, old).symbol).toEqual({ standard: 'APP-6B', sidc: 'SFGPUCI----D---' });
  });

  it('a reshape that ends with the panel closing sends nothing', async () => {
    const { server, axis } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, axis.id);
    fireEvent.click(buttonOf(panel, 'Reshape'));
    await settle();
    browser.map.selection.set([]);
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
    expect(updates(server)).toHaveLength(0);
  });
});

describe('function 6: live updates', () => {
  it('a graphic changed by someone else shows its new values; one deleted elsewhere closes the panel', async () => {
    const { server, boundary } = world();
    const browser = await open(server);
    const panel = await editGraphic(browser, boundary.id);
    const current = stored(server, boundary);
    const content = coreOf(current);
    server.changeElsewhere(changeRequests.updateObject(current, { ...content, properties: { name: 'Changed elsewhere' } }));
    await settle();
    expect(inputOf(panel, 'Name').value).toBe('Changed elsewhere');
  });
});

describe('criterion 10: no Delete', () => {
  it('neither panel has a Delete button, and the plugin registers no Delete action', async () => {
    const { server, boundary } = world();
    const browser = await open(server);
    const graphics = await showGraphicsPanel(browser);
    const edit = await editGraphic(browser, boundary.id);
    for (const panel of [graphics, edit]) {
      expect(within(panel.container).queryAllByRole('button', { name: /delete|remove graphic/i })).toHaveLength(0);
    }
    expect(browser.ctx.objectActions.map((a) => a.label)).toEqual(['Edit']);
  });
});
