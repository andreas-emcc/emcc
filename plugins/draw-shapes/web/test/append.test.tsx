// Brief function 19 (T-176; SDK 1.6.0); acceptance criteria 37 and 38: Append in the edit panel for a
// line, against the fake map view's `append` (`appendCalls`, `setNotLines`).
import { act, fireEvent, within, type RenderResult } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChangeRequest, Geometry, LineString, MapObject } from '@emc2/plugin-sdk';
import { AWAY, buttonOf, editShape, finishDrawing, openBrowser, SIMULATION, settle, switchTo } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { FakeServer, layer, shapeObject } from './fakeServer.ts';

// lon differs from lat in every point, so a swapped pair cannot pass
const LINE_POINTS: LineString['coordinates'] = [[17.5, 59.1], [18.5, 59.6], [19.25, 59.2]];
const LINE: Geometry = { type: 'LineString', coordinates: LINE_POINTS };
const FIVE: LineString = { type: 'LineString', coordinates: [...LINE_POINTS, [19.9, 59.45], [20.4, 59.9]] };
const RECT: Geometry = { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] };
const STYLE = { strokeColor: '#c0392b', strokeWidth: 3, strokeDash: 'solid' } as const;

function world() {
  const ops = layer('Operations', 1);
  const planned = { ...layer('Planned', 2), locked: true };
  const sim = layer('Sim layer', 3, undefined, SIMULATION.id);
  const server = new FakeServer([ops, planned, sim], ['core.general']);
  const line = server.seed(shapeObject(ops.id, { geometry: LINE, style: STYLE, properties: { name: 'Axis' }, extensions: { 'draw-shapes': { kind: 'route' }, other: { x: 1 } } }));
  const rect = server.seed(shapeObject(ops.id, { geometry: RECT, properties: { name: 'Objective' } }));
  const circle = server.seed(shapeObject(ops.id, { properties: { name: 'Zone' } }));
  const lockedLine = server.seed(shapeObject(planned.id, { geometry: LINE, properties: { name: 'Fixed' } }));
  const simLine = server.seed(shapeObject(sim.id, { geometry: LINE, properties: { name: 'Sim line' } }));
  return { server, ops, planned, sim, line, rect, circle, lockedLine, simLine };
}

const open = (server: FakeServer, options: Parameters<typeof openBrowser>[1] = {}) => openBrowser(server, options);
const updates = (server: FakeServer): ChangeRequest[] => server.requests.filter((r) => r.operation === 'update');
const stored = (server: FakeServer, object: { readonly id: string }): MapObject => {
  const now = server.objects.get(object.id);
  if (now === undefined) throw new Error('the store lost the object');
  return now;
};
const appendButton = (panel: RenderResult) => buttonOf(panel, 'Append');
const click = async (button: HTMLElement) => {
  fireEvent.click(button);
  await settle();
};

describe('criterion 37: Append', () => {
  it('continues a line: one update with the five points, and the data type, style and name unchanged', async () => {
    const { server, line } = world();
    const browser = await open(server);
    const panel = await editShape(browser, line.id);
    await click(appendButton(panel));
    expect(browser.map.runningInteraction).toBe('append');
    expect(browser.map.appendCalls).toEqual([{ id: line.id, style: STYLE }]);
    expect(within(panel.container).getByText(/add points after the last point/)).toBeTruthy();
    expect(buttonOf(panel, 'Reshape').disabled).toBe(true); // one at a time
    expect(appendButton(panel).disabled).toBe(true);
    await finishDrawing(browser, FIVE);
    expect(browser.map.runningInteraction).toBe('dragObject'); // the drag is armed again
    expect(updates(server)).toHaveLength(1);
    expect(stored(server, line)).toMatchObject({
      geometry: FIVE, dataType: 'core.general', style: STYLE, properties: { name: 'Axis' }, extensions: { 'draw-shapes': { kind: 'route' }, other: { x: 1 } }, version: 2,
    });
    expect(appendButton(panel).disabled).toBe(false);
  });

  it('sends nothing for Escape (null), nor when no point was added', async () => {
    const { server, line } = world();
    const browser = await open(server);
    const panel = await editShape(browser, line.id);
    await click(appendButton(panel));
    await finishDrawing(browser, null);
    expect(updates(server)).toEqual([]);
    expect(browser.map.runningInteraction).toBeNull(); // Escape does not arm the drag by itself
    await click(appendButton(panel));
    await finishDrawing(browser, LINE);
    expect(updates(server)).toEqual([]);
  });

  it('is offered for a line only: a polygon and a circle show Reshape and no Append', async () => {
    const { server, line, rect, circle } = world();
    const browser = await open(server);
    expect(appendButton(await editShape(browser, line.id))).toBeTruthy();
    for (const shape of [rect, circle]) {
      const panel = await editShape(browser, shape.id);
      expect(within(panel.container).queryByRole('button', { name: 'Append' })).toBeNull();
      expect(buttonOf(panel, 'Reshape')).toBeTruthy();
    }
  });

  it('a refusal for a shape that is not a line (NotALineError) says so and sends nothing', async () => {
    const { server, line } = world();
    const browser = await open(server);
    browser.map.setNotLines([line.id]);
    const panel = await editShape(browser, line.id);
    await click(appendButton(panel));
    expect(browser.ctx.notifications.at(-1)?.message).toBe('Points can only be appended to a line.');
    expect(updates(server)).toEqual([]);
    expect(browser.map.runningInteraction).not.toBe('append');
  });

  it('a shape the map does not draw (NotOnMapError) is reported and sends nothing', async () => {
    const { server, line } = world();
    const browser = await open(server);
    browser.map.setNotDrawn([line.id]);
    const panel = await editShape(browser, line.id);
    await click(appendButton(panel));
    expect(browser.ctx.notifications.at(-1)?.message).toContain('Show on map');
    expect(updates(server)).toEqual([]);
  });

});

describe('criterion 38: Append, when off', () => {
  it('on a locked layer it is disabled with the lock as its title, and nothing runs', async () => {
    const { server, lockedLine } = world();
    const browser = await open(server);
    const panel = await editShape(browser, lockedLine.id);
    expect(appendButton(panel).disabled).toBe(true);
    expect(appendButton(panel).title).toBe('Layer "Planned" is locked');
    expect(buttonOf(panel, 'Reshape').title).toBe('Layer "Planned" is locked'); // Reshape names its reason the same way
    await click(appendButton(panel));
    expect(browser.map.appendCalls).toEqual([]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(server.requests).toEqual([]);
  });

  it('a lock that comes while it runs ends it and sends nothing', async () => {
    const { server, ops, line } = world();
    const browser = await open(server, { activeLayer: ops.id });
    const panel = await editShape(browser, line.id);
    await click(appendButton(panel));
    expect(browser.map.runningInteraction).toBe('append');
    act(() => {
      server.setLock(ops.id, true);
    });
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
    expect(updates(server)).toEqual([]);
    expect(appendButton(panel).disabled).toBe(true);
  });

  it('without edit rights it is disabled with the permission as its title', async () => {
    const { server, line } = world();
    const browser = await open(server);
    const panel = await editShape(browser, line.id);
    (browser.ctx.user as { has: (permission: string) => boolean }).has = () => false;
    act(() => {
      browser.map.setViewport({ ...browser.map.viewport, resolution: 1000 }); // the plugin looks at its state again
    });
    await settle();
    expect(appendButton(panel).disabled).toBe(true);
    expect(appendButton(panel).title).toBe('You may not edit objects');
    await click(appendButton(panel));
    expect(browser.map.appendCalls).toEqual([]);
  });

  it('a shape that is not in the workspace shown, and a shape out of the view, are off with their titles', async () => {
    const { server, line, simLine } = world();
    const browser = await open(server, { workspaces: [SIMULATION], workspace: SIMULATION.id, activeLayer: null });
    const panel = await editShape(browser, simLine.id, `edit:${SIMULATION.id}`);
    expect(appendButton(panel).disabled).toBe(false);
    await switchTo(browser, 'core.view');
    const other = await editShape(browser, line.id);
    act(() => {
      browser.map.setViewport(AWAY);
    });
    await settle();
    expect(appendButton(other).disabled).toBe(true);
    expect(appendButton(other).title).toBe('Show the shape on the map first');
  });

  it('a switch of workspace while it runs ends it and sends nothing', async () => {
    const { server, simLine } = world();
    const browser = await open(server, { workspaces: [SIMULATION], workspace: SIMULATION.id, activeLayer: null });
    const panel = await editShape(browser, simLine.id, `edit:${SIMULATION.id}`);
    await click(appendButton(panel));
    expect(browser.map.runningInteraction).toBe('append');
    await switchTo(browser, 'core.view');
    expect(browser.map.runningInteraction).toBeNull();
    expect(updates(server)).toEqual([]);
  });

  it('closing the panel during an append aborts the map view\'s append (its signal)', async () => {
    const { server, line } = world();
    const browser: Browser = await open(server);
    const signals: (AbortSignal | undefined)[] = [];
    const original = browser.map.append.bind(browser.map);
    browser.map.append = (id, options) => {
      signals.push(options?.signal);
      return original(id, options);
    };
    const panel = await editShape(browser, line.id);
    await click(appendButton(panel));
    expect(signals[0]?.aborted).toBe(false);
    act(() => {
      browser.map.selection.set([]);
    });
    await settle();
    expect(signals[0]?.aborted).toBe(true);
    expect(browser.map.runningInteraction).toBeNull();
    expect(updates(server)).toEqual([]);
  });
});
