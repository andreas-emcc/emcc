// Criterion 18 (brief, function 7): the layers come from one `{ objects: false }` subscription; the
// shape being edited has a second one with a small fixed area round it, for as long as the edit
// lasts; moving the map adds none; a shape moved away is followed.
import { act, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changeRequests } from '@emc2/plugin-sdk';
import type { Area, Geometry, LayerContent, LivePictureOptions, Position } from '@emc2/plugin-sdk';
import { centroidOf, distanceMetres, RING_HALF_METRES } from '../src/geo.ts';
import { coreOf } from '../src/content.ts';
import { WATCH_BUDGET } from '../src/watch.ts';
import { AWAY, buttonOf, editPanelOpen, editShape, finishDrawing, openBrowser, settle, showShapesPanel, typeAndEnter, chooseTool, inputOf, selectOf } from './harness.tsx';
import { FakeServer, inArea, layer, shapeObject } from './fakeServer.ts';
import type { Browser } from './harness.tsx';

const RECT: Geometry = { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] };

const stored = (server: FakeServer, object: { readonly id: string }) => {
  const now = server.objects.get(object.id);
  if (now === undefined) throw new Error('the store lost the object');
  return now;
};

function world() {
  const ops = layer('Operations', 1);
  const reserve = layer('Reserve', 2);
  const server = new FakeServer([ops, reserve], ['core.general']);
  const rect = server.seed(shapeObject(ops.id, { geometry: RECT, properties: { name: 'Objective' }, extensions: { 'draw-shapes': { kind: 'rectangle' } } }));
  const circle = server.seed(shapeObject(ops.id, { properties: { name: 'Zone' } }));
  return { server, ops, reserve, rect, circle };
}

/** The areas of the browser's area subscriptions. */
function areas(browser: Browser): Area[] {
  return browser.ctx.liveSubscriptions.flatMap((o) => (typeof o.area === 'object' ? [o.area] : []));
}

const select = (browser: Browser, ids: string[]) => {
  act(() => {
    browser.map.selection.set(ids);
  });
};

describe('criterion 18: the subscriptions', () => {
  it('there is one subscription for the layers, and no subscription for objects while nothing is edited', async () => {
    const { server } = world();
    const browser = await openBrowser(server);
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await finishDrawing(browser, { type: 'Circle', center: [18.0686, 59.3293], radius: 2500 });
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]); // drawing needs none either
  });

  it('opening the edit panel adds one with a small fixed area round the shape, after the shape was read by id', async () => {
    const { server, rect } = world();
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
    await editShape(browser, rect.id);
    // The first read is the fake menu's own check of the object; the plugin's read comes before its subscription.
    expect(order).toEqual(['read', 'read', 'subscribe']);

    expect(browser.ctx.liveSubscriptions).toHaveLength(2);
    const second: LivePictureOptions | undefined = browser.ctx.liveSubscriptions[1];
    expect(second?.objects).toBeUndefined();
    expect(second?.budget).toBe(WATCH_BUDGET);
    const area = second?.area;
    if (typeof area !== 'object') throw new Error('the second subscription has no fixed area');
    // A ring round the shape's centroid, with `inside` at it.
    const centroid = centroidOf(rect.geometry);
    expect(area.inside).toEqual(centroid);
    expect(area.ring).toHaveLength(5);
    expect(area.ring[0]).toEqual(area.ring[4]);
    for (const corner of area.ring) expect(distanceMetres(centroid, corner)).toBeLessThan(RING_HALF_METRES * 1.5);
    expect(inArea(rect, area)).toBe(true);
  });

  it('closing the edit panel ends it, by Close, by a change of the selection and by the shape being deleted', async () => {
    const { server, rect, circle } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, rect.id);
    expect(browser.ctx.liveSubscriptions).toHaveLength(2);
    fireEvent.click(buttonOf(panel, 'Close'));
    await settle();
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);

    await editShape(browser, rect.id);
    expect(browser.ctx.liveSubscriptions).toHaveLength(2);
    select(browser, [circle.id]);
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);

    await editShape(browser, rect.id);
    expect(browser.ctx.liveSubscriptions).toHaveLength(2);
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(rect));
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(false);
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
    expect(browser.connection.subscriptions).toHaveLength(1); // the store has none left either
  });

  it('Edit for another shape ends the first one\'s subscription: there is one area at a time', async () => {
    const { server, rect, circle } = world();
    const browser = await openBrowser(server);
    await editShape(browser, rect.id);
    const first = areas(browser)[0];
    document.body.replaceChildren();
    await editShape(browser, circle.id);
    expect(areas(browser)).toHaveLength(1);
    expect(areas(browser)[0]?.inside).toEqual(centroidOf(circle.geometry));
    expect(areas(browser)[0]).not.toEqual(first);
  });

  it('moving the map adds none, and renews none', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server);
    const before = JSON.stringify(browser.ctx.liveSubscriptions);
    for (const lon of [16, 17, 18, 19]) {
      act(() => {
        browser.map.goTo([lon, 60], 500);
      });
    }
    expect(JSON.stringify(browser.ctx.liveSubscriptions)).toBe(before);
    await editShape(browser, rect.id);
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

  it('the store sends the plugin nothing for the map: a snapshot on the layers subscription holds no object', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server);
    expect(browser.connection.log).toEqual(['snapshot layers 0']);
    await editShape(browser, rect.id);
    // The shape itself, and the circle that also reaches into the ring: the plugin keeps only its own shape.
    expect(browser.connection.log.at(-1)).toBe('snapshot area 2');
  });

  it('a very large shape still gets a small ring', async () => {
    const { server, ops } = world();
    const country = server.seed(shapeObject(ops.id, { geometry: { type: 'Polygon', coordinates: [[[10, 55], [24, 55], [24, 69], [10, 69], [10, 55]]] } }));
    const browser = await openBrowser(server);
    await editShape(browser, country.id);
    const area = areas(browser)[0];
    expect(area).toBeDefined();
    for (const corner of area?.ring ?? []) expect(distanceMetres(area?.inside ?? [0, 0], corner)).toBeLessThan(RING_HALF_METRES * 1.5);
    expect(browser.connection.log.at(-1)).toBe('snapshot area 1'); // and the shape is in it
  });

  it('a shape across the antimeridian gets a ring round its centroid', async () => {
    const { server, ops } = world();
    const line = server.seed(shapeObject(ops.id, { geometry: { type: 'LineString', coordinates: [[179.5, 10.2], [-179.5, 10.4]] }, properties: { name: 'Date line' } }));
    const browser = await openBrowser(server);
    await editShape(browser, line.id);
    const area = areas(browser)[0];
    expect(Math.abs(area?.inside[0] ?? 0)).toBeGreaterThan(179.9);
    expect(area?.inside[1]).toBeCloseTo(10.3, 1);
    for (const corner of area?.ring ?? []) expect(Math.abs(corner[0])).toBeLessThanOrEqual(180);
  });
});

describe('"not in view" follows the view of the map', () => {
  it('appears when the view moves away from the shape and goes when it moves back, with no change to the subscriptions', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, rect.id);
    const before = JSON.stringify(browser.ctx.liveSubscriptions);
    expect(within(panel.container).queryByText('Not in view')).toBeNull();
    const home = browser.map.viewport;
    act(() => {
      browser.map.setViewport(AWAY);
    });
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    expect(buttonOf(panel, 'Reshape').disabled).toBe(true);
    act(() => {
      browser.map.setViewport(home);
    });
    expect(within(panel.container).queryByText('Not in view')).toBeNull();
    expect(buttonOf(panel, 'Reshape').disabled).toBe(false);
    expect(JSON.stringify(browser.ctx.liveSubscriptions)).toBe(before);
  });

  it('"Show on map" asks the map view to centre on the shape', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server, { viewAway: true });
    browser.map.setObjectPositions({ [rect.id]: centroidOf(rect.geometry) });
    const panel = await editShape(browser, rect.id);
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    fireEvent.click(buttonOf(panel, 'Show on map'));
    await settle();
    expect(browser.map.centreOnCalls).toEqual([[rect.id]]);
    expect(browser.map.viewport.center).toEqual(centroidOf(rect.geometry));
  });
});

describe('criterion 18: the other objects in the ring', () => {
  it('are sent by the store and ignored: a change or a deletion of another object does not touch the open panel', async () => {
    const { server, rect, circle } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, rect.id);
    const before = areas(browser)[0];
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(circle, { ...coreOf(circle), properties: { name: 'Zone 2' } }));
    });
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(stored(server, circle)));
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(true);
    expect(inputOf(panel, 'Name').value).toBe('Objective');
    expect(areas(browser)[0]).toBe(before);
    expect(browser.ctx.notifications).toHaveLength(0);
  });
});

describe('criterion 18: a shape moved away is followed', () => {
  const FAR: Geometry = { type: 'Polygon', coordinates: [[[100.0, -30.0], [100.3, -30.0], [100.3, -29.9], [100.0, -29.9], [100.0, -30.0]]] };

  it('the store reports it as left, the area is renewed round the new centroid, and the panel follows it', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, rect.id);
    const old = areas(browser)[0];

    act(() => {
      server.changeElsewhere(changeRequests.updateObject(rect, { ...coreOf(rect), geometry: FAR }));
    });
    await settle();

    expect(areas(browser)).toHaveLength(1);
    const renewed = areas(browser)[0];
    expect(renewed).not.toEqual(old);
    expect(renewed?.inside).toEqual(centroidOf(FAR));
    expect(browser.connection.subscriptions).toHaveLength(2);
    expect(within(panel.container).getByText('Version').nextElementSibling?.textContent).toBe('2');

    act(() => {
      server.changeElsewhere(changeRequests.updateObject({ ...rect, version: 2 }, { ...coreOf(rect), geometry: FAR, properties: { name: 'Over there' } }));
    });
    expect(inputOf(panel, 'Name').value).toBe('Over there');
  });

  it('a small move inside the ring does not renew the area', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server);
    await editShape(browser, rect.id);
    const old = areas(browser)[0];
    const nudged: Geometry = { type: 'Polygon', coordinates: [[[18.001, 59.3], [18.301, 59.3], [18.301, 59.4], [18.001, 59.4], [18.001, 59.3]]] };
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(rect, { ...coreOf(rect), geometry: nudged }));
    });
    await settle();
    expect(areas(browser)[0]).toBe(old);
    expect(browser.connection.log.filter((l) => l.startsWith('snapshot area'))).toHaveLength(1);
  });

  it('our own reshape that moves the shape far away renews the area without waiting for `left`', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, rect.id);
    fireEvent.click(buttonOf(panel, 'Reshape'));
    await settle();
    browser.connection.lagLive = true; // the store's `left` is not heard: our own outcome alone renews the area
    await finishDrawing(browser, FAR);
    expect(areas(browser)).toHaveLength(1);
    expect(areas(browser)[0]?.inside).toEqual(centroidOf(FAR));
    // The panel keeps showing the shape, now outside the map's view.
    expect(within(panel.container).getByText('Not in view')).toBeDefined();
    await typeAndEnter(inputOf(panel, 'Name'), 'Moved by me');
    expect(server.objects.get(rect.id)?.properties?.name).toBe('Moved by me');
  });

  it('a shape that is not sent (clustered, or not in a new snapshot) is read by id and not followed in a loop', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server);
    await editShape(browser, rect.id);
    const before = browser.connection.log.length;
    // A new snapshot of the area that lacks the shape although it is there (the store clustered it).
    const sub = browser.connection.subscriptions[1];
    act(() => {
      sub?.listener.snapshot({ layers: [], objects: [], sequenceNo: 9 });
    });
    await settle();
    expect(editPanelOpen(browser)).toBe(true);
    expect(areas(browser)).toHaveLength(1);
    expect(browser.connection.log.length).toBe(before); // no new subscription, no loop
    // The store later sends the shape as entered (its cell is no longer a cluster): the live copy is back.
    act(() => {
      sub?.listener.area?.({ sequenceNo: 10, entered: [{ ...rect, version: 2, properties: { name: 'From entered' } }], left: [] });
    });
    expect(within(document.body).getByLabelText<HTMLInputElement>('Name').value).toBe('From entered');
    // Without live updates a commit reads the shape by id and still updates it.
    const panel = within(document.body);
    await typeAndEnter(panel.getByLabelText('Name'), 'Still works');
    expect(server.objects.get(rect.id)?.properties?.name).toBe('Still works');
  });
});

describe('the layers come from the layers subscription', () => {
  it('a layer added or renamed while the panel is open shows in the Layer list', async () => {
    const { server, rect, reserve } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, rect.id);
    expect([...selectOf(panel, 'Layer').options].map((o) => o.textContent)).toEqual(['Reserve', 'Operations']);
    const added = layer('Third', 3);
    const content: LayerContent = { name: added.name, drawOrder: added.drawOrder, visible: true, label: added.label };
    server.layers.set(added.id, added);
    act(() => {
      browser.ctx.live.changes([
        { sequenceNo: 50, requestId: 'r1', entityType: 'layer', operation: 'create', entityId: added.id, version: 1, previousVersion: null, state: { ...added, ...content }, label: added.label, at: '2026-10-17T10:00:00.000Z', by: { plugin: 'core' } },
        { sequenceNo: 51, requestId: 'r2', entityType: 'layer', operation: 'update', entityId: reserve.id, version: 2, previousVersion: 1, state: { ...reserve, name: 'Reserve 2', version: 2 }, label: reserve.label, at: '2026-10-17T10:00:01.000Z', by: { plugin: 'core' } },
      ]);
    });
    expect([...selectOf(panel, 'Layer').options].map((o) => o.textContent)).toEqual(['Third', 'Reserve 2', 'Operations']);
  });

  it('the active layer must be one of them: drawing is off when it is deleted', async () => {
    const { server, ops } = world();
    const browser = await openBrowser(server);
    showShapesPanel(browser);
    act(() => {
      browser.ctx.live.changes([
        { sequenceNo: 60, requestId: 'r3', entityType: 'layer', operation: 'delete', entityId: ops.id, version: 2, previousVersion: 1, state: null, label: ops.label, at: '2026-10-17T10:00:00.000Z', by: { plugin: 'core' } },
      ]);
    });
    expect(within(document.body).getByText('Select or create a layer in the layer panel')).toBeDefined();
  });

  it('a new snapshot of the layers replaces them', async () => {
    const { server, rect } = world();
    const browser = await openBrowser(server);
    const panel = await editShape(browser, rect.id);
    const only = layer('Only', 1);
    act(() => {
      browser.ctx.live.snapshot({ layers: [only], objects: [] });
    });
    expect([...selectOf(panel, 'Layer').options].map((o) => o.textContent)).toContain('Only');
  });
});

describe('position helpers used by the tests', () => {
  it('the test store\'s area rule agrees with the ring', () => {
    const { rect } = world();
    const near: Position = centroidOf(rect.geometry);
    expect(inArea(rect, { ring: [[near[0] - 0.001, near[1] - 0.001], [near[0] + 0.001, near[1] - 0.001], [near[0] + 0.001, near[1] + 0.001], [near[0] - 0.001, near[1] + 0.001], [near[0] - 0.001, near[1] - 0.001]], inside: near })).toBe(true);
    expect(inArea(rect, { ring: [[100, -30], [100.1, -30], [100.1, -29.9], [100, -29.9], [100, -30]], inside: [100.05, -29.95] })).toBe(false);
  });
});
