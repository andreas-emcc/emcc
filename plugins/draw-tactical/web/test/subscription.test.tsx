// Criterion 11 (brief, function 9), as draw-shapes' criterion 18: the layers come from one
// `{ objects: false }` subscription; the graphic being edited or selected has a second one with a small
// fixed area round it; moving the map adds none; a graphic moved away is followed. Also the live
// updates of function 6 and the "not in view" mark.
import { act, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changeRequests } from '@emc2/plugin-sdk';
import type { Area, LivePictureOptions } from '@emc2/plugin-sdk';
import { centroidOf, distanceMetres, RING_HALF_METRES } from '../src/geo.ts';
import { coreOf } from '../src/content.ts';
import { WATCH_BUDGET } from '../src/watch.ts';
import { AWAY, buttonOf, chooseGraphic, clickTool, editGraphic, editPanelOpen, finishDrawing, inputOf, openBrowser, settle, showGraphicsPanel, typeAndEnter } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { AXIS_SIDC, FakeServer, graphicObject, inArea, layer } from './fakeServer.ts';

const stored = (server: FakeServer, object: { readonly id: string }) => {
  const now = server.objects.get(object.id);
  if (now === undefined) throw new Error('the store lost the object');
  return now;
};

function world() {
  const ops = layer('Operations', 1);
  const server = new FakeServer([ops], ['core.general']);
  const line = server.seed(graphicObject(ops.id, { properties: { name: 'Boundary A' } }));
  const axis = server.seed(
    graphicObject(ops.id, { geometry: { type: 'LineString', coordinates: [[18.07, 59.33], [17.4, 58.95], [16.8, 58.7], [18.5, 58.8]] }, symbol: { standard: 'APP-6D', sidc: AXIS_SIDC } }),
  );
  const symbol = server.seed({ ...graphicObject(ops.id), type: 'core.symbol', geometry: { type: 'Point', coordinates: [18.2, 59.2] }, symbol: { standard: 'APP-6D', sidc: '10031000001211000000' } });
  return { server, ops, line, axis, symbol };
}

const areas = (browser: Browser): Area[] => browser.ctx.liveSubscriptions.flatMap((o) => (typeof o.area === 'object' ? [o.area] : []));
const select = (browser: Browser, ids: string[]) => {
  act(() => {
    browser.map.selection.set(ids);
  });
};

describe('criterion 11: the subscriptions', () => {
  it('there is one subscription for the layers, and none for objects while nothing is edited, also while placing', async () => {
    const { server } = world();
    const browser = await openBrowser(server);
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
    await showGraphicsPanel(browser);
    await chooseGraphic('Phase Line');
    await clickTool();
    await finishDrawing(browser, { type: 'LineString', coordinates: [[18.0, 59.3], [18.5, 59.6]] });
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('opening the edit panel adds one with a small fixed area round the graphic, after the graphic was read by id', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server);
    const order: string[] = [];
    const read = browser.ctx.objects.get.bind(browser.ctx.objects);
    browser.ctx.objects.get = (ids) => {
      order.push('read');
      return read(ids);
    };
    const subscribe = browser.ctx.livePicture.subscribe.bind(browser.ctx.livePicture);
    browser.ctx.livePicture.subscribe = (listener, options) => {
      order.push('subscribe');
      return subscribe(listener, options);
    };
    await editGraphic(browser, line.id);
    // The first read is the fake menu's own check of the object; the plugin's read comes before its subscription.
    expect(order).toEqual(['read', 'read', 'subscribe']);

    expect(browser.ctx.liveSubscriptions).toHaveLength(2);
    const second: LivePictureOptions | undefined = browser.ctx.liveSubscriptions[1];
    expect(second?.objects).toBeUndefined();
    expect(second?.budget).toBe(WATCH_BUDGET);
    const area = second?.area;
    if (typeof area !== 'object') throw new Error('the second subscription has no fixed area');
    const centroid = centroidOf(line.geometry);
    expect(area.inside).toEqual(centroid);
    expect(area.ring).toHaveLength(5);
    expect(area.ring[0]).toEqual(area.ring[4]);
    for (const corner of area.ring) expect(distanceMetres(centroid, corner)).toBeLessThan(RING_HALF_METRES * 1.5);
    expect(inArea(line, area)).toBe(true);
  });

  it('closing the edit panel ends it: by Close, by another selection, by the graphic being deleted', async () => {
    const { server, line, axis } = world();
    const browser = await openBrowser(server);
    const panel = await editGraphic(browser, line.id);
    fireEvent.click(buttonOf(panel, 'Close'));
    await settle();
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);

    await editGraphic(browser, line.id);
    select(browser, [axis.id]);
    await settle();
    // The other graphic is the selected one now, and followed: still two.
    expect(areas(browser)).toHaveLength(1);
    expect(areas(browser)[0]?.inside).toEqual(centroidOf(axis.geometry));
    select(browser, []);
    await settle();
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);

    await editGraphic(browser, line.id);
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(line));
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
    expect(browser.connection.subscriptions).toHaveLength(1); // the store has none left either
  });

  it('selecting one graphic adds the subscription too; a symbol or several objects get none', async () => {
    const { server, line, axis, symbol } = world();
    const browser = await openBrowser(server);
    select(browser, [line.id]);
    await settle();
    expect(areas(browser)).toHaveLength(1);
    select(browser, [line.id, axis.id]);
    await settle();
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
    select(browser, [symbol.id]);
    await settle();
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('moving the map adds none, and renews none', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server);
    const before = JSON.stringify(browser.ctx.liveSubscriptions);
    for (const lon of [16, 17, 18, 19]) {
      act(() => {
        browser.map.goTo([lon, 60], 500);
      });
    }
    expect(JSON.stringify(browser.ctx.liveSubscriptions)).toBe(before);
    await editGraphic(browser, line.id);
    const during = JSON.stringify(browser.ctx.liveSubscriptions);
    for (const lat of [58, 59, 60]) {
      act(() => {
        browser.map.goTo([17, lat], 300);
      });
    }
    act(() => {
      browser.map.setViewport(AWAY);
    });
    expect(JSON.stringify(browser.ctx.liveSubscriptions)).toBe(during);
    expect(browser.ctx.liveSubscriptions).toHaveLength(2);
  });

  it('moving the graphic away in a second browser renews the area round its new centroid, and the panel follows it', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server);
    const panel = await editGraphic(browser, line.id);
    const first = areas(browser)[0];
    const now = stored(server, line);
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(now, { ...coreOf(now), geometry: { type: 'LineString', coordinates: [[24.1, 63.2], [24.9, 63.6]] }, properties: { name: 'Moved' } }));
    });
    await settle();
    expect(areas(browser)).toHaveLength(1);
    expect(areas(browser)[0]).not.toEqual(first);
    expect(areas(browser)[0]?.inside[0]).toBeCloseTo(24.5, 0);
    expect(inputOf(panel, 'Name').value).toBe('Moved');
  });

  it('the other objects in the ring are ignored: a change of another graphic does not touch the open panel', async () => {
    const { server, line } = world();
    const other = server.seed(graphicObject(line.layerId, { geometry: { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9]] }, properties: { name: 'Neighbour' } }));
    const browser = await openBrowser(server);
    const panel = await editGraphic(browser, line.id);
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(other, { ...coreOf(other), properties: { name: 'Neighbour 2' } }));
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(true);
    expect(inputOf(panel, 'Name').value).toBe('Boundary A');
    expect(browser.ctx.notifications).toHaveLength(0);
  });
});

describe('function 6: live updates and "not in view"', () => {
  it('a graphic changed in a second browser shows in the open panel, except a field being typed in', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server);
    const panel = await editGraphic(browser, line.id);
    fireEvent.change(inputOf(panel, 'Name'), { target: { value: 'My draft' } });
    const now = stored(server, line);
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(now, { ...coreOf(now), properties: { name: 'Theirs' } }));
    });
    await settle();
    expect(inputOf(panel, 'Name').value).toBe('My draft');
    // Their change reached the panel's state: committing the draft is based on it (last write wins).
    await typeAndEnter(inputOf(panel, 'Name'), 'My draft');
    expect(stored(server, line).properties?.name).toBe('My draft');
    expect(stored(server, line).version).toBe(3);
  });

  it('is marked "not in view" when the map shows another part of the world, and a commit is based on the newest version', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server, { viewAway: true });
    const panel = await editGraphic(browser, line.id);
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    expect(buttonOf(panel, 'Reshape').disabled).toBe(true);
    const now = stored(server, line);
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(now, { ...coreOf(now), properties: { name: 'Theirs' } }));
    });
    await settle();
    await typeAndEnter(inputOf(panel, 'Name'), 'Mine');
    expect(stored(server, line).properties?.name).toBe('Mine');
    expect(stored(server, line).version).toBe(3);
    const update = server.requests.filter((r) => r.operation === 'update').at(-1);
    expect(update).toMatchObject({ baseVersion: 2 });
  });

  it('the mark follows the map view, with no change to the subscriptions', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server);
    const panel = await editGraphic(browser, line.id);
    const before = JSON.stringify(browser.ctx.liveSubscriptions);
    expect(within(panel.container).queryByText('Not in view')).toBeNull();
    const home = browser.map.viewport;
    act(() => {
      browser.map.setViewport(AWAY);
    });
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    act(() => {
      browser.map.setViewport(home);
    });
    expect(within(panel.container).queryByText('Not in view')).toBeNull();
    expect(JSON.stringify(browser.ctx.liveSubscriptions)).toBe(before);
  });

  it('"Show on map" asks the map view to centre on the graphic', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server, { viewAway: true });
    browser.map.setObjectPositions({ [line.id]: centroidOf(line.geometry) });
    const panel = await editGraphic(browser, line.id);
    fireEvent.click(buttonOf(panel, 'Show on map'));
    await settle();
    expect(browser.map.centreOnCalls).toEqual([[line.id]]);
  });

  it('a graphic deleted in a second browser closes the panel with a notice', async () => {
    const { server, line } = world();
    const browser = await openBrowser(server);
    await editGraphic(browser, line.id);
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(line));
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
    expect(browser.ctx.notifications.map((n) => n.message)).toEqual(['The graphic was deleted by someone else.']);
  });
});
