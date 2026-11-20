// Brief function 17 (T-120; SDK 1.3.0, ADR-0042); acceptance criteria 34 and 35: the layer lock in the
// tools, the edit panel and the drag. The fake store refuses a change to a locked layer's content
// with LAYER_LOCKED, as the real one does.
import { act, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChangeRequest, Geometry, Uuid } from '@emc2/plugin-sdk';
import { chooseTool, editShape, finishDrawing, openBrowser, selectOf, settle, showShapesPanel, toolButton, typeAndEnter, inputOf } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { FakeServer, layer, shapeObject } from './fakeServer.ts';

const KINDS = ['Circle', 'Ellipse', 'Square', 'Rectangle', 'Area', 'Arrow', 'Route'];
const RECT: Geometry = { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] };
const TITLE = 'The active layer "Planned" is locked';
const NOTICE = 'Layer "Planned" is locked';

function world() {
  const ops = layer('Operations', 1);
  const planned = { ...layer('Planned', 2), locked: true };
  const server = new FakeServer([ops, planned], ['core.general']);
  const inOps = server.seed(shapeObject(ops.id, { geometry: RECT, properties: { name: 'Open' } }));
  const inPlanned = server.seed(shapeObject(planned.id, { geometry: RECT, properties: { name: 'Fixed' } }));
  return { server, ops, planned, inOps, inPlanned };
}

/** What the plugin asked the map view to drag, in order (the fake map view's `dragObject` wrapped), with the signals. */
function recordDrags(browser: Browser): { readonly ids: Uuid[]; readonly signals: (AbortSignal | undefined)[] } {
  const ids: Uuid[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const original = browser.map.dragObject.bind(browser.map);
  browser.map.dragObject = (id, options) => {
    ids.push(id);
    signals.push(options?.signal);
    return original(id, options);
  };
  return { ids, signals };
}

const requests = (server: FakeServer): ChangeRequest[] => server.requests;
const lock = async (server: FakeServer, layerId: Uuid, locked: boolean) => {
  act(() => {
    server.setLock(layerId, locked);
  });
  await settle();
};
const select = async (browser: Browser, ids: string[]) => {
  act(() => {
    browser.map.selection.set(ids);
  });
  await settle();
};

describe('criterion 34: a locked active layer', () => {
  it('turns every draw tool off with the title, and no drawing starts', async () => {
    const { server, planned } = world();
    const browser = await openBrowser(server, { activeLayer: planned.id });
    showShapesPanel(browser);
    for (const kind of KINDS) {
      expect(toolButton(kind).disabled, kind).toBe(true);
      expect(toolButton(kind).title, kind).toBe(TITLE);
    }
    fireEvent.click(toolButton('Circle'));
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
    expect(requests(server)).toEqual([]);
  });

  it('leaves the tools on in an unlocked active layer, with their own titles', async () => {
    const { server, ops, planned } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    showShapesPanel(browser);
    expect(toolButton('Circle').disabled).toBe(false);
    expect(toolButton('Circle').title).toBe('Circle');
    act(() => {
      browser.map.activeLayer.set(planned.id);
    });
    await settle();
    expect(toolButton('Circle').disabled).toBe(true);
    expect(toolButton('Circle').title).toBe(TITLE);
    act(() => {
      browser.map.activeLayer.set(ops.id);
    });
    await settle();
    expect(toolButton('Circle').disabled).toBe(false);
  });

  it('a drawing that runs when the active layer becomes locked is ended with its signal, and nothing is sent', async () => {
    const { server, ops } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    showShapesPanel(browser);
    await chooseTool('Rectangle');
    expect(browser.map.runningInteraction).toBe('draw:rectangle');
    await lock(server, ops.id, true);
    expect(browser.map.runningInteraction).toBeNull();
    expect(toolButton('Rectangle').getAttribute('aria-pressed')).toBe('false');
    expect(toolButton('Rectangle').disabled).toBe(true);
    expect(toolButton('Rectangle').title).toBe('The active layer "Operations" is locked');
    expect(requests(server)).toEqual([]);
    expect(browser.ctx.notifications).toEqual([]);
    // An unlock turns the tools on again; the tool that was on stays off.
    await lock(server, ops.id, false);
    expect(toolButton('Rectangle').disabled).toBe(false);
    expect(toolButton('Rectangle').getAttribute('aria-pressed')).toBe('false');
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('a drawing that finishes after the layer was locked (the news is late) sends nothing new: the store refuses it, shown like any rejection', async () => {
    const { server, ops } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    showShapesPanel(browser);
    await chooseTool('Circle');
    browser.connection.lagLive = true;
    await lock(server, ops.id, true); // the browser has not heard yet
    await finishDrawing(browser, { type: 'Circle', center: [18.5, 59.5], radius: 1000 });
    expect(requests(server)).toHaveLength(1);
    expect(server.objects.size).toBe(2); // not created
    expect(browser.ctx.notifications.at(-1)?.message).toContain('LAYER_LOCKED');
    // The late news arrives: the tool goes off.
    act(() => {
      browser.connection.flushLive();
    });
    await settle();
    expect(toolButton('Circle').disabled).toBe(true);
  });

  it('a drawing that finishes once the browser knows of the lock sends nothing at all', async () => {
    const { server, ops } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    showShapesPanel(browser);
    await chooseTool('Circle');
    await lock(server, ops.id, true);
    await finishDrawing(browser, { type: 'Circle', center: [18.5, 59.5], radius: 1000 }); // nothing runs: the fake ignores it
    expect(requests(server)).toEqual([]);
  });
});

describe('criterion 35: Edit in a locked layer', () => {
  it('opens the edit panel read only with the notice, offers no reshape, sends nothing and arms no drag', async () => {
    const { server, inPlanned } = world();
    const browser = await openBrowser(server);
    const drags = recordDrags(browser);
    const panel = await editShape(browser, inPlanned.id);
    expect(within(panel.container).getByText(NOTICE)).toBeTruthy();
    for (const label of ['Name', 'Layer', 'Data type', 'Outline colour', 'Outline width', 'Outline dash']) {
      expect(within(panel.container).getByLabelText<HTMLInputElement>(label).disabled, label).toBe(true);
    }
    expect(within(panel.container).getByRole<HTMLButtonElement>('button', { name: 'Reshape' }).disabled).toBe(true);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags.ids).toEqual([]);
    expect(requests(server)).toEqual([]);
  });

  it('follows the lock live: an unlock (a second browser) makes it editable, a lock makes it read only again', async () => {
    const { server, planned, inPlanned } = world();
    const browser = await openBrowser(server);
    const drags = recordDrags(browser);
    const panel = await editShape(browser, inPlanned.id);
    expect(inputOf(panel, 'Name').disabled).toBe(true);
    await lock(server, planned.id, false);
    expect(within(panel.container).queryByText(NOTICE)).toBeNull();
    expect(inputOf(panel, 'Name').disabled).toBe(false);
    expect(within(panel.container).getByRole<HTMLButtonElement>('button', { name: 'Reshape' }).disabled).toBe(false);
    expect(drags.ids).toEqual([inPlanned.id]); // the drag is armed by the unlock
    expect(browser.map.runningInteraction).toBe('dragObject');
    await typeAndEnter(inputOf(panel, 'Name'), 'Renamed');
    expect(requests(server)).toHaveLength(1);
    await lock(server, planned.id, true);
    expect(within(panel.container).getByText(NOTICE)).toBeTruthy();
    expect(inputOf(panel, 'Name').disabled).toBe(true);
    expect(browser.map.runningInteraction).toBeNull(); // the drag ended with its signal
    expect(drags.signals[0]?.aborted).toBe(true);
  });

  it('a lock while a name is typed in: committing sends nothing', async () => {
    const { server, ops, inOps } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    const panel = await editShape(browser, inOps.id);
    fireEvent.change(inputOf(panel, 'Name'), { target: { value: 'Typed' } });
    await lock(server, ops.id, true);
    fireEvent.keyDown(inputOf(panel, 'Name'), { key: 'Enter' });
    await settle();
    expect(requests(server)).toEqual([]);
    expect(browser.ctx.notifications.at(-1)?.message).toBe('Layer "Operations" is locked.');
  });

  it('a lock while the shape is reshaped ends the reshape and sends nothing', async () => {
    const { server, ops, inOps } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    const panel = await editShape(browser, inOps.id);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    await lock(server, ops.id, true);
    expect(browser.map.runningInteraction).toBeNull();
    expect(requests(server)).toEqual([]);
    expect(within(panel.container).getByRole<HTMLButtonElement>('button', { name: 'Reshape' }).disabled).toBe(true);
  });

  it('offers a locked layer in the Layer field disabled, except the shape\'s own', async () => {
    const { server, inOps } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, inOps.id);
    const options = [...selectOf(panel, 'Layer').options].map((o) => [o.text, o.disabled]);
    expect(options).toEqual([['Planned', true], ['Operations', false]]);
  });

  it('a stale choice of a locked layer sends nothing', async () => {
    const { server, ops, planned, inOps } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    const panel = await editShape(browser, inOps.id);
    fireEvent.change(selectOf(panel, 'Layer'), { target: { value: planned.id } });
    await settle();
    expect(requests(server)).toEqual([]);
    expect(browser.ctx.notifications.at(-1)?.message).toBe(`${NOTICE}.`);
  });

  it('a rejection with LAYER_LOCKED (the lock came in between) is shown like any other', async () => {
    const { server, ops, inOps } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    const panel = await editShape(browser, inOps.id);
    browser.connection.lagLive = true;
    await lock(server, ops.id, true);
    await typeAndEnter(inputOf(panel, 'Name'), 'Late');
    expect(requests(server)).toHaveLength(1);
    expect(browser.ctx.notifications.at(-1)?.message).toContain('(LAYER_LOCKED)');
    expect(server.objects.get(inOps.id)?.properties?.name).toBe('Open');
  });
});

describe('criterion 35: the drag', () => {
  it('a selected shape in a locked layer is not dragged; an unlock arms the drag, a lock ends it', async () => {
    const { server, planned, inPlanned, inOps } = world();
    const browser = await openBrowser(server);
    const drags = recordDrags(browser);
    await select(browser, [inPlanned.id]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags.ids).toEqual([]);
    await lock(server, planned.id, false);
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags.ids).toEqual([inPlanned.id]);
    await lock(server, planned.id, true);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags.signals[0]?.aborted).toBe(true);
    expect(requests(server)).toEqual([]);
    // A shape in an unlocked layer is still dragged.
    await select(browser, [inOps.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags.ids.at(-1)).toBe(inOps.id);
  });

  it('a drop that arrives after the lock sends nothing new', async () => {
    const { server, ops, inOps } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    await select(browser, [inOps.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    browser.connection.lagLive = true;
    await lock(server, ops.id, true); // not heard yet
    act(() => {
      browser.map.completeInteraction([19, 60]);
    });
    await settle();
    expect(requests(server)).toHaveLength(1);
    expect(browser.ctx.notifications.at(-1)?.message).toContain('(LAYER_LOCKED)');
  });
});
