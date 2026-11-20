// Brief function 16 (T-066); acceptance criteria 25 to 30 (the plugin's part) and the addition to
// criterion 18: dragging the selected shape with the map view's `dragObject`.
import { act, fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changeRequests } from '@emc2/plugin-sdk';
import type { ChangeRequest, Geometry, MapObject, Position, Uuid, Viewport } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import { centroidOf } from '../src/geo.ts';
import { coreOf } from '../src/content.ts';
import { chooseTool, editShape, finishDrawing, inputOf, openBrowser, settle, showShapesPanel, typeAndEnter, AWAY } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { FakeServer, layer, shapeObject } from './fakeServer.ts';

const RECT: Geometry = { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]]] };
const HOLED_RINGS: Position[][] = [
  [[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]],
  [[18.1, 59.32], [18.2, 59.32], [18.2, 59.35], [18.1, 59.32]],
];
const HOLED: Geometry = { type: 'Polygon', coordinates: HOLED_RINGS };
const LINE_POINTS: Position[] = [[17.5, 59.1], [18.5, 59.6], [19.25, 59.2]];
const LINE: Geometry = { type: 'LineString', coordinates: LINE_POINTS };

function world() {
  const ops = layer('Operations', 1);
  const reserve = layer('Reserve', 2);
  const server = new FakeServer([ops, reserve], ['core.general']);
  const rect = server.seed(shapeObject(ops.id, { geometry: RECT, properties: { name: 'Objective' }, extensions: { 'draw-shapes': { kind: 'rectangle' }, other: { x: 1 } } }));
  const circle = server.seed(shapeObject(ops.id, { properties: { name: 'Zone' } }));
  const symbol = server.seed({
    ...shapeObject(ops.id),
    type: 'core.symbol',
    geometry: { type: 'Point', coordinates: [18.2, 59.2] },
    symbol: { standard: 'APP-6D', sidc: '10031000001211000000' },
  });
  return { server, ops, reserve, rect, circle, symbol };
}

/** What the plugin asked the map view to drag, in order (the fake map view's `dragObject` wrapped). */
function recordDrags(browser: Browser): Uuid[] & { readonly signals: (AbortSignal | undefined)[] } {
  const signals: (AbortSignal | undefined)[] = [];
  const ids: Uuid[] = [];
  const original = browser.map.dragObject.bind(browser.map);
  browser.map.dragObject = (id, options) => {
    ids.push(id);
    signals.push(options?.signal);
    return original(id, options);
  };
  Object.defineProperty(ids, 'signals', { value: signals }); // not enumerable, so that toEqual compares the ids only
  return ids as Uuid[] & { readonly signals: (AbortSignal | undefined)[] };
}

const updates = (server: FakeServer): ChangeRequest[] => server.requests.filter((r) => r.operation === 'update');
const stored = (server: FakeServer, object: { readonly id: string }): MapObject => {
  const now = server.objects.get(object.id);
  if (now === undefined) throw new Error('the store lost the object');
  return now;
};

const select = async (browser: Browser, ids: string[]) => {
  act(() => {
    browser.map.selection.set(ids);
  });
  await settle();
};

/** The user drops the dragged shape at `position`. */
const drop = async (browser: Browser, position: Position | null) => {
  act(() => {
    browser.map.completeInteraction(position);
  });
  await settle();
};

/** The browser with the drags recorded, and the layers' objects in its view. */
async function ready(options: Parameters<typeof openBrowser>[1] = {}) {
  const w = world();
  const browser = await openBrowser(w.server, options);
  const drags = recordDrags(browser);
  return { ...w, browser, drags };
}

/** Each position moved by +2 degrees of longitude and +1 of latitude, written out here and not with the plugin's code. */
const plus = (p: Position): Position => {
  const altitude = p[2];
  return altitude === undefined ? [p[0] + 2, p[1] + 1] : [p[0] + 2, p[1] + 1, altitude];
};

describe('criterion 25: dragging a shape moves it', () => {
  const shapes: readonly { readonly name: string; readonly geometry: Geometry; readonly expected: Geometry; readonly drop: Position }[] = [
    {
      name: 'a polygon with a hole',
      geometry: HOLED,
      drop: [20, 60.3],
      expected: { type: 'Polygon', coordinates: HOLED_RINGS.map((ring) => ring.map(plus)) },
    },
    { name: 'a line', geometry: LINE, drop: [19.5, 60.1], expected: { type: 'LineString', coordinates: LINE_POINTS.map(plus) } },
    {
      name: 'a circle',
      geometry: { type: 'Circle', center: [18.0686, 59.3293], radius: 2500 },
      drop: [20.0686, 60.3293],
      expected: { type: 'Circle', center: [20.0686, 60.3293], radius: 2500 },
    },
    {
      name: 'an ellipse',
      geometry: { type: 'Ellipse', center: [18.1, 59.35], semiMajorAxis: 4000, semiMinorAxis: 1500, rotation: 35 },
      drop: [20.1, 60.35],
      expected: { type: 'Ellipse', center: [20.1, 60.35], semiMajorAxis: 4000, semiMinorAxis: 1500, rotation: 35 },
    },
    {
      name: 'a set of points, with an altitude',
      geometry: { type: 'MultiPoint', coordinates: [[17.6, 59.1, 40], [18.4, 59.5]] },
      drop: [19.6, 60.1],
      expected: { type: 'MultiPoint', coordinates: [[19.6, 60.1, 40], [20.4, 60.5]] },
    },
    {
      name: 'a corridor',
      geometry: { type: 'Corridor', coordinates: [[17.6, 59.1], [18.4, 59.5]], width: 900 },
      drop: [19.6, 60.1],
      expected: { type: 'Corridor', coordinates: [[19.6, 60.1], [20.4, 60.5]], width: 900 },
    },
    {
      name: 'an arc band',
      geometry: { type: 'ArcBand', center: [18.1, 59.35], innerRadius: 200, outerRadius: 3000, startBearing: 20, endBearing: 140 },
      drop: [20.1, 60.35],
      expected: { type: 'ArcBand', center: [20.1, 60.35], innerRadius: 200, outerRadius: 3000, startBearing: 20, endBearing: 140 },
    },
    { name: 'a point', geometry: { type: 'Point', coordinates: [18.2, 59.2] }, drop: [20.2, 60.2], expected: { type: 'Point', coordinates: [20.2, 60.2] } },
  ];

  it.each(shapes)('$name: one update, every position moved by the difference, nothing else changed', async ({ geometry, expected, drop: at }) => {
    const { server, ops, browser, drags } = await ready();
    const shape = server.seed(shapeObject(ops.id, { geometry, properties: { name: 'Dragged' }, extensions: { 'draw-shapes': { kind: 'polygon' }, other: { x: 1 } } }));
    await select(browser, [shape.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags).toEqual([shape.id]);

    await drop(browser, at);
    expect(updates(server)).toHaveLength(1);
    const request = updates(server)[0];
    expect(request).toMatchObject({ entityType: 'object', operation: 'update', entityId: shape.id, baseVersion: 1, source: { plugin: 'draw-shapes' } });
    const now = stored(server, shape);
    expect(now.version).toBe(2);
    expect(now.geometry).toEqual(expected);
    // Everything else as it was: the complete core content, and the other plugin's extension untouched.
    expect(coreOf({ ...now, geometry: shape.geometry })).toEqual(coreOf(shape));
    expect(now.extensions?.['other']).toEqual({ x: 1 });
  });

  it('a polygon and a line move by a difference that is not the same in longitude and latitude', async () => {
    const { server, ops, browser } = await ready();
    const shape = server.seed(shapeObject(ops.id, { geometry: LINE }));
    await select(browser, [shape.id]);
    await drop(browser, [17.5 + 2, 59.1 + 1]);
    const geometry = stored(server, shape).geometry;
    if (geometry.type !== 'LineString') throw new Error('not a line');
    geometry.coordinates.forEach((p, i) => {
      const was = LINE_POINTS[i];
      expect(p[0] - (was?.[0] ?? 0)).toBeCloseTo(2, 9);
      expect(p[1] - (was?.[1] ?? 0)).toBeCloseTo(1, 9);
    });
  });

  it('is armed again at once after a drop, and the next drag starts from the newest state', async () => {
    const { server, rect, browser, drags } = await ready();
    await select(browser, [rect.id]);
    await drop(browser, [20, 60.3]); // +2, +1
    expect(drags).toEqual([rect.id, rect.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await drop(browser, [21, 60.3]); // from the newest first position [20, 60.3]: +1, 0
    expect(updates(server)).toHaveLength(2);
    expect(updates(server)[1]).toMatchObject({ baseVersion: 2 });
    expect(stored(server, rect).geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[21, 60.3], [21.3, 60.3], [21.3, 60.4], [21, 60.4], [21, 60.3]]].map((ring) => ring.map((p) => [p[0], p[1]] as Position)),
    });
  });

  it('a drop that leaves the shape where it was sends nothing', async () => {
    const { server, rect, browser } = await ready();
    await select(browser, [rect.id]);
    await drop(browser, [18.0, 59.3]);
    expect(updates(server)).toHaveLength(0);
  });

  it('a rejection is shown as a notification and the shape stays where it was', async () => {
    const { server, rect, browser } = await ready();
    await select(browser, [rect.id]);
    browser.connection.rejectNext.push('PERMISSION_DENIED');
    await drop(browser, [20, 60.3]);
    expect(browser.ctx.notifications.at(-1)?.message).toContain('PERMISSION_DENIED');
    expect(stored(server, rect).geometry).toEqual(RECT);
  });

  it('an update that is still under way is sent first, and the drop is based on its result', async () => {
    const { server, rect, browser } = await ready();
    const panel = await editShape(browser, rect.id);
    browser.connection.hold = true;
    await typeAndEnter(inputOf(panel, 'Name'), 'Renamed');
    await drop(browser, [20, 60.3]);
    expect(updates(server)).toHaveLength(1); // the rename is under way, the drop waits behind it
    act(() => {
      browser.connection.release();
    });
    await settle();
    await settle();
    expect(updates(server)).toHaveLength(2);
    expect(updates(server)[1]).toMatchObject({ baseVersion: 2 });
    const now = stored(server, rect);
    expect(now.properties).toMatchObject({ name: 'Renamed' });
    expect(now.geometry).toMatchObject({ type: 'Polygon' });
    expect(centroidOf(now.geometry)[0]).toBeGreaterThan(19);
  });
});

describe('criterion 26: at the edges', () => {
  it('a drag across the antimeridian gives longitudes within -180 to 180, each moved by the difference modulo 360', async () => {
    const w = world();
    const browser = await openBrowser(w.server);
    const around: Viewport = { center: [180, 60], resolution: 4891.97, projection: 'EPSG:3857', visibleArea: [[170, 50], [-170, 50], [-170, 70], [170, 70], [170, 50]] };
    browser.map.setViewport(around);
    const line = w.server.seed(shapeObject(w.ops.id, { geometry: { type: 'LineString', coordinates: [[178, 60], [179.5, 61]] } }));
    await select(browser, [line.id]);
    await drop(browser, [-178, 60]); // from 178 to -178: the difference is -356, which is +4 modulo 360
    const geometry = stored(w.server, line).geometry;
    if (geometry.type !== 'LineString') throw new Error('not a line');
    expect(geometry.coordinates.every((p) => Math.abs(p[0]) <= 180)).toBe(true);
    expect(geometry.coordinates[0]?.[0]).toBeCloseTo(-178, 9);
    expect(geometry.coordinates[1]?.[0]).toBeCloseTo(-176.5, 9);
    expect(geometry.coordinates[1]?.[1]).toBeCloseTo(61, 9);
  });

  it('a drag that would pass 90 degrees of latitude clamps the positions at 90', async () => {
    const w = world();
    const browser = await openBrowser(w.server);
    browser.map.setViewport({ center: [10, 85], resolution: 4891.97, projection: 'EPSG:3857', visibleArea: [[0, 80], [20, 80], [20, 90], [0, 90], [0, 80]] });
    const line = w.server.seed(shapeObject(w.ops.id, { geometry: { type: 'LineString', coordinates: [[10, 88], [12, 89.5]] } }));
    await select(browser, [line.id]);
    await drop(browser, [10, 90]);
    expect(stored(w.server, line).geometry).toEqual({ type: 'LineString', coordinates: [[10, 90], [12, 90]] });
  });
});

describe('criterion 27: nothing sent', () => {
  it('Escape while the drag only waits (null) sends nothing, and the drag is not armed again by itself', async () => {
    const { server, rect, browser, drags } = await ready();
    await select(browser, [rect.id]);
    await drop(browser, null);
    expect(updates(server)).toHaveLength(0);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([rect.id]);
  });

  it('after an Escape the drag stays off through later changes of the view and the panel', async () => {
    const { rect, browser, drags } = await ready();
    await select(browser, [rect.id]);
    await drop(browser, null);
    act(() => {
      browser.map.setViewport({ ...browser.map.viewport });
    });
    showShapesPanel(browser);
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([rect.id]);
  });

  it('after an Escape, selecting the shape again, the user switching a tool off, and the shape coming into view each arm the drag again', async () => {
    const { rect, browser, drags } = await ready();
    await select(browser, [rect.id]);
    await drop(browser, null);
    await select(browser, [rect.id]); // a click on the shape that is already selected
    expect(browser.map.runningInteraction).toBe('dragObject');
    await drop(browser, null);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await chooseTool('Circle'); // the user switches the tool off with its button
    expect(browser.map.runningInteraction).toBe('dragObject');
    await drop(browser, null);
    const home = browser.map.viewport;
    act(() => {
      browser.map.setViewport(AWAY);
    });
    act(() => {
      browser.map.setViewport(home);
    });
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags).toHaveLength(4);
  });

  it('after an Escape on a grabbed shape (the shape stays selected), another selection and then the shape arm the drag again', async () => {
    const { server, rect, circle, browser, drags } = await ready();
    await select(browser, [rect.id]);
    await drop(browser, null);
    expect(browser.map.runningInteraction).toBeNull();
    await select(browser, [circle.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await select(browser, [rect.id]);
    expect(drags).toEqual([rect.id, circle.id, rect.id]);
    expect(updates(server)).toHaveLength(0);
  });

  it('an abort sends nothing: another selection ends the drag, and a late drop of the ended one is not used', async () => {
    const { server, rect, circle, browser } = await ready();
    await select(browser, [rect.id]);
    await select(browser, [circle.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await drop(browser, [20.0686, 60.3293]); // this is the circle's drag
    expect(updates(server).map((r) => r.entityId)).toEqual([circle.id]);
  });

  it('a selection that is cleared ends the drag', async () => {
    const { server, rect, browser } = await ready();
    await select(browser, [rect.id]);
    await select(browser, []);
    expect(browser.map.runningInteraction).toBeNull();
    expect(updates(server)).toHaveLength(0);
  });
});

describe('criterion 28: when no drag is armed', () => {
  it('without the edit permission: no drag, no read, no subscription', async () => {
    const w = world();
    const browser = await openBrowser(w.server, { user: createFakeUser({ permissions: [] }) });
    const drags = recordDrags(browser);
    await select(browser, [w.rect.id]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([]);
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('with a tool on, and again when the user switches the tool off', async () => {
    const { rect, browser, drags } = await ready();
    await select(browser, [rect.id]);
    showShapesPanel(browser);
    await chooseTool('Circle');
    expect(browser.map.runningInteraction).toBe('draw:circle'); // the drag was ended, the drawing runs
    expect(drags.signals[0]?.aborted).toBe(true); // by the plugin, with the signal
    await chooseTool('Circle'); // switched off with the button
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags).toEqual([rect.id, rect.id]);
  });

  it('a tool that ends with null (Escape) does not arm the drag by its end alone', async () => {
    const { rect, circle, browser, drags } = await ready();
    await select(browser, [rect.id]);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await finishDrawing(browser, null); // Escape: the tool goes off
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([rect.id]);
    await select(browser, [circle.id]); // another own event arms it
    expect(browser.map.runningInteraction).toBe('dragObject');
  });

  it('a tool that fails to start does not leave the drag off', async () => {
    const { rect, browser, drags } = await ready();
    await select(browser, [rect.id]);
    browser.map.draw = () => Promise.reject(new Error('no drawing today'));
    showShapesPanel(browser);
    await chooseTool('Circle');
    expect(browser.ctx.notifications.at(-1)?.message).toContain('no drawing today');
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags).toEqual([rect.id, rect.id]);
  });

  it('a tool that goes off because the active layer is gone arms the drag again', async () => {
    const { rect, browser, drags } = await ready();
    await select(browser, [rect.id]);
    showShapesPanel(browser);
    await chooseTool('Circle');
    expect(browser.map.runningInteraction).toBe('draw:circle');
    act(() => {
      browser.map.activeLayer.set(null);
    });
    await settle();
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags).toEqual([rect.id, rect.id]);
  });

  it('a selection changed while a tool is on arms the drag when the tool ends, also with null', async () => {
    const { rect, circle, browser, drags } = await ready();
    await select(browser, [rect.id]);
    showShapesPanel(browser);
    await chooseTool('Circle');
    await select(browser, [circle.id]);
    expect(browser.map.runningInteraction).toBe('draw:circle');
    await finishDrawing(browser, null);
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags).toEqual([rect.id, circle.id]);
  });

  it('a reshape that ends with a result arms the drag again, one that ends with null does not', async () => {
    const { server, rect, browser, drags } = await ready();
    const panel = await editShape(browser, rect.id);
    expect(browser.map.runningInteraction).toBe('dragObject'); // the shape is selected by Edit
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    expect(drags.signals[0]?.aborted).toBe(true); // the plugin ended the drag with its signal
    await finishDrawing(browser, { type: 'Polygon', coordinates: [[[18.0, 59.3], [18.5, 59.3], [18.5, 59.4], [18.0, 59.4], [18.0, 59.3]]] });
    expect(updates(server)).toHaveLength(1);
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags).toEqual([rect.id, rect.id]);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    await finishDrawing(browser, null); // Escape
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([rect.id, rect.id]);
    expect(updates(server)).toHaveLength(1);
  });

  it('starting draw-symbols’ placing while a tool is on and a shape is selected does not end the placing', async () => {
    const { rect, circle, browser, drags } = await ready();
    await select(browser, [rect.id]);
    showShapesPanel(browser);
    await chooseTool('Circle');
    expect(browser.map.runningInteraction).toBe('draw:circle');
    let ended = false;
    const placing = browser.map.pickPoint().then((position) => {
      ended = true;
      return position;
    });
    await settle(); // the tool's drawing ended with null, the tool went off
    expect(browser.map.runningInteraction).toBe('pickPoint');
    expect(ended).toBe(false);
    expect(drags).toEqual([rect.id]); // the drag was not armed again
    // The plugin's own events bring it back, and then the last action wins.
    await select(browser, [circle.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await expect(placing).resolves.toBeNull();
  });

  it('starting draw-symbols’ placing during a reshape does not end the placing either', async () => {
    const { rect, browser, drags } = await ready();
    const panel = await editShape(browser, rect.id);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    let ended = false;
    void browser.map.pickPoint().then(() => {
      ended = true;
    });
    await settle();
    expect(browser.map.runningInteraction).toBe('pickPoint');
    expect(ended).toBe(false);
    expect(drags).toEqual([rect.id]);
  });

  it('during a reshape the drag waits', async () => {
    const { server, rect, browser } = await ready();
    const panel = await editShape(browser, rect.id);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Reshape' }));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    expect(updates(server)).toHaveLength(0);
  });

  it('for a shape out of the view, and when it comes into view', async () => {
    const { rect, browser, drags } = await ready();
    const home = browser.map.viewport;
    act(() => {
      browser.map.setViewport(AWAY);
    });
    await select(browser, [rect.id]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([]);
    // The shape is followed all the same (function 7), so that the mark and the live copy are right.
    expect(browser.connection.subscriptions).toHaveLength(2);
    act(() => {
      browser.map.setViewport(home);
    });
    expect(browser.map.runningInteraction).toBe('dragObject');
    // And it ends when the shape leaves the view again.
    act(() => {
      browser.map.setViewport(AWAY);
    });
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('for several selected shapes, and ends when a second one is added', async () => {
    const { rect, circle, browser, drags } = await ready();
    await select(browser, [rect.id, circle.id]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([]);
    await select(browser, [rect.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await select(browser, [rect.id, circle.id]);
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('for a selected object that is not a shape, which gets no subscription either', async () => {
    const { symbol, browser, drags } = await ready();
    await select(browser, [symbol.id]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([]);
    expect(browser.connection.subscriptions).toHaveLength(1);
  });

  it('for an object that cannot be read (deleted): no drag, no subscription', async () => {
    const { server, rect, browser, drags } = await ready();
    server.deleteSilently(rect.id);
    await select(browser, [rect.id]);
    expect(drags).toEqual([]);
    expect(browser.connection.subscriptions).toHaveLength(1);
  });

  it('a shape in a layer hidden in this browser: the map view answers null at once, and the drag is armed again when the layer is shown', async () => {
    const { ops, rect, browser, drags } = await ready();
    const original = browser.map.dragObject.bind(browser.map);
    browser.map.dragObject = (id, options) => {
      if (browser.map.isLayerVisible(ops.id)) return original(id, options);
      drags.push(id); // the real map view answers null at once for a hidden layer
      return Promise.resolve(null);
    };
    browser.map.setLayerVisible(ops.id, false);
    await select(browser, [rect.id]);
    expect(drags).toEqual([rect.id]);
    expect(browser.map.runningInteraction).toBeNull();
    await settle();
    expect(drags).toEqual([rect.id]); // no loop
    act(() => {
      browser.map.setLayerVisible(ops.id, true);
    });
    await settle();
    expect(drags).toEqual([rect.id, rect.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
  });

  it('a selection changed while the drop waits sends nothing, also when it is back to the same shape', async () => {
    const { server, rect, circle, browser } = await ready();
    const panel = await editShape(browser, rect.id);
    browser.connection.hold = true;
    await typeAndEnter(inputOf(panel, 'Name'), 'Renamed');
    await drop(browser, [20, 60.3]);
    await select(browser, [circle.id]);
    await select(browser, [rect.id]);
    act(() => {
      browser.connection.release();
    });
    await settle();
    await settle();
    expect(updates(server)).toHaveLength(1); // the rename only
    expect(stored(server, rect).geometry).toEqual(RECT);
  });

  it('a shape deleted by someone else ends the drag and leaves the selection', async () => {
    const { server, rect, browser } = await ready();
    await select(browser, [rect.id]);
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(stored(server, rect)));
    });
    await settle();
    expect(browser.map.selection.value).toEqual([]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(browser.ctx.notifications).toHaveLength(0); // the user only had it selected
  });
});

describe('criterion 30: one interaction at a time (the plugin)', () => {
  it('an interaction of another caller that runs before the read answers is replaced by the shape’s drag', async () => {
    const { rect, circle, browser, drags } = await ready();
    act(() => {
      browser.map.selection.set([rect.id]);
    });
    // draw-symbols' early drag starts at once, before this plugin's read answers.
    void browser.map.dragObject(circle.id);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await settle();
    expect(drags).toEqual([circle.id, rect.id]); // the early one (recorded by the wrapper), then ours
    expect(browser.map.runningInteraction).toBe('dragObject');
    await drop(browser, [20, 60.3]);
    expect(updates(browser.connection.server).map((r) => r.entityId)).toEqual([rect.id]);
  });

  it('an interaction another caller starts after it replaces the drag, which is armed again only when something of its own happens', async () => {
    const { server, rect, circle, browser, drags } = await ready();
    await select(browser, [rect.id]);
    const placing = browser.map.pickPoint(); // draw-symbols places a symbol
    expect(browser.map.runningInteraction).toBe('pickPoint');
    await settle();
    expect(drags).toEqual([rect.id]); // not armed again by itself
    expect(browser.map.runningInteraction).toBe('pickPoint');
    await select(browser, [circle.id]); // something of its own: another selection
    expect(drags).toEqual([rect.id, circle.id]);
    expect(browser.map.runningInteraction).toBe('dragObject'); // the shape's drag ended the placing: the last action wins
    await expect(placing).resolves.toBeNull();
    expect(updates(server)).toHaveLength(0);
  });
});

describe('the selected shape is read by id (function 16)', () => {
  it('a selection that exists when the plugin starts is read, followed and armed', async () => {
    const w = world();
    const browser = await openBrowser(w.server, { selected: [w.rect.id] });
    await settle();
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(browser.connection.subscriptions.filter((s) => typeof s.options.area === 'object')).toHaveLength(1);
  });

  it('an answer for an object that is no longer the selected one is ignored', async () => {
    const { rect, circle, browser, drags } = await ready();
    const read = browser.ctx.objects.get.bind(browser.ctx.objects);
    let answerRect: (() => void) | undefined;
    browser.ctx.objects.get = (ids) => {
      if (ids[0] !== rect.id) return read(ids);
      return new Promise((resolve) => {
        answerRect = () => {
          resolve(read(ids));
        };
      });
    };
    act(() => {
      browser.map.selection.set([rect.id]);
    });
    await select(browser, [circle.id]);
    act(() => {
      answerRect?.();
    });
    await settle();
    expect(drags).toEqual([circle.id]);
    expect(browser.connection.subscriptions.filter((s) => typeof s.options.area === 'object')).toHaveLength(1);
    const area = browser.connection.subscriptions.find((s) => typeof s.options.area === 'object')?.options.area;
    if (typeof area !== 'object') throw new Error('no fixed area');
    expect(area.inside).toEqual(centroidOf(circle.geometry));
  });

  it('a read that fails arms nothing and tells the user nothing', async () => {
    const { rect, browser, drags } = await ready();
    browser.connection.failReads = true;
    await select(browser, [rect.id]);
    expect(drags).toEqual([]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(browser.connection.subscriptions).toHaveLength(1);
    expect(browser.ctx.notifications).toHaveLength(0);
  });
});

describe('criterion 18, from T-066: the selected shape is followed', () => {
  const areas = (browser: Browser) => browser.connection.subscriptions.filter((s) => typeof s.options.area === 'object');

  it('selecting one shape adds the fixed-area subscription after reading it by id, and another selection ends it', async () => {
    const { rect, circle, symbol, browser } = await ready();
    expect(areas(browser)).toHaveLength(0);
    await select(browser, [rect.id]);
    expect(areas(browser)).toHaveLength(1);
    const area = areas(browser)[0]?.options.area;
    if (typeof area !== 'object') throw new Error('no fixed area');
    expect(area.inside).toEqual(centroidOf(rect.geometry));
    await select(browser, [circle.id]);
    expect(areas(browser)).toHaveLength(1); // one at a time: the circle's
    await select(browser, [symbol.id]);
    expect(areas(browser)).toHaveLength(0);
    await select(browser, [rect.id]);
    await select(browser, []);
    expect(areas(browser)).toHaveLength(0);
  });

  it('opening the edit panel for the selected shape adds no second subscription, and closing the panel keeps the one for the selection', async () => {
    const { rect, browser } = await ready();
    await select(browser, [rect.id]);
    const panel = await editShape(browser, rect.id);
    expect(areas(browser)).toHaveLength(1);
    fireEvent.click(within(panel.container).getByRole('button', { name: 'Close' }));
    await settle();
    expect(areas(browser)).toHaveLength(0); // Close also takes the shape out of the selection
  });

  it('a shape moved away by someone else renews the area round its new place, also when only selected', async () => {
    const { server, rect, browser } = await ready();
    await select(browser, [rect.id]);
    const faraway: Geometry = { type: 'Polygon', coordinates: [[[19.0, 61.3], [19.3, 61.3], [19.3, 61.4], [19.0, 61.4], [19.0, 61.3]]] };
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(rect, { ...coreOf(rect), geometry: faraway }));
    });
    await settle();
    const area = areas(browser)[0]?.options.area;
    if (typeof area !== 'object') throw new Error('no fixed area');
    expect(area.inside).toEqual(centroidOf(faraway));
    expect(areas(browser)).toHaveLength(1);
  });
});
