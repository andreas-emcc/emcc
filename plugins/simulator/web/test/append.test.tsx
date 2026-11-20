// "Append" on a route (brief function 49, criterion 72; T-176, owner Q61 A; SDK 1.6.0 part B): the
// map view continues the route from its last point, and the route editor sends one update whose new
// points copy the last point's entry.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Layer, LineString, MapObject } from '@emc2/plugin-sdk';
import { appendPoints } from '../src/definition.ts';
import { EDIT_HINT } from '../src/permissions.ts';
import { SIMULATION } from '../src/picture.ts';
import { activated, groups, lastData, lastExtension, layer, panel, route, ROUTE_A, routeInfo, settled, SIM_LAYER, symbol, TRACK_1, VIEW } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
});

const HIDE = { kind: 'hide' };
/** The route's own two points, then two the user clicks (latitude ≠ longitude). */
const OWN: LineString['coordinates'] = [[18.0, 59.3], [18.2, 59.4]];
const ADDED: LineString['coordinates'] = [[18.4, 59.5], [18.6, 59.45]];
const LONGER: LineString = { type: 'LineString', coordinates: [...OWN, ...ADDED] };
/** What the last point's entry becomes on a new point: its speed and altitude, no events, no time. */
const COPY = { speedKind: 'instant', speed: 8.33, altitudeKind: 'instant', altitude: 100 };

async function editing(options: { readonly objects?: boolean; readonly locked?: boolean; readonly permissions?: readonly string[] } = {}): Promise<Rig> {
  const rig = await activated(options.permissions === undefined ? {} : { permissions: options.permissions });
  const routeA: MapObject = route(ROUTE_A, 'Alpha', {
    ...(options.objects === true ? { groups: groups(TRACK_1), edit: { number: 4, objects: 'move' } } : {}),
    points: [{ speed: 5, events: [HIDE] }, { speed: 8.33, altitude: 100, events: [HIDE] }],
  });
  const simulation: Layer = { ...layer(SIM_LAYER, SIMULATION), ...(options.locked === true ? { locked: true } : {}) };
  const objects = [routeA, symbol(TRACK_1, SIM_LAYER)];
  rig.ctx.live.snapshot({ layers: [simulation], objects });
  rig.ctx.setServerObjects(objects);
  rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha') });
  await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
  const Editor = panel(rig.ctx, 'route-editor');
  render(<Editor />);
  await screen.findByRole('region', { name: 'Point 1' });
  return rig;
}

function appendButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Append' });
}

describe('"Append" in the route editor (criterion 72)', () => {
  it('continues the route from its last point and sends one update: its points followed by the new ones, which copy the last point\'s entry', async () => {
    const { ctx, map } = await editing();
    fireEvent.click(appendButton());
    expect(map.runningInteraction).toBe('append');
    expect(map.appendCalls).toEqual([{ id: ROUTE_A, style: { strokeDash: 'dash', pointMarkers: 'circle' } }]);
    await act(async () => {
      map.completeDrawing(LONGER);
      await settled();
    });
    expect(ctx.submitted).toHaveLength(1);
    expect(lastData(ctx).geometry).toEqual(LONGER);
    const points = lastExtension(ctx)['points'];
    expect(points).toEqual([{ speed: 5, events: [HIDE] }, { speed: 8.33, altitude: 100, events: [HIDE] }, COPY, COPY]);
    // The route stays valid: one entry per point, and no time to break their order.
    expect(Array.isArray(points) ? points.length : 0).toBe(LONGER.coordinates.length);
    expect(lastData(ctx).extensions?.['other']).toEqual({ kept: true });
  });

  it('asks move-or-disconnect when objects are on the route (function 9), then sends the answer with the points', async () => {
    const { ctx, map } = await editing({ objects: true });
    fireEvent.click(appendButton());
    await act(async () => {
      map.completeDrawing(LONGER);
      await settled();
    });
    expect(screen.getByText(/2 points were added at the end\. The route has objects on it\./)).toBeDefined();
    expect(ctx.submitted).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move them with it' }));
      await settled();
    });
    expect(lastData(ctx).geometry).toEqual(LONGER);
    expect(lastExtension(ctx)['edit']).toEqual({ number: 5, objects: 'move' });
  });

  it('sends nothing when cancelled or with no point added', async () => {
    const { ctx, map } = await editing();
    for (const end of [null, { type: 'LineString', coordinates: OWN } as LineString]) {
      fireEvent.click(appendButton());
      await act(async () => {
        map.completeDrawing(end);
        await settled();
      });
    }
    expect(ctx.submitted).toEqual([]);
  });

  it('is off with its title on a locked layer and without the right to change the simulation, as Reshape', async () => {
    await editing({ locked: true });
    expect(appendButton()).toHaveProperty('disabled', true);
    expect(appendButton().getAttribute('title')).toBe('Layer "Simulation layer" is locked');
    cleanup();
    await editing({ permissions: [VIEW] });
    expect(appendButton()).toHaveProperty('disabled', true);
    expect(appendButton().getAttribute('title')).toBe(EDIT_HINT);
  });

  it('appendPoints: the new points take the last point\'s entry; with only a time there, the computed speed', () => {
    const line: LineString = { type: 'LineString', coordinates: OWN };
    const timed = appendPoints(line, { points: [{ speed: 5 }, { time: { seconds: 600 } }] }, [[18.4, 59.5]], 12.5);
    expect(timed.line.coordinates).toEqual([...OWN, [18.4, 59.5]]);
    expect(timed.ext['points']).toEqual([{ speed: 5 }, { time: { seconds: 600 } }, { speedKind: 'instant', speed: 12.5, altitudeKind: 'instant' }]);
  });
});
