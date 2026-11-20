// Brief functions 3 to 5 and 9 to 10; acceptance criteria 6 to 10, 12 and 15: Edit, the edit panel
// and reshaping.
import { act, fireEvent, screen, within, type RenderResult } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChangeRequest, DataType, Geometry, MapObject } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import { chooseTool, editPanelOpen, editShape, finishDrawing, openBrowser, settle, showShapesPanel, typeAndEnter, inputOf, selectOf, buttonOf } from './harness.tsx';
import { FakeServer, layer, shapeObject } from './fakeServer.ts';

const RECT: Geometry = { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] };
const COT: Omit<DataType, 'behaviour'> = { id: 'cot.cot', name: 'Cursor on Target', declaredBy: 'cot', defaults: {} };

function world() {
  const ops = layer('Operations', 1);
  const reserve = layer('Reserve', 2);
  const server = new FakeServer([ops, reserve], ['core.general', 'cot.cot']);
  const rect = server.seed(
    shapeObject(ops.id, {
      geometry: RECT,
      style: { strokeColor: '#1f3a93', strokeWidth: 2, strokeDash: 'solid', strokeOpacity: 0.8, fillColor: '#1f3a93', fillOpacity: 0.2 },
      properties: { name: 'Objective', description: 'Hold the bridge' },
      extensions: { 'draw-shapes': { kind: 'rectangle' }, other: { x: 1 } },
    }),
  );
  const circle = server.seed(shapeObject(ops.id, { properties: { name: 'Zone' } }));
  const symbol = server.seed({
    ...shapeObject(ops.id),
    type: 'core.symbol',
    geometry: { type: 'Point', coordinates: [15.5, 60.25] },
    symbol: { standard: 'APP-6D', sidc: '10031000001211000000' },
  });
  return { server, ops, reserve, rect, circle, symbol };
}

const open = (server: FakeServer, options: Parameters<typeof openBrowser>[1] = {}) => openBrowser(server, { dataTypes: [COT], ...options });
const updates = (server: FakeServer): ChangeRequest[] => server.requests.filter((r) => r.operation === 'update');
const field = (panel: RenderResult, label: string) => within(panel.container).getByLabelText(label);
const stored = (server: FakeServer, object: MapObject): MapObject => {
  const now = server.objects.get(object.id);
  if (now === undefined) throw new Error('the store lost the object');
  return now;
};

describe('criterion 6: Edit', () => {
  it('is registered for one core.shape, for users who may edit objects', async () => {
    const { server } = world();
    const browser = await open(server);
    const action = browser.ctx.objectActions.find((a) => a.id === 'edit');
    expect(action).toMatchObject({ label: 'Edit', multiple: false, appliesTo: { types: ['core.shape'] }, permission: 'objects.edit', group: 'edit' });
    expect(browser.ctx.objectActions).toHaveLength(1);
  });

  it('is offered for one selected shape, not for several and not for a symbol', async () => {
    const { server, rect, circle, symbol } = world();
    const browser = await open(server);
    await expect(browser.ctx.runObjectAction('edit', [rect.id])).resolves.toBeUndefined();
    await expect(browser.ctx.runObjectAction('edit', [rect.id, circle.id])).rejects.toThrow(/would not offer/);
    await expect(browser.ctx.runObjectAction('edit', [symbol.id])).rejects.toThrow(/would not offer/);
  });

  it('selects the shape, shows the edit panel and brings it to the front', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    expect(editPanelOpen(browser)).toBe(false);
    const panel = await editShape(browser, rect.id);
    expect(browser.map.selection.value).toEqual([rect.id]);
    const added = browser.ctx.addedPanels.find((p) => p.panel.id === 'draw-shapes-edit');
    expect(added).toMatchObject({ shown: 1, panel: { title: 'Edit shape', defaultPane: 'right' } });
    expect(inputOf(panel, 'Name').value).toBe('Objective');
  });

  it('opens the panel for a shape the map does not hold, marked "not in view" (Edit from object-list)', async () => {
    const { server, rect } = world();
    const browser = await open(server, { viewAway: true });
    const panel = await editShape(browser, rect.id);
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    expect(inputOf(panel, 'Name').value).toBe('Objective');
    expect(browser.map.selection.value).toEqual([rect.id]);
  });

  it('replaces the panel when Edit is chosen for another shape', async () => {
    const { server, rect, circle } = world();
    const browser = await open(server);
    await editShape(browser, rect.id);
    document.body.replaceChildren();
    const panel = await editShape(browser, circle.id);
    expect(browser.ctx.addedPanels.filter((p) => p.panel.id === 'draw-shapes-edit')).toHaveLength(1);
    expect(inputOf(panel, 'Name').value).toBe('Zone');
    expect(browser.map.selection.value).toEqual([circle.id]);
  });

  it('closes with its Close button and clears the shape from the selection', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Close' }));
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
    expect(browser.map.selection.value).toEqual([]);
  });
});

describe('function 4: the edit panel shows', () => {
  it('the kind as drawn, and read only the classification, version, last modified and data source', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    const text = panel.container.textContent;
    expect(text).toContain('Rectangle');
    expect(text).toContain('UNCLASSIFIED');
    expect(text).toContain('2026-10-09 12:00:00 UTC by test-seed');
    expect(text).toContain('manual');
    expect(within(panel.container).getByText('Version').nextElementSibling?.textContent).toBe('1');
  });

  it('names the geometry for a shape without a kind of ours', async () => {
    const { server, circle } = world();
    const browser = await open(server);
    const panel = await editShape(browser, circle.id);
    expect(within(panel.container).getByText('Kind').nextElementSibling?.textContent).toBe('Circle');
  });

  it('shows the properties only for a geometry the editing service does not reshape', async () => {
    const { server, ops } = world();
    const corridor = server.seed(shapeObject(ops.id, { geometry: { type: 'Corridor', coordinates: [[18, 59], [18.5, 59.2]], width: 400 }, properties: { name: 'Lane' } }));
    const browser = await open(server);
    const panel = await editShape(browser, corridor.id);
    expect(within(panel.container).queryByRole('button', { name: 'Reshape' })).toBeNull();
    expect(within(panel.container).getByText(/cannot be reshaped here/)).toBeDefined();
    await typeAndEnter(field(panel, 'Name'), 'Lane 2');
    expect(stored(server, corridor).properties?.name).toBe('Lane 2');
  });

  it('edits a shape another plugin created, with its data type that is not available kept', async () => {
    const { server, ops } = world();
    const foreign = server.seed(shapeObject(ops.id, { dataType: 'gone.type', dataSource: 'gone-stream', properties: { name: 'Foreign' } }));
    const browser = await open(server);
    const panel = await editShape(browser, foreign.id);
    const select = selectOf(panel, 'Data type');
    expect(select.value).toBe('gone.type');
    expect([...select.options].map((o) => o.textContent)).toContain('gone.type (not available)');
    await typeAndEnter(field(panel, 'Name'), 'Foreign 2');
    // The type is not available and stays as it is; the store accepts that for an unchanged type (model rule 14).
    expect(stored(server, foreign)).toMatchObject({ dataType: 'gone.type', dataSource: 'gone-stream', properties: { name: 'Foreign 2' } });
  });
});

describe('criterion 36 (M6, function 18): the edit panel\'s data type select', () => {
  const ROUTE: Omit<DataType, 'behaviour'> = { id: 'simulator.route', name: 'Route', declaredBy: 'simulator', defaults: {}, manual: false };
  const PLATFORM: Omit<DataType, 'behaviour'> = { id: 'gmti.platform', name: 'GMTI platform', declaredBy: 'gmti', defaults: {}, manual: false };
  const VESSEL: Omit<DataType, 'behaviour'> = { id: 'ais.vessel', name: 'AIS vessel', declaredBy: 'ais', defaults: {} };
  const ALL = ['core.general', 'cot.cot', 'simulator.route', 'gmti.platform', 'ais.vessel'];

  it('leaves out the types users do not choose, unless the shape has one: it keeps its type, and saving its name changes nothing else', async () => {
    const ops = layer('Operations', 1);
    const server = new FakeServer([ops], ALL);
    const plain = server.seed(shapeObject(ops.id, { properties: { name: 'Plain' } }));
    const platform = server.seed(shapeObject(ops.id, { dataType: 'gmti.platform', dataSource: 'gmti-stream', properties: { name: 'Dwell' } }));
    const browser = await open(server, { dataTypes: [COT, ROUTE, PLATFORM, VESSEL] });
    const first = await editShape(browser, plain.id);
    expect([...selectOf(first, 'Data type').options].map((o) => o.textContent)).toEqual(['General', 'Cursor on Target', 'AIS vessel']);
    const second = await editShape(browser, platform.id);
    const select = selectOf(second, 'Data type');
    expect([...select.options].map((o) => o.textContent)).toEqual(['General', 'Cursor on Target', 'GMTI platform', 'AIS vessel']);
    expect(select.value).toBe('gmti.platform');
    await typeAndEnter(field(second, 'Name'), 'Dwell 2');
    expect(stored(server, platform)).toMatchObject({ dataType: 'gmti.platform', dataSource: 'gmti-stream', properties: { name: 'Dwell 2' } });
  });
});

describe('criterion 7 and function 5: updates', () => {
  it('a renamed shape is one update with every core field, baseVersion, and the data source unchanged', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    await typeAndEnter(field(panel, 'Name'), 'Objective NORTH');
    expect(updates(server)).toHaveLength(1);
    const request = updates(server)[0];
    expect(request).toMatchObject({ entityType: 'object', operation: 'update', entityId: rect.id, baseVersion: 1 });
    const data = request && 'data' in request ? request.data : null;
    expect(data).toEqual({
      type: 'core.shape',
      dataType: 'core.general',
      dataSource: 'manual',
      layerId: rect.layerId,
      geometry: RECT,
      style: rect.style,
      properties: { name: 'Objective NORTH', description: 'Hold the bridge' },
      label: rect.label,
    });
    expect(stored(server, rect).version).toBe(2);
  });

  it('sends nothing on a keystroke, and nothing when the value did not change', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    const name = field(panel, 'Name');
    fireEvent.change(name, { target: { value: 'Obj' } });
    fireEvent.change(name, { target: { value: 'Objec' } });
    expect(updates(server)).toHaveLength(0);
    fireEvent.change(name, { target: { value: 'Objective' } }); // back to the stored value
    fireEvent.blur(name);
    await settle();
    expect(updates(server)).toHaveLength(0);
  });

  it('leaving the field commits it, and Enter then blur sends only one update', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    const name = field(panel, 'Name');
    fireEvent.change(name, { target: { value: 'Left alone' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.blur(name);
    await settle();
    expect(updates(server)).toHaveLength(1);
    expect(stored(server, rect).properties?.name).toBe('Left alone');
  });

  it('an emptied name removes the name and keeps the description', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    await typeAndEnter(field(panel, 'Name'), '   ');
    expect(stored(server, rect).properties).toEqual({ description: 'Hold the bridge' });
  });

  it('changes the style fields, keeps those the form does not show, and sends the hatched fill and the arrowhead as the model defines them', async () => {
    const { server, rect, ops } = world();
    const route = server.seed(shapeObject(ops.id, {
      geometry: { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [18.07, 59.33]] },
      style: { strokeColor: '#2c784c', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
      extensions: { 'draw-shapes': { kind: 'route' } },
    }));
    const browser = await open(server);
    let panel = await editShape(browser, rect.id);

    const colour = field(panel, 'Outline colour');
    fireEvent.change(colour, { target: { value: '#aa3300' } });
    expect(updates(server)).toHaveLength(0); // typed, not committed
    fireEvent.blur(colour);
    await settle();
    fireEvent.change(field(panel, 'Outline width'), { target: { value: '5' } });
    await settle();
    fireEvent.change(field(panel, 'Outline dash'), { target: { value: 'dot' } });
    await settle();
    fireEvent.change(field(panel, 'Fill'), { target: { value: 'hatched' } });
    await settle();
    expect(stored(server, rect).style).toEqual({
      strokeColor: '#aa3300', strokeWidth: 5, strokeDash: 'dot', strokeOpacity: 0.8, fillColor: '#1f3a93', fillOpacity: 0.2, fillPattern: 'hatch',
    });
    fireEvent.change(field(panel, 'Fill'), { target: { value: 'none' } });
    await settle();
    expect(stored(server, rect).style).toEqual({ strokeColor: '#aa3300', strokeWidth: 5, strokeDash: 'dot', strokeOpacity: 0.8 });

    document.body.replaceChildren();
    panel = await editShape(browser, route.id);
    expect(within(panel.container).getByText('Kind').nextElementSibling?.textContent).toBe('Route');
    expect(within(panel.container).queryByLabelText('Fill')).toBeNull(); // a line has no fill
    fireEvent.click(within(panel.container).getByLabelText('Markers at the points'));
    await settle();
    expect(stored(server, route).style).toEqual({ strokeColor: '#2c784c', strokeWidth: 2, strokeDash: 'dash' });
  });

  it('moves the shape to another layer', async () => {
    const { server, rect, reserve } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    const select = selectOf(panel, 'Layer');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Reserve', 'Operations']);
    fireEvent.change(select, { target: { value: reserve.id } });
    await settle();
    expect(stored(server, rect).layerId).toBe(reserve.id);
    expect(stored(server, rect).version).toBe(2);
  });

  it('changes the data type and leaves the data source', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    fireEvent.change(field(panel, 'Data type'), { target: { value: 'cot.cot' } });
    await settle();
    expect(stored(server, rect)).toMatchObject({ dataType: 'cot.cot', dataSource: 'manual' });
  });

  it('an update from a second browser reaches the first (criterion 7)', async () => {
    const { server, rect } = world();
    const a = await open(server);
    const b = await open(server);
    const panelA = await editShape(a, rect.id);
    const panelB = await editShape(b, rect.id);
    await typeAndEnter(field(panelA, 'Name'), 'From A');
    expect(inputOf(panelB, 'Name').value).toBe('From A');
  });
});

describe('criterion 9: other plugins\' extensions', () => {
  it('stay as they are on every update, and no extension is sent', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    await typeAndEnter(field(panel, 'Name'), 'Renamed');
    fireEvent.change(field(panel, 'Outline width'), { target: { value: '8' } });
    await settle();
    expect(updates(server)).toHaveLength(2);
    for (const request of updates(server)) {
      const data = 'data' in request ? request.data : null;
      expect(data).not.toHaveProperty('extensions');
    }
    expect(stored(server, rect).extensions).toEqual({ 'draw-shapes': { kind: 'rectangle' }, other: { x: 1 } });
  });
});

describe('criterion 15: the kind', () => {
  it('a drawn rectangle has its kind in the extension, the panel says Rectangle, and the kind survives a new name and style', async () => {
    const ops = layer('Operations', 1);
    const server = new FakeServer([ops], ['core.general']);
    const browser = await openBrowser(server);
    showShapesPanel(browser);
    await chooseTool('Rectangle');
    await finishDrawing(browser, RECT);
    await chooseTool('Rectangle'); // off
    const drawn = [...server.objects.values()][0];
    expect(drawn?.extensions).toEqual({ 'draw-shapes': { kind: 'rectangle' } });
    document.body.replaceChildren();

    const panel = await editShape(browser, drawn?.id ?? '');
    expect(within(panel.container).getByText('Kind').nextElementSibling?.textContent).toBe('Rectangle');
    await typeAndEnter(field(panel, 'Name'), 'Renamed');
    fireEvent.change(field(panel, 'Outline width'), { target: { value: '6' } });
    await settle();
    fireEvent.change(field(panel, 'Fill'), { target: { value: 'transparent' } });
    await settle();
    const after = server.objects.get(drawn?.id ?? '');
    expect(after?.version).toBe(4);
    expect(after?.extensions).toEqual({ 'draw-shapes': { kind: 'rectangle' } });
    expect(within(panel.container).getByText('Kind').nextElementSibling?.textContent).toBe('Rectangle');
  });

  it('an arrow stays an arrow and a route stays a route after a style change', async () => {
    const ops = layer('Operations', 1);
    const server = new FakeServer([ops], ['core.general']);
    const browser = await openBrowser(server);
    showShapesPanel(browser);
    await chooseTool('Arrow');
    await finishDrawing(browser, { type: 'LineString', coordinates: [[16.5, 58.6], [18.07, 59.33]] });
    await chooseTool('Arrow'); // off
    const arrow = [...server.objects.values()][0];
    document.body.replaceChildren();
    const panel = await editShape(browser, arrow?.id ?? '');
    expect(within(panel.container).getByText('Kind').nextElementSibling?.textContent).toBe('Arrow');
    fireEvent.click(within(panel.container).getByLabelText('Arrowhead at the last point'));
    await settle();
    expect(server.objects.get(arrow?.id ?? '')?.style).not.toHaveProperty('arrowhead');
    expect(server.objects.get(arrow?.id ?? '')?.extensions).toEqual({ 'draw-shapes': { kind: 'arrow' } });
  });
});

describe('criterion 8: reshape', () => {
  async function reshaping() {
    const { server, rect, ops } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    return { server, rect, ops, browser, panel };
  }

  it('starts the map view\'s editing service for the shape, in its style', async () => {
    const { browser, rect, panel } = await reshaping();
    expect(browser.map.runningInteraction).toBe('edit');
    expect(browser.map.editCalls).toEqual([{ id: rect.id, style: rect.style }]);
    expect(within(panel.container).getByText(/Enter finishes, Escape cancels/)).toBeDefined();
    expect(buttonOf(panel, 'Reshape').disabled).toBe(true);
  });

  it('dragging one corner sends one update with the new geometry when finished', async () => {
    const { server, rect, browser } = await reshaping();
    const moved: Geometry = { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.45, 59.55], [18.0, 59.4], [18.0, 59.3]]] };
    await finishDrawing(browser, moved);
    expect(updates(server)).toHaveLength(1);
    expect(stored(server, rect).geometry).toEqual(moved);
    expect(stored(server, rect).properties?.name).toBe('Objective');
    expect(stored(server, rect).extensions?.['other']).toEqual({ x: 1 });
  });

  it('moving the whole shape sends one update', async () => {
    const { server, rect, browser } = await reshaping();
    const moved: Geometry = { type: 'Polygon', coordinates: [[[19.0, 60.3], [19.3, 60.3], [19.3, 60.4], [19.0, 60.4], [19.0, 60.3]]] };
    await finishDrawing(browser, moved);
    expect(updates(server)).toHaveLength(1);
    expect(stored(server, rect).geometry).toEqual(moved);
  });

  it('Escape sends nothing, and the button works again', async () => {
    const { server, browser, panel } = await reshaping();
    await finishDrawing(browser, null);
    expect(updates(server)).toHaveLength(0);
    expect(buttonOf(panel, 'Reshape').disabled).toBe(false);
  });

  it('reshapes a circle by its radius', async () => {
    const { server, circle } = world();
    const browser = await open(server);
    const panel = await editShape(browser, circle.id);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    await finishDrawing(browser, { type: 'Circle', center: [18.0686, 59.3293], radius: 4200 });
    expect(stored(server, circle).geometry).toEqual({ type: 'Circle', center: [18.0686, 59.3293], radius: 4200 });
  });

  it('refuses a result of another geometry type, and one outside the valid coordinates', async () => {
    const { server, browser, rect } = await reshaping();
    await finishDrawing(browser, { type: 'Circle', center: [18, 59], radius: 10 });
    expect(browser.ctx.notifications.at(-1)?.message).toContain('The shape was not changed');
    expect(stored(server, rect).version).toBe(1);
  });

  it('a shape the map does not draw says so, and "Show on map" centres on it', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    browser.map.setNotDrawn([rect.id]);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    expect(browser.ctx.notifications.at(-1)?.message).toContain('Show on map');
    expect(browser.map.runningInteraction).toBe('dragObject'); // no reshape runs; the selected shape's drag waits again (function 16)
    expect(updates(server)).toHaveLength(0);
  });

  it('is off for a shape that is not in view, which has a Show on map button', async () => {
    const { server, rect } = world();
    const browser = await open(server, { viewAway: true });
    const panel = await editShape(browser, rect.id);
    expect(buttonOf(panel, 'Reshape').disabled).toBe(true);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Show on map' }));
    await settle();
    expect(browser.map.centreOnCalls).toEqual([[rect.id]]);
  });

  it('a shape tool that is on goes off when a reshape starts', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const tools = showShapesPanel(browser);
    await chooseTool('Circle');
    const panel = await editShape(browser, rect.id);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    expect(within(tools.container).getByRole('button', { name: 'Circle' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('criterion 10: no Delete of its own', () => {
  it('has no Delete button in either panel and registers no Delete action', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    showShapesPanel(browser);
    await editShape(browser, rect.id);
    expect(screen.queryByRole('button', { name: /delete|remove/i })).toBeNull();
    expect(browser.ctx.objectActions.map((a) => a.id)).toEqual(['edit']);
  });

  it('does not act on the Delete key; the shell\'s shared Delete removes shapes', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    await editShape(browser, rect.id);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    await settle();
    expect(server.requests).toHaveLength(0);
  });
});

describe('criterion 12: without objects.edit', () => {
  it('Edit is not offered', async () => {
    const { server, rect } = world();
    const browser = await open(server, { user: createFakeUser({ permissions: [] }) });
    await expect(browser.ctx.runObjectAction('edit', [rect.id])).rejects.toThrow(/would not offer/);
    expect(editPanelOpen(browser)).toBe(false);
  });

  it('a handler that is reached anyway refuses and says why', async () => {
    const { server, rect } = world();
    const browser = await open(server, { user: createFakeUser({ permissions: [] }) });
    await act(async () => {
      await browser.ctx.objectActions[0]?.run([rect.id]);
    });
    expect(browser.ctx.notifications.at(-1)?.message).toBe('You may not edit objects.');
    expect(editPanelOpen(browser)).toBe(false);
  });

  it('a PERMISSION_DENIED rejection of an update is shown as a notification, and the input stays', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    browser.connection.rejectNext.push('PERMISSION_DENIED');
    await typeAndEnter(field(panel, 'Name'), 'Not allowed');
    expect(stored(server, rect).properties?.name).toBe('Objective');
    expect(browser.ctx.notifications.at(-1)).toMatchObject({ severity: 'error' });
    expect(browser.ctx.notifications.at(-1)?.message).toContain('PERMISSION_DENIED');
    expect(inputOf(panel, 'Name').value).toBe('Not allowed');
  });
});

describe('function 8: errors', () => {
  it('a rejected style change is shown with its reason, and the colour the user picked stays', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    browser.connection.rejectNext.push('VALIDATION_FAILED');
    const colour = inputOf(panel, 'Outline colour');
    fireEvent.change(colour, { target: { value: '#aa3300' } });
    fireEvent.blur(colour);
    await settle();
    expect(browser.ctx.notifications.at(-1)?.message).toContain('Could not change the style');
    expect(browser.ctx.notifications.at(-1)?.message).toContain('VALIDATION_FAILED');
    expect(colour.value).toBe('#aa3300');
    expect(stored(server, rect).style?.strokeColor).toBe('#1f3a93');
  });

  it('says so when the answer is lost, and when too many changes wait', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    browser.connection.unknownNext.push({ arrived: false });
    await typeAndEnter(field(panel, 'Name'), 'Lost');
    expect(browser.ctx.notifications.at(-1)?.message).toContain('No answer from the server');
    expect(inputOf(panel, 'Name').value).toBe('Lost');
  });

  it('shows the result of its own change at once, before the live picture reports it', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    browser.connection.lagLive = true;
    await typeAndEnter(field(panel, 'Name'), 'Own result');
    expect(inputOf(panel, 'Name').value).toBe('Own result');
    expect(within(panel.container).getByText('Version').nextElementSibling?.textContent).toBe('2');
    act(() => {
      browser.connection.flushLive(); // the same event again: applied once
    });
    expect(within(panel.container).getByText('Version').nextElementSibling?.textContent).toBe('2');
  });

  it('refuses more than 20 changes waiting at once, and says so', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    browser.connection.hold = true;
    for (let i = 1; i <= 21; i++) {
      fireEvent.change(field(panel, 'Name'), { target: { value: `Name ${String(i)}` } });
      fireEvent.keyDown(field(panel, 'Name'), { key: 'Enter' });
    }
    await settle();
    expect(browser.connection.waiting).toBe(1); // the first is on its way; the others wait behind it
    expect(browser.ctx.notifications.at(-1)?.message).toContain('Too many changes are waiting');
    browser.connection.release();
    await settle();
  });

  it('two quick changes of one shape go one after the other, each from the state the first left', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    browser.connection.hold = true;
    fireEvent.change(field(panel, 'Outline width'), { target: { value: '5' } });
    fireEvent.change(field(panel, 'Outline dash'), { target: { value: 'dot' } });
    await settle();
    expect(browser.connection.waiting).toBe(1); // the second waits for the first
    browser.connection.release();
    await settle();
    await settle();
    expect(stored(server, rect).style).toMatchObject({ strokeWidth: 5, strokeDash: 'dot' });
    expect(stored(server, rect).version).toBe(3);
  });
});
