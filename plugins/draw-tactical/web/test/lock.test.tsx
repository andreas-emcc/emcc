// Brief function 12; acceptance criterion 13 (the lock part): the layer lock (ADR-0042, SDK 1.3.0) in the
// tool, the edit panel and the drag, as draw-shapes' function 17. The fake store refuses a change to a
// locked layer's content with LAYER_LOCKED, as the real one does.
import { act, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChangeRequest, Uuid } from '@emc2/plugin-sdk';
import { buttonOf, chooseGraphic, clickTool, editGraphic, finishDrawing, inputOf, openBrowser, selectOf, settle, showGraphicsPanel, toolButton, typeAndEnter } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { FakeServer, graphicObject, layer } from './fakeServer.ts';

const TITLE = 'The active layer "Planned" is locked';
const NOTICE = 'Layer "Planned" is locked';
const LINE = { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [18.07, 59.33]] } as const;

function world() {
  const ops = layer('Operations', 1);
  const planned = { ...layer('Planned', 2), locked: true };
  const server = new FakeServer([ops, planned], ['core.general']);
  const inOps = server.seed(graphicObject(ops.id, { properties: { name: 'Open' } }));
  const inPlanned = server.seed(graphicObject(planned.id, { properties: { name: 'Fixed' } }));
  return { server, ops, planned, inOps, inPlanned };
}

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
const requests = (server: FakeServer): ChangeRequest[] => server.requests;

describe('criterion 13: a locked active layer', () => {
  it('turns the tool off with the title, and no placing starts', async () => {
    const { server, planned } = world();
    const browser = await openBrowser(server, { activeLayer: planned.id });
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    expect(toolButton().disabled).toBe(true);
    expect(toolButton().title).toBe(TITLE);
    fireEvent.click(toolButton());
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
    expect(requests(server)).toEqual([]);
  });

  it('follows the active layer and the lock: the tool is on in an unlocked layer, off in a locked one, on again after an unlock', async () => {
    const { server, ops, planned } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    expect(toolButton().disabled).toBe(false);
    act(() => {
      browser.map.activeLayer.set(planned.id);
    });
    await settle();
    expect(toolButton().disabled).toBe(true);
    expect(toolButton().title).toBe(TITLE);
    await lock(server, planned.id, false);
    expect(toolButton().disabled).toBe(false);
  });

  it('locking the active layer during a placing ends it and sends nothing', async () => {
    const { server, ops } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    await clickTool();
    expect(browser.map.runningInteraction).toBe('draw:line');
    await lock(server, ops.id, true);
    expect(browser.map.runningInteraction).toBeNull(); // aborted with its signal
    expect(toolButton().disabled).toBe(true);
    expect(toolButton().title).toBe('The active layer "Operations" is locked');
    await finishDrawing(browser, LINE); // nothing is waiting any more
    expect(requests(server)).toEqual([]);
  });
});

describe('criterion 13: a graphic in a locked layer', () => {
  it('Edit opens the panel read only with the notice, no reshape, nothing sent', async () => {
    const { server, inPlanned } = world();
    const browser = await openBrowser(server);
    const panel = await editGraphic(browser, inPlanned.id);
    expect(within(panel.container).getByText(NOTICE)).toBeTruthy();
    expect(inputOf(panel, 'Name').disabled).toBe(true);
    expect(selectOf(panel, 'Identity').disabled).toBe(true);
    expect(selectOf(panel, 'Layer').disabled).toBe(true);
    expect(buttonOf(panel, 'Reshape').disabled).toBe(true);
    fireEvent.change(inputOf(panel, 'Name'), { target: { value: 'Changed' } });
    await settle();
    expect(requests(server)).toEqual([]);
  });

  it('follows the lock live: an unlock makes the panel editable, a lock while it is open makes it read only', async () => {
    const { server, planned, inPlanned, inOps } = world();
    const browser = await openBrowser(server);
    const panel = await editGraphic(browser, inPlanned.id);
    expect(inputOf(panel, 'Name').disabled).toBe(true);
    await lock(server, planned.id, false);
    expect(inputOf(panel, 'Name').disabled).toBe(false);
    expect(within(panel.container).queryByText(NOTICE)).toBeNull();
    await typeAndEnter(inputOf(panel, 'Name'), 'Now editable');
    expect(server.objects.get(inPlanned.id)?.properties?.name).toBe('Now editable');
    await lock(server, planned.id, true);
    expect(inputOf(panel, 'Name').disabled).toBe(true);
    expect(within(panel.container).getByText(NOTICE)).toBeTruthy();
    expect(inOps.version).toBe(1);
  });

  it('a locked layer is offered disabled as the target of a move', async () => {
    const { server, inOps } = world();
    const browser = await openBrowser(server);
    const panel = await editGraphic(browser, inOps.id);
    const options = [...selectOf(panel, 'Layer').options];
    expect(options.find((o) => o.textContent === 'Planned')?.disabled).toBe(true);
    expect(options.find((o) => o.textContent === 'Operations')?.disabled).toBe(false);
  });

  it('a lock while a reshape runs ends it and sends nothing', async () => {
    const { server, ops, inOps } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    const panel = await editGraphic(browser, inOps.id);
    fireEvent.click(buttonOf(panel, 'Reshape'));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    await lock(server, ops.id, true);
    expect(browser.map.runningInteraction).toBeNull();
    expect(requests(server)).toEqual([]);
  });

  it('an update queued behind another is not sent when the layer was locked meanwhile; the notice says so', async () => {
    const { server, ops, inOps } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    const panel = await editGraphic(browser, inOps.id);
    browser.connection.hold = true;
    await typeAndEnter(inputOf(panel, 'Name'), 'First'); // under way, its answer is held
    fireEvent.change(selectOf(panel, 'Status'), { target: { value: '1' } }); // queued behind it
    await settle();
    await lock(server, ops.id, true);
    act(() => {
      browser.connection.release();
    });
    await settle();
    await settle();
    expect(requests(server).filter((r) => r.operation === 'update')).toHaveLength(1);
    expect(browser.ctx.notifications.some((n) => n.message === 'Layer "Operations" is locked.')).toBe(true);
    expect(server.objects.get(inOps.id)?.symbol?.sidc).toBe(inOps.symbol?.sidc);
  });

  it('a LAYER_LOCKED rejection the plugin could not foresee is shown like any other, and the input stays', async () => {
    const { server, ops, inOps } = world();
    const browser = await openBrowser(server, { activeLayer: ops.id });
    const panel = await editGraphic(browser, inOps.id);
    browser.connection.rejectNext.push('LAYER_LOCKED');
    await typeAndEnter(inputOf(panel, 'Name'), 'Too late');
    expect(browser.ctx.notifications.some((n) => /LAYER_LOCKED/.test(n.message))).toBe(true);
    expect(inputOf(panel, 'Name').value).toBe('Too late');
  });

  it('arms no drag for it; an unlock arms one', async () => {
    const { server, planned, inPlanned } = world();
    const browser = await openBrowser(server);
    await select(browser, [inPlanned.id]);
    expect(browser.map.runningInteraction).toBeNull();
    await lock(server, planned.id, false);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await lock(server, planned.id, true);
    expect(browser.map.runningInteraction).toBeNull();
  });
});
