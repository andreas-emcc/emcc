// Brief function 7; acceptance criterion 9: dragging the selected graphic with the map view's
// `dragObject`, as draw-shapes does for shapes (its function 16).
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChangeRequest, Geometry, MapObject, Position, Uuid, Viewport } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import { coreOf } from '../src/content.ts';
import { AWAY, buttonOf, clickTool, chooseGraphic, editGraphic, inputOf, openBrowser, settle, showGraphicsPanel, typeAndEnter } from './harness.tsx';
import type { Browser } from './harness.tsx';
import { AXIS_SIDC, FAN_SIDC, FakeServer, graphicObject, layer } from './fakeServer.ts';

const AXIS_POINTS: Position[] = [[18.07, 59.33], [17.4, 58.95], [16.8, 58.7], [18.5, 58.8]];
const LINE_POINTS: Position[] = [[17.5, 59.1], [18.5, 59.6], [19.25, 59.2]];
const RING: Position[] = [[18.0, 59.3], [18.3, 59.3], [18.3, 59.4], [18.0, 59.4], [18.0, 59.3]];

function world() {
  const ops = layer('Operations', 1);
  const server = new FakeServer([ops], ['core.general']);
  const line = server.seed(graphicObject(ops.id, { geometry: { type: 'LineString', coordinates: LINE_POINTS }, properties: { name: 'Dragged' }, extensions: { other: { x: 1 } } }));
  const other = server.seed(graphicObject(ops.id, { geometry: { type: 'LineString', coordinates: AXIS_POINTS }, symbol: { standard: 'APP-6D', sidc: AXIS_SIDC } }));
  const symbol = server.seed({ ...graphicObject(ops.id), type: 'core.symbol', geometry: { type: 'Point', coordinates: [18.2, 59.2] }, symbol: { standard: 'APP-6D', sidc: '10031000001211000000' } });
  return { server, ops, line, other, symbol };
}

/** What the plugin asked the map view to drag, in order (the fake map view's `dragObject` wrapped). */
function recordDrags(browser: Browser): Uuid[] {
  const ids: Uuid[] = [];
  const original = browser.map.dragObject.bind(browser.map);
  browser.map.dragObject = (id, options) => {
    ids.push(id);
    return original(id, options);
  };
  return ids;
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
const drop = async (browser: Browser, position: Position | null) => {
  act(() => {
    browser.map.completeInteraction(position);
  });
  await settle();
};
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

describe('criterion 9: dragging a graphic moves its control points', () => {
  const graphics: readonly { readonly name: string; readonly geometry: Geometry; readonly expected: Geometry; readonly drop: Position; readonly sidc?: string }[] = [
    { name: 'a line', geometry: { type: 'LineString', coordinates: LINE_POINTS }, drop: [19.5, 60.1], expected: { type: 'LineString', coordinates: LINE_POINTS.map(plus) } },
    { name: 'an arrow', geometry: { type: 'LineString', coordinates: AXIS_POINTS }, drop: [20.07, 60.33], expected: { type: 'LineString', coordinates: AXIS_POINTS.map(plus) }, sidc: AXIS_SIDC },
    { name: 'an area', geometry: { type: 'Polygon', coordinates: [RING] }, drop: [20, 60.3], expected: { type: 'Polygon', coordinates: [RING.map(plus)] } },
    { name: 'a range fan', geometry: { type: 'MultiPoint', coordinates: [[18.0686, 59.3293]] }, drop: [20.0686, 60.3293], expected: { type: 'MultiPoint', coordinates: [[20.0686, 60.3293]] }, sidc: FAN_SIDC },
    {
      name: 'a set of points, with an altitude',
      geometry: { type: 'MultiPoint', coordinates: [[17.6, 59.1, 40], [18.4, 59.5]] },
      drop: [19.6, 60.1],
      expected: { type: 'MultiPoint', coordinates: [[19.6, 60.1, 40], [20.4, 60.5]] },
    },
  ];

  it.each(graphics)('$name: +2 degrees of longitude and +1 of latitude gives one update with every control point moved by exactly that', async ({ geometry, expected, drop: at, sidc }) => {
    const { server, ops, browser, drags } = await ready();
    const graphic = server.seed(
      graphicObject(ops.id, {
        geometry,
        ...(sidc === undefined ? {} : { symbol: { standard: 'APP-6D', sidc, ...(sidc === FAN_SIDC ? { modifiers: { distances: [4000], azimuths: [10, 80] } } : {}) } }),
        properties: { name: 'Dragged' },
        extensions: { other: { x: 1 } },
      }),
    );
    await select(browser, [graphic.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags).toEqual([graphic.id]);

    await drop(browser, at);
    expect(updates(server)).toHaveLength(1);
    expect(updates(server)[0]).toMatchObject({ entityType: 'object', operation: 'update', entityId: graphic.id, baseVersion: 1, source: { plugin: 'draw-tactical' } });
    const now = stored(server, graphic);
    expect(now.version).toBe(2);
    expect(now.geometry).toEqual(expected);
    // Everything else as it was: the complete core content (the symbol and its amplifiers too), and the other plugin's namespace untouched.
    expect(coreOf({ ...now, geometry: graphic.geometry })).toEqual(coreOf(graphic));
    expect(now.extensions?.['other']).toEqual({ x: 1 });
  });

  it('is armed again at once after a drop, and the next drag starts from the newest state', async () => {
    const { server, line, browser, drags } = await ready();
    await select(browser, [line.id]);
    await drop(browser, [19.5, 60.1]); // +2, +1
    expect(drags).toEqual([line.id, line.id]);
    expect(browser.map.runningInteraction).toBe('dragObject');
    await drop(browser, [20.5, 60.1]); // from the newest first position [19.5, 60.1]: +1, 0
    expect(updates(server)).toHaveLength(2);
    expect(updates(server)[1]).toMatchObject({ baseVersion: 2 });
    expect(stored(server, line).geometry).toEqual({ type: 'LineString', coordinates: LINE_POINTS.map((p) => [p[0] + 3, p[1] + 1]) });
  });

  it('a drop that leaves the graphic where it was sends nothing; a rejection is shown and nothing moves', async () => {
    const { server, line, browser } = await ready();
    await select(browser, [line.id]);
    await drop(browser, [17.5, 59.1]);
    expect(updates(server)).toHaveLength(0);
    browser.connection.rejectNext.push('PERMISSION_DENIED');
    await drop(browser, [19.5, 60.1]);
    expect(browser.ctx.notifications.at(-1)?.message).toContain('PERMISSION_DENIED');
    expect(stored(server, line).geometry).toEqual({ type: 'LineString', coordinates: LINE_POINTS });
  });

  it('an update that is still under way is sent first, and the drop is based on its result', async () => {
    const { server, line, browser } = await ready();
    const panel = await editGraphic(browser, line.id);
    browser.connection.hold = true;
    await typeAndEnter(inputOf(panel, 'Name'), 'Renamed');
    await drop(browser, [19.5, 60.1]);
    expect(updates(server)).toHaveLength(1); // the rename is under way, the drop waits behind it
    act(() => {
      browser.connection.release();
    });
    await settle();
    await settle();
    expect(updates(server)).toHaveLength(2);
    expect(updates(server)[1]).toMatchObject({ baseVersion: 2 });
    expect(stored(server, line).properties).toMatchObject({ name: 'Renamed' });
    expect(stored(server, line).geometry).toEqual({ type: 'LineString', coordinates: LINE_POINTS.map(plus) });
  });

  it('a drag across the antimeridian gives longitudes within -180 to 180, and one past 90 degrees of latitude clamps', async () => {
    const w = world();
    const browser = await openBrowser(w.server);
    const around: Viewport = { center: [180, 60], resolution: 4891.97, projection: 'EPSG:3857', visibleArea: [[170, 50], [-170, 50], [-170, 70], [170, 70], [170, 50]] };
    browser.map.setViewport(around);
    const line = w.server.seed(graphicObject(w.ops.id, { geometry: { type: 'LineString', coordinates: [[178, 60], [179.5, 61]] } }));
    await select(browser, [line.id]);
    await drop(browser, [-178, 60]); // from 178 to -178: the difference is -356, which is +4 modulo 360
    const geometry = stored(w.server, line).geometry;
    if (geometry.type !== 'LineString') throw new Error('not a line');
    expect(geometry.coordinates.every((p) => Math.abs(p[0]) <= 180)).toBe(true);
    expect(geometry.coordinates[0]?.[0]).toBeCloseTo(-178, 9);
    expect(geometry.coordinates[1]?.[0]).toBeCloseTo(-176.5, 9);
    expect(geometry.coordinates[1]?.[1]).toBeCloseTo(61, 9);

    browser.map.setViewport({ center: [10, 85], resolution: 4891.97, projection: 'EPSG:3857', visibleArea: [[0, 80], [20, 80], [20, 90], [0, 90], [0, 80]] });
    const north = w.server.seed(graphicObject(w.ops.id, { geometry: { type: 'LineString', coordinates: [[10, 88], [12, 89.5]] } }));
    await select(browser, [north.id]);
    await drop(browser, [10, 90]);
    expect(stored(w.server, north).geometry).toEqual({ type: 'LineString', coordinates: [[10, 90], [12, 90]] });
  });
});

describe('Escape and aborts send nothing', () => {
  it('a drag that ends with null sends nothing and is not armed again by itself', async () => {
    const { server, line, browser, drags } = await ready();
    await select(browser, [line.id]);
    await drop(browser, null);
    expect(updates(server)).toHaveLength(0);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([line.id]);
    await select(browser, [line.id]); // something of its own: arms it again
    expect(browser.map.runningInteraction).toBe('dragObject');
  });

  it('another selection ends the drag, and a cleared selection too', async () => {
    const { server, line, other, browser } = await ready();
    await select(browser, [line.id]);
    await select(browser, [other.id]);
    await drop(browser, [20.07, 60.33]); // this is the other graphic's drag
    expect(updates(server).map((r) => r.entityId)).toEqual([other.id]);
    await select(browser, []);
    expect(browser.map.runningInteraction).toBeNull();
  });
});

describe('when no drag is armed', () => {
  it('without the edit permission: no drag, no read, no subscription', async () => {
    const w = world();
    const browser = await openBrowser(w.server, { user: createFakeUser({ permissions: [] }) });
    const drags = recordDrags(browser);
    await select(browser, [w.line.id]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([]);
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('with the tool on, and again when the user switches the tool off', async () => {
    const { line, browser, drags } = await ready();
    await showGraphicsPanel(browser);
    await select(browser, [line.id]);
    await chooseGraphic('Phase Line');
    await clickTool(); // the placing replaces the drag (one interaction at a time)
    expect(browser.map.runningInteraction).toBe('draw:line');
    await clickTool(); // the user switches it off
    expect(browser.map.runningInteraction).toBe('dragObject');
    expect(drags.at(-1)).toBe(line.id);
  });

  it('during a reshape, and for a graphic outside the map view', async () => {
    const { line, browser } = await ready();
    const panel = await editGraphic(browser, line.id);
    fireEvent.click(buttonOf(panel, 'Reshape'));
    await settle();
    expect(browser.map.runningInteraction).toBe('edit');
    act(() => {
      browser.map.completeDrawing(null);
    });
    await settle();
    act(() => {
      browser.map.setViewport(AWAY);
    });
    await settle();
    expect(browser.map.runningInteraction).toBeNull();
  });

  it('for several selected graphics, and for a selected object that is not a graphic (no subscription either)', async () => {
    const { line, other, symbol, browser, drags } = await ready();
    await select(browser, [line.id, other.id]);
    expect(browser.map.runningInteraction).toBeNull();
    await select(browser, [symbol.id]);
    expect(browser.map.runningInteraction).toBeNull();
    expect(drags).toEqual([]);
    expect(browser.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });
});
