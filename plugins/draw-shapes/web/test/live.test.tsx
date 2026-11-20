// Brief function 7; acceptance criteria 11, 16 and 17: the panel follows the selection and the live picture.
import { act, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changeRequests } from '@emc2/plugin-sdk';
import type { ChangeRequest, DataType, Geometry, MapObject } from '@emc2/plugin-sdk';
import { coreOf } from '../src/content.ts';
import { editPanelOpen, editShape, openBrowser, settle, showPanel, typeAndEnter, inputOf, selectOf } from './harness.tsx';
import { FakeServer, layer, shapeObject } from './fakeServer.ts';
import type { Browser } from './harness.tsx';

const COT: Omit<DataType, 'behaviour'> = { id: 'cot.cot', name: 'Cursor on Target', declaredBy: 'cot', defaults: {} };

function world() {
  const ops = layer('Operations', 1);
  const server = new FakeServer([ops], ['core.general', 'cot.cot']);
  const rect = server.seed(
    shapeObject(ops.id, {
      geometry: { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] },
      properties: { name: 'Objective' },
      extensions: { 'draw-shapes': { kind: 'rectangle' } },
    }),
  );
  const circle = server.seed(shapeObject(ops.id, { properties: { name: 'Zone' } }));
  const third = server.seed(shapeObject(ops.id, { properties: { name: 'Third' } }));
  return { server, ops, rect, circle, third };
}

const open = (server: FakeServer, options: Parameters<typeof openBrowser>[1] = {}) => openBrowser(server, { dataTypes: [COT], ...options });
const updates = (server: FakeServer): ChangeRequest[] => server.requests.filter((r) => r.operation === 'update');
const field = (panel: { container: HTMLElement }, label: string) => within(panel.container).getByLabelText(label);
const stored = (server: FakeServer, object: MapObject): MapObject => {
  const now = server.objects.get(object.id);
  if (now === undefined) throw new Error('the store lost the object');
  return now;
};
const select = (browser: Browser, ids: string[]) => {
  act(() => {
    browser.map.selection.set(ids);
  });
};
const gone = (browser: Browser) => browser.ctx.notifications.filter((n) => n.message.includes('deleted by someone else'));

describe('criterion 16: the panel follows the selection', () => {
  it('shows the shape while exactly that one shape is selected', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    await editShape(browser, rect.id);
    expect(editPanelOpen(browser)).toBe(true);
    select(browser, [rect.id]); // the same selection again
    expect(editPanelOpen(browser)).toBe(true);
  });

  it('closes when the selection changes to another object', async () => {
    const { server, rect, circle } = world();
    const browser = await open(server);
    await editShape(browser, rect.id);
    select(browser, [circle.id]);
    expect(editPanelOpen(browser)).toBe(false);
    await settle();
    expect(browser.ctx.notifications).toHaveLength(0); // nothing was deleted: no notice
  });

  it('closes when the selection changes to several, to none, and when the shape is added to others', async () => {
    const { server, rect, circle } = world();
    const browser = await open(server);
    await editShape(browser, rect.id);
    select(browser, [rect.id, circle.id]);
    expect(editPanelOpen(browser)).toBe(false);

    await editShape(browser, rect.id);
    expect(editPanelOpen(browser)).toBe(true);
    select(browser, []);
    expect(editPanelOpen(browser)).toBe(false);
  });

  it('shows the empty panel text if the panel is still on screen when it closes', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    select(browser, []);
    expect(within(panel.container).getByText(/Select one shape on the map and choose Edit/)).toBeDefined();
  });
});

describe('criterion 11: two browsers editing the same shape', () => {
  it('the later commit wins, and both show the same state', async () => {
    const { server, rect } = world();
    const a = await open(server);
    const b = await open(server);
    const panelA = await editShape(a, rect.id);
    const panelB = await editShape(b, rect.id);
    await typeAndEnter(field(panelA, 'Name'), 'First');
    await typeAndEnter(field(panelB, 'Name'), 'Second');
    expect(stored(server, rect).properties?.name).toBe('Second');
    expect(inputOf(panelA, 'Name').value).toBe('Second');
    expect(inputOf(panelB, 'Name').value).toBe('Second');
    // Each commit was based on the newest version its browser had.
    expect(updates(server).map((r) => r.baseVersion)).toEqual([1, 2]);
  });

  it('also when the second browser has not heard of the first change yet', async () => {
    const { server, rect } = world();
    const a = await open(server);
    const b = await open(server);
    const panelA = await editShape(a, rect.id);
    const panelB = await editShape(b, rect.id);
    b.connection.lagLive = true;
    await typeAndEnter(field(panelA, 'Name'), 'First');
    await typeAndEnter(field(panelB, 'Name'), 'Second');
    expect(stored(server, rect).properties?.name).toBe('Second');
    act(() => {
      b.connection.flushLive();
    });
    expect(inputOf(panelB, 'Name').value).toBe('Second'); // the older event does not bring 'First' back
    expect(inputOf(panelA, 'Name').value).toBe('Second');
  });
});

describe('criterion 17: live updates', () => {
  it('a shape changed in a second browser shows the new values in the open panel', async () => {
    const { server, rect } = world();
    const a = await open(server);
    const b = await open(server);
    const panelA = await editShape(a, rect.id);
    const panelB = await editShape(b, rect.id);
    await typeAndEnter(field(panelB, 'Name'), 'Renamed in B');
    fireEvent.change(field(panelB, 'Outline width'), { target: { value: '8' } });
    await settle();
    fireEvent.change(field(panelB, 'Fill'), { target: { value: 'hatched' } });
    await settle();
    expect(inputOf(panelA, 'Name').value).toBe('Renamed in B');
    expect(selectOf(panelA, 'Outline width').value).toBe('8');
    expect(selectOf(panelA, 'Fill').value).toBe('hatched');
    expect(within(panelA.container).getByText('Version').nextElementSibling?.textContent).toBe('4');
  });

  it('does not overwrite a field being typed in, and the commit is based on the newest version', async () => {
    const { server, rect } = world();
    const a = await open(server);
    const b = await open(server);
    const panelA = await editShape(a, rect.id);
    const panelB = await editShape(b, rect.id);
    fireEvent.change(field(panelA, 'Name'), { target: { value: 'Half typed' } });
    await typeAndEnter(field(panelB, 'Name'), 'Elsewhere');
    fireEvent.change(field(panelB, 'Outline width'), { target: { value: '5' } });
    await settle();
    // A is in the middle of typing: the name stays, a field A is not editing follows.
    expect(inputOf(panelA, 'Name').value).toBe('Half typed');
    expect(selectOf(panelA, 'Outline width').value).toBe('5');
    fireEvent.keyDown(field(panelA, 'Name'), { key: 'Enter' });
    await settle();
    expect(stored(server, rect).properties?.name).toBe('Half typed');
    expect(stored(server, rect).style?.strokeWidth).toBe(5); // B's change is kept: only the name changed
    expect(updates(server).at(-1)?.baseVersion).toBe(3);
  });

  it('does not overwrite a colour being picked', async () => {
    const { server, rect } = world();
    const a = await open(server);
    const b = await open(server);
    const panelA = await editShape(a, rect.id);
    const panelB = await editShape(b, rect.id);
    const colour = inputOf(panelA, 'Outline colour');
    fireEvent.change(colour, { target: { value: '#aa3300' } });
    const colourB = field(panelB, 'Outline colour');
    fireEvent.change(colourB, { target: { value: '#00aa33' } });
    fireEvent.blur(colourB);
    await settle();
    expect(colour.value).toBe('#aa3300');
  });

  it('Edit for a shape outside the map\'s view opens the panel "not in view", a change elsewhere shows there too, and a commit updates the shape from its newest version', async () => {
    const { server, rect } = world();
    const browser = await open(server, { viewAway: true });
    let reads = 0;
    const read = browser.ctx.objects.get.bind(browser.ctx.objects);
    browser.ctx.objects.get = (ids) => {
      reads++;
      return read(ids);
    };
    const panel = await editShape(browser, rect.id);
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    const readsAfterOpen = reads;

    // Someone else changes the shape: the fixed-area subscription round it keeps the panel current.
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(rect, { ...coreOf(rect), properties: { name: 'Changed elsewhere' } }));
    });
    expect(inputOf(panel, 'Name').value).toBe('Changed elsewhere');
    expect(within(panel.container).getByText('Not in view')).toBeDefined();

    // The live copy lags behind: before a commit the shape is read by id, so the update is based on the newest version.
    browser.connection.lagLive = true;
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(stored(server, rect), { ...coreOf(rect), properties: { name: 'Changed again' } }));
    });
    expect(inputOf(panel, 'Name').value).toBe('Changed elsewhere');
    await typeAndEnter(field(panel, 'Name'), 'Mine');
    expect(reads).toBe(readsAfterOpen + 1);
    expect(updates(server).at(-1)?.baseVersion).toBe(3);
    expect(stored(server, rect)).toMatchObject({ version: 4, properties: { name: 'Mine' } });
    expect(inputOf(panel, 'Name').value).toBe('Mine');
    expect(within(panel.container).getByText('Version').nextElementSibling?.textContent).toBe('4');
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
  });

  it('a shape that leaves the subscribed area stays open, the area is renewed round its new position, and live updates go on', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    expect(within(panel.container).queryByText('Not in view')).toBeNull();
    const first = browser.ctx.liveSubscriptions[1]?.area;

    // Someone moves the shape out of the map's view and of the ring: the store sends `left`.
    const faraway: Geometry = { type: 'Polygon', coordinates: [[[100.0, -30.0], [100.3, -30.0], [100.3, -29.9], [100.0, -29.9], [100.0, -30.0]]] };
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(rect, { ...coreOf(rect), geometry: faraway }));
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(true);
    expect(browser.map.selection.value).toEqual([rect.id]); // the selection keeps it
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    expect(browser.ctx.liveSubscriptions).toHaveLength(2); // the old area ended, a new one began
    const second = browser.ctx.liveSubscriptions[1]?.area;
    expect(second).not.toEqual(first);
    expect(typeof second === 'object' ? second.inside[0] : null).toBeGreaterThan(99);
    expect(typeof second === 'object' ? second.inside[1] : null).toBeLessThan(-29);

    act(() => {
      server.changeElsewhere(changeRequests.updateObject(stored(server, rect), { ...coreOf(stored(server, rect)), properties: { name: 'At its new place' } }));
    });
    expect(inputOf(panel, 'Name').value).toBe('At its new place');

    // And back into the view: the mark goes.
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(stored(server, rect), { ...coreOf(stored(server, rect)), geometry: rect.geometry }));
    });
    await settle();
    expect(within(panel.container).queryByText('Not in view')).toBeNull();
    expect(browser.ctx.liveSubscriptions).toHaveLength(2);
  });

  it('a new snapshot at any time replaces what the panel shows', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    server.objects.set(rect.id, { ...rect, version: 7, properties: { name: 'After reconnect' } });
    act(() => {
      server.sendSnapshot(browser.ctx);
    });
    expect(inputOf(panel, 'Name').value).toBe('After reconnect');
  });

  it('a shape that is not in a new snapshot of its area is read again, and followed where it is now', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    // While the browser was away the shape was moved far off (no event reached it).
    const faraway: Geometry = { type: 'Polygon', coordinates: [[[100.0, -30.0], [100.3, -30.0], [100.3, -29.9], [100.0, -29.9], [100.0, -30.0]]] };
    server.objects.set(rect.id, { ...rect, version: 2, geometry: faraway });
    act(() => {
      server.sendSnapshot(browser.ctx);
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(true);
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    expect(within(panel.container).getByText('Version').nextElementSibling?.textContent).toBe('2');
    const area = browser.ctx.liveSubscriptions[1]?.area;
    expect(typeof area === 'object' ? area.inside[0] : null).toBeGreaterThan(99);
  });

  it('a failed read shows the reason with a Retry', async () => {
    const { server, rect } = world();
    const browser = await open(server, { viewAway: true });
    browser.connection.failReads = true;
    await act(async () => {
      await browser.ctx.objectActions[0]?.run([rect.id]);
    });
    await settle();
    const panel = showPanel(browser, 'draw-shapes-edit');
    expect(within(panel.container).getByRole('alert').textContent).toContain('no answer from the server');
    expect(within(panel.container).queryByLabelText('Name')).toBeNull();
    browser.connection.failReads = false;
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Retry' }));
    await settle();
    expect(inputOf(panel, 'Name').value).toBe('Objective');
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
  });

  it('says so, and keeps the input, when the shape cannot be read before a commit', async () => {
    const { server, rect } = world();
    const browser = await open(server, { viewAway: true });
    const panel = await editShape(browser, rect.id);
    browser.connection.failReads = true;
    await typeAndEnter(field(panel, 'Name'), 'Cannot save');
    expect(updates(server)).toHaveLength(0);
    expect(browser.ctx.notifications.at(-1)?.message).toContain('Could not read the shape');
    expect(inputOf(panel, 'Name').value).toBe('Cannot save');
  });
});

describe('function 7: a shape deleted elsewhere', () => {
  it('closes the panel and says so once', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    await editShape(browser, rect.id);
    server.changeElsewhere(changeRequests.deleteObject(rect));
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
    expect(browser.map.selection.value).toEqual([]);
    expect(gone(browser)).toHaveLength(1);
  });

  it('says so once also when the map view takes the shape out of the selection first', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    await editShape(browser, rect.id);
    server.deleteSilently(rect.id);
    select(browser, []); // the map view pruned the selection before this plugin heard of the deletion
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
    expect(gone(browser)).toHaveLength(1);
  });

  it('closes the panel of a shape that is not in view when a commit finds it deleted', async () => {
    const { server, rect } = world();
    const browser = await open(server, { viewAway: true });
    const panel = await editShape(browser, rect.id);
    server.deleteSilently(rect.id); // the live copy has not heard of it yet
    await typeAndEnter(field(panel, 'Name'), 'Too late');
    expect(editPanelOpen(browser)).toBe(false);
    expect(updates(server)).toHaveLength(0);
    expect(gone(browser)).toHaveLength(1);
  });

  it('closes the panel when the store answers that the shape is not found', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    const panel = await editShape(browser, rect.id);
    browser.connection.rejectNext.push('ENTITY_NOT_FOUND');
    await typeAndEnter(field(panel, 'Name'), 'Too late');
    expect(editPanelOpen(browser)).toBe(false);
    expect(gone(browser)).toHaveLength(1);
  });

  it('says nothing when the user only deselects the shape', async () => {
    const { server, rect } = world();
    const browser = await open(server);
    await editShape(browser, rect.id);
    select(browser, []);
    await settle();
    expect(gone(browser)).toHaveLength(0);
  });

  it('Edit for a shape that no longer exists says so and leaves no panel', async () => {
    const { server, rect } = world();
    const browser = await open(server, { viewAway: true });
    server.deleteSilently(rect.id);
    await act(async () => {
      await browser.ctx.objectActions[0]?.run([rect.id]);
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
    expect(browser.map.selection.value).toEqual([]);
    expect(gone(browser)).toHaveLength(1);
  });
});

describe('function 7: Edit for a shape that is not a shape', () => {
  it('refuses an object that is not a core.shape', async () => {
    const { server, ops } = world();
    const symbol = server.seed({ ...shapeObject(ops.id), type: 'core.symbol', geometry: { type: 'Point', coordinates: [15.5, 60.25] } });
    const browser = await open(server);
    await act(async () => {
      await browser.ctx.objectActions[0]?.run([symbol.id]);
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
    expect(browser.ctx.notifications.at(-1)?.message).toContain('not a shape');
  });
});
