// Brief functions 1, 2, 8 and 9; acceptance criteria 1 to 5, 12 and 13: the Shapes panel and drawing.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeRequest, DataType, Geometry } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import { drawKindOf, KIND_LABELS, SHAPE_KINDS } from '../src/kinds.ts';
import type { ShapeKind } from '../src/kinds.ts';
import { DEFAULT_LABEL, chooseTool, finishDrawing, openBrowser, settingDefaults, settle, showShapesPanel, toolButton, typeAndEnter } from './harness.tsx';
import { FakeServer, layer } from './fakeServer.ts';

/** Longitude 18.07 and latitude 59.33 differ, as do the other points: a swapped pair cannot pass (criterion 2). */
const GEOMETRY: Record<ShapeKind, Geometry> = {
  circle: { type: 'Circle', center: [18.0686, 59.3293], radius: 2500 },
  ellipse: { type: 'Ellipse', center: [18.0686, 59.3293], semiMajorAxis: 4000, semiMinorAxis: 1500, rotation: 35 },
  square: { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.1, 59.3], [18.1, 59.4], [18.0, 59.4], [18.0, 59.3]]] },
  rectangle: { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] },
  polygon: { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.35], [18.2, 59.5], [18.05, 59.45], [18.0, 59.3]]] },
  arrow: { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [18.07, 59.33]] },
  route: { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [17.6, 59.1], [18.07, 59.33]] },
};

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup(options: Parameters<typeof openBrowser>[1] = {}, dataTypes: string[] = ['core.general']) {
  const ops = layer('Operations', 1);
  const server = new FakeServer([ops], dataTypes);
  return { server, ops, browser: openBrowser(server, options) };
}

function created(server: FakeServer): ChangeRequest[] {
  return server.requests.filter((r) => r.operation === 'create');
}

describe('criteria 1 and 2: drawing each kind', () => {
  it.each(SHAPE_KINDS)('a %s makes exactly one schema-valid create request in the active layer', async (kind) => {
    const { server, ops, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await chooseTool(KIND_LABELS[kind]);
    expect(browser.map.runningInteraction).toBe(`draw:${drawKindOf(kind)}`);
    expect(browser.map.drawCalls).toHaveLength(1);

    await finishDrawing(browser, GEOMETRY[kind]);

    // The server double checks every request against change-request.schema.json (data model 1.1.0).
    expect(created(server)).toHaveLength(1);
    const request = created(server)[0];
    expect(request).toMatchObject({
      entityType: 'object',
      operation: 'create',
      data: {
        type: 'core.shape',
        dataType: 'core.general',
        dataSource: 'manual',
        layerId: ops.id,
        label: DEFAULT_LABEL,
        geometry: GEOMETRY[kind],
        extensions: { 'draw-shapes': { kind } },
      },
    });
    expect(request?.entityId).toMatch(UUID_V7);
    expect(server.objects.get(request?.entityId ?? '')?.version).toBe(1);
  });

  it('keeps the positions as drawn, longitude first (criterion 2)', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await chooseTool('Route');
    await finishDrawing(browser, GEOMETRY.route);
    const stored = [...server.objects.values()][0];
    expect(stored?.geometry).toEqual({ type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [17.6, 59.1], [18.07, 59.33]] });
  });

  it('stores a circle with its radius in metres and an ellipse with its semi-axes and rotation (criterion 2)', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await chooseTool('Circle');
    await finishDrawing(browser, GEOMETRY.circle);
    await chooseTool('Circle'); // the tool went on again: this switches it off
    await chooseTool('Ellipse');
    await finishDrawing(browser, GEOMETRY.ellipse);
    const geometries = [...server.objects.values()].map((o) => o.geometry);
    expect(geometries).toContainEqual({ type: 'Circle', center: [18.0686, 59.3293], radius: 2500 });
    expect(geometries).toContainEqual({ type: 'Ellipse', center: [18.0686, 59.3293], semiMajorAxis: 4000, semiMinorAxis: 1500, rotation: 35 });
  });

  it('a square, a rectangle and an area are closed polygons (criterion 2)', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    for (const kind of ['square', 'rectangle', 'polygon'] as const) {
      await chooseTool(KIND_LABELS[kind]);
      await finishDrawing(browser, GEOMETRY[kind]);
      await chooseTool(KIND_LABELS[kind]); // off
    }
    const polygons = [...server.objects.values()].map((o) => o.geometry);
    expect(polygons).toHaveLength(3);
    for (const polygon of polygons) {
      expect(polygon.type).toBe('Polygon');
      const ring = polygon.type === 'Polygon' ? polygon.coordinates[0] : [];
      expect(ring?.[0]).toEqual(ring?.[ring.length - 1]);
    }
  });

  it('the tool stays on for the next shape until it is switched off', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await chooseTool('Circle');
    await finishDrawing(browser, GEOMETRY.circle);
    expect(browser.map.runningInteraction).toBe('draw:circle');
    expect(toolButton('Circle').getAttribute('aria-pressed')).toBe('true');
    await finishDrawing(browser, { type: 'Circle', center: [19.5, 60.2], radius: 900 });
    expect(created(server)).toHaveLength(2);
    expect(new Set(created(server).map((r) => r.entityId)).size).toBe(2);

    // Switching it off: a drawing still waiting in the map view is not used.
    await chooseTool('Circle');
    expect(toolButton('Circle').getAttribute('aria-pressed')).toBe('false');
    await finishDrawing(browser, GEOMETRY.circle);
    expect(created(server)).toHaveLength(2);
  });

  it('shows what to do on the map for the tool that is on', async () => {
    const { browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await chooseTool('Rectangle');
    expect(screen.getByText(/press and drag on the map/)).toBeDefined();
    await chooseTool('Route');
    expect(screen.getByText(/double-click or Enter finishes/)).toBeDefined();
  });
});

describe('criterion 3: the style ends up in the object', () => {
  async function drawWith(kind: ShapeKind, edit: () => void | Promise<void>) {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await edit();
    await chooseTool(KIND_LABELS[kind]);
    await finishDrawing(browser, GEOMETRY[kind]);
    return { server, browser, stored: [...server.objects.values()][0] };
  }

  it('an outline colour, width and dash', async () => {
    const { stored, browser } = await drawWith('rectangle', () => {
      const colour = screen.getByLabelText('Outline colour');
      fireEvent.change(colour, { target: { value: '#aa3300' } });
      fireEvent.blur(colour);
      fireEvent.change(screen.getByLabelText('Outline width'), { target: { value: '5' } });
      fireEvent.change(screen.getByLabelText('Outline dash'), { target: { value: 'dot' } });
    });
    expect(stored?.style).toEqual({ strokeColor: '#aa3300', strokeWidth: 5, strokeDash: 'dot' });
    // The drawing service previews the shape in the same style.
    expect(browser.map.drawCalls[0]?.style).toEqual({ strokeColor: '#aa3300', strokeWidth: 5, strokeDash: 'dot' });
  });

  it('a transparent fill', async () => {
    const { stored } = await drawWith('circle', () => {
      fireEvent.change(screen.getByLabelText('Fill'), { target: { value: 'transparent' } });
      fireEvent.change(screen.getByLabelText('Fill opacity'), { target: { value: '40' } });
    });
    expect(stored?.style).toEqual({ strokeColor: '#1f3a93', strokeWidth: 2, strokeDash: 'solid', fillColor: '#1f3a93', fillOpacity: 0.4 });
  });

  it('a hatched fill', async () => {
    const { stored } = await drawWith('polygon', () => {
      fireEvent.change(screen.getByLabelText('Fill'), { target: { value: 'hatched' } });
      const colour = screen.getByLabelText('Fill colour');
      fireEvent.change(colour, { target: { value: '#00aa33' } });
      fireEvent.blur(colour);
    });
    expect(stored?.style).toMatchObject({ fillColor: '#00aa33', fillOpacity: 0.2, fillPattern: 'hatch' });
  });

  it('an arrowhead on an arrow', async () => {
    const arrow = await drawWith('arrow', () => undefined);
    expect(arrow.stored?.style).toEqual({ strokeColor: '#1f3a93', strokeWidth: 2, strokeDash: 'solid', arrowhead: 'end' });
  });

  it('markers at the points of a route', async () => {
    const route = await drawWith('route', () => undefined);
    expect(route.stored?.style).toEqual({ strokeColor: '#1f3a93', strokeWidth: 2, strokeDash: 'solid', pointMarkers: 'circle' });
  });

  it('a line has no fill, so the fill fields leave the panel while a line tool is on', async () => {
    const { browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    expect(screen.queryByLabelText('Fill')).not.toBeNull();
    await chooseTool('Arrow');
    expect(browser.map.runningInteraction).toBe('draw:line');
    expect(screen.queryByLabelText('Fill')).toBeNull();
  });

  it('starts from the settings and follows a change in the Settings tab at once', async () => {
    const { browser: pending } = setup({ settings: { ...settingDefaults(), outlineColor: '#00ff00', outlineWidth: 4, outlineDash: 'dash', fill: 'transparent', fillColor: '#ff00ff', fillOpacity: 0.5 } });
    const browser = await pending;
    showShapesPanel(browser);
    expect(screen.getByLabelText<HTMLInputElement>('Outline colour').value).toBe('#00ff00');
    expect(screen.getByLabelText<HTMLSelectElement>('Fill').value).toBe('transparent');
    act(() => {
      browser.ctx.changeSettings({ ...settingDefaults(), outlineColor: '#ff0000', fill: 'hatched' });
    });
    expect(screen.getByLabelText<HTMLInputElement>('Outline colour').value).toBe('#ff0000');
    expect(screen.getByLabelText<HTMLSelectElement>('Fill').value).toBe('hatched');
  });
});

describe('criterion 4: the name is the label', () => {
  it('is stored as properties.name', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Phase line BLUE  ' } });
    await chooseTool('Route');
    await finishDrawing(browser, GEOMETRY.route);
    expect([...server.objects.values()][0]?.properties).toEqual({ name: 'Phase line BLUE' });
  });

  it('is empty for the next shape after one was made, and a shape without a name has no properties', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alpha' } });
    await chooseTool('Circle');
    await finishDrawing(browser, GEOMETRY.circle);
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('');
    await finishDrawing(browser, { type: 'Circle', center: [19, 60], radius: 100 });
    const stored = [...server.objects.values()];
    expect(stored.map((o) => o.properties?.name)).toEqual(['Alpha', undefined]);
  });
});

describe('criterion 5: a cancelled drawing', () => {
  it('sends nothing, and the tool goes off', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await chooseTool('Area');
    await finishDrawing(browser, null); // Escape
    expect(server.requests).toHaveLength(0);
    expect(browser.map.runningInteraction).toBeNull();
    expect(toolButton('Area').getAttribute('aria-pressed')).toBe('false');
  });

  it('another map interaction ends the drawing without a shape', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await chooseTool('Circle');
    void browser.map.pickPoint(); // another plugin starts an interaction: the map view ends the drawing with null
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(browser.map.runningInteraction).toBe('pickPoint'); // the tool does not take the map back
  });
});

describe('criterion 13: no active layer', () => {
  it('drawing is impossible and the hint is shown', async () => {
    const { browser: pending } = setup({ activeLayer: null });
    const browser = await pending;
    showShapesPanel(browser);
    expect(screen.getByText('Select or create a layer in the layer panel')).toBeDefined();
    for (const kind of SHAPE_KINDS) expect(toolButton(KIND_LABELS[kind]).disabled).toBe(true);
    fireEvent.click(toolButton('Circle'));
    await settle();
    expect(browser.map.drawCalls).toHaveLength(0);
  });

  it('the tool goes off when the active layer goes away', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await chooseTool('Circle');
    act(() => {
      browser.map.activeLayer.set(null);
    });
    expect(toolButton('Circle').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Select or create a layer in the layer panel')).toBeDefined();
    await finishDrawing(browser, GEOMETRY.circle);
    expect(server.requests).toHaveLength(0);
  });
});

describe('criterion 12: without objects.edit', () => {
  it('no tool can be used and the hint is shown', async () => {
    const { server, browser: pending } = setup({ user: createFakeUser({ permissions: [] }) });
    const browser = await pending;
    showShapesPanel(browser);
    expect(screen.getByText('You may not edit objects')).toBeDefined();
    for (const kind of SHAPE_KINDS) expect(toolButton(KIND_LABELS[kind]).disabled).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>('Data type').disabled).toBe(true);
    fireEvent.click(toolButton('Circle'));
    await settle();
    expect(browser.map.drawCalls).toHaveLength(0);
    expect(server.requests).toHaveLength(0);
  });

  it('a PERMISSION_DENIED rejection is shown as a notification with the reason', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    browser.connection.rejectNext.push('PERMISSION_DENIED');
    await chooseTool('Rectangle');
    await finishDrawing(browser, GEOMETRY.rectangle);
    expect(server.objects.size).toBe(0);
    expect(browser.ctx.notifications).toHaveLength(1);
    expect(browser.ctx.notifications[0]).toMatchObject({ severity: 'error' });
    expect(browser.ctx.notifications[0]?.message).toContain('PERMISSION_DENIED');
    expect(browser.ctx.notifications[0]?.message).toContain('create the shape');
  });
});

describe('function 8: errors while drawing', () => {
  it('keeps the name and the style the user typed when the request is rejected', async () => {
    const { browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Keep me' } });
    browser.connection.rejectNext.push('VALIDATION_FAILED');
    await chooseTool('Circle');
    await finishDrawing(browser, GEOMETRY.circle);
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Keep me');
    expect(browser.ctx.notifications[0]?.message).toContain('VALIDATION_FAILED');
  });

  it('sends the create again with the same id after "outcome unknown"', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    browser.connection.unknownNext.push({ arrived: true });
    await chooseTool('Circle');
    await finishDrawing(browser, GEOMETRY.circle);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.entityId).toBe(server.requests[0]?.entityId);
    expect(server.objects.size).toBe(1);
    expect(browser.ctx.notifications).toHaveLength(0);
  });

  it('refuses a geometry of the wrong type, and one outside the valid coordinates, and says so', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await chooseTool('Circle');
    await finishDrawing(browser, GEOMETRY.rectangle);
    expect(browser.ctx.notifications.at(-1)?.message).toContain('Nothing was created');
    await finishDrawing(browser, { type: 'Circle', center: [18, 95], radius: 100 });
    expect(browser.ctx.notifications.at(-1)?.message).toContain('outside the valid coordinates');
    expect(server.requests).toHaveLength(0);
  });

  it('reports a map view that cannot draw a kind, and goes off', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    browser.map.draw = () => Promise.reject(new Error('not available yet'));
    await chooseTool('Ellipse');
    expect(browser.ctx.notifications.at(-1)).toMatchObject({ severity: 'error' });
    expect(browser.ctx.notifications.at(-1)?.message).toContain('not available yet');
    expect(toolButton('Ellipse').getAttribute('aria-pressed')).toBe('false');
    expect(server.requests).toHaveLength(0);
  });
});

describe('function 1: the data type of new shapes', () => {
  const COT: Omit<DataType, 'behaviour'> = { id: 'cot.cot', name: 'Cursor on Target', declaredBy: 'cot', defaults: {} };

  it('offers the available data types by name; the choice is kept in this browser and used for new shapes', async () => {
    const { server, browser: pending } = setup({ dataTypes: [COT] }, ['core.general', 'cot.cot']);
    const browser = await pending;
    showShapesPanel(browser);
    const select = screen.getByLabelText<HTMLSelectElement>('Data type');
    expect([...select.options].map((o) => o.textContent)).toEqual(['General', 'Cursor on Target']);
    fireEvent.change(select, { target: { value: 'cot.cot' } });
    expect(window.localStorage.getItem('draw-shapes.dataType')).toBe('cot.cot');
    await chooseTool('Circle');
    await finishDrawing(browser, GEOMETRY.circle);
    expect([...server.objects.values()][0]).toMatchObject({ dataType: 'cot.cot', dataSource: 'manual' });
  });

  it('uses the setting without a choice, and core.general if the setting names a type that is not available', async () => {
    const withSetting = setup({ dataTypes: [COT], settings: { ...settingDefaults(), dataType: 'cot.cot' } }, ['core.general', 'cot.cot']);
    const first = await withSetting.browser;
    showShapesPanel(first);
    expect(screen.getByLabelText<HTMLSelectElement>('Data type').value).toBe('cot.cot');

    const unknown = setup({ settings: { ...settingDefaults(), dataType: 'gone.type' } });
    const second = await unknown.browser;
    showShapesPanel(second);
    expect(within(document.body.lastElementChild as HTMLElement).getByLabelText('Data type')).toHaveProperty('value', 'core.general');
  });

  describe('criterion 36 (M6, function 18): types users do not choose', () => {
    const ROUTE: Omit<DataType, 'behaviour'> = { id: 'simulator.route', name: 'Route', declaredBy: 'simulator', defaults: {}, manual: false };
    const PLATFORM: Omit<DataType, 'behaviour'> = { id: 'gmti.platform', name: 'GMTI platform', declaredBy: 'gmti', defaults: {}, manual: false };
    const VESSEL: Omit<DataType, 'behaviour'> = { id: 'ais.vessel', name: 'AIS vessel', declaredBy: 'ais', defaults: {} };
    const ALL = ['core.general', 'simulator.route', 'gmti.platform', 'ais.vessel'];

    it('the Shapes panel offers General and AIS vessel only', async () => {
      const { browser: pending } = setup({ dataTypes: [ROUTE, PLATFORM, VESSEL] }, ALL);
      const browser = await pending;
      showShapesPanel(browser);
      const select = screen.getByLabelText<HTMLSelectElement>('Data type');
      expect([...select.options].map((o) => o.textContent)).toEqual(['General', 'AIS vessel']);
    });

    it('a kept choice or a setting that names such a type falls back to core.general, and new shapes get it', async () => {
      window.localStorage.setItem('draw-shapes.dataType', 'gmti.platform');
      const { server, browser: pending } = setup({ dataTypes: [ROUTE, PLATFORM, VESSEL], settings: { ...settingDefaults(), dataType: 'simulator.route' } }, ALL);
      const browser = await pending;
      showShapesPanel(browser);
      expect(screen.getByLabelText<HTMLSelectElement>('Data type').value).toBe('core.general');
      await chooseTool('Circle');
      await finishDrawing(browser, GEOMETRY.circle);
      expect([...server.objects.values()][0]).toMatchObject({ dataType: 'core.general' });
    });
  });

  it('works when browser storage throws', async () => {
    const { browser: pending } = setup({ dataTypes: [COT] }, ['core.general', 'cot.cot']);
    const browser = await pending;
    showShapesPanel(browser);
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      fireEvent.change(screen.getByLabelText('Data type'), { target: { value: 'cot.cot' } });
    } finally {
      blocked.mockRestore();
    }
    expect(screen.getByLabelText<HTMLSelectElement>('Data type').value).toBe('cot.cot');
  });
});

describe('name field', () => {
  it('can be typed into without sending anything', async () => {
    const { server, browser: pending } = setup();
    const browser = await pending;
    showShapesPanel(browser);
    await typeAndEnter(screen.getByLabelText('Name'), 'Typed');
    expect(server.requests).toHaveLength(0);
  });
});
