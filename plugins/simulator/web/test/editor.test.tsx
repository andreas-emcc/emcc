// The route editor (brief functions 4 to 9 and 22; Q10, Q13, A35 to A47): criteria 2, 5, 6, 7 and
// 25, as far as the web part does them.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import type { LineString, MapObject } from '@emc2/plugin-sdk';
import { NEW_ROUTE_SPEED } from '../src/definition.ts';
import { NO_SIMULATION_LAYER, ROUTE_STYLE } from '../src/editor.ts';
import { EDIT_HINT } from '../src/permissions.ts';
import { SIMULATION } from '../src/picture.ts';
import {
  activated, feedPicture, groups, lastData, lastExtension, panel, route, ROUTE_A, ROUTE_B, routeInfo, settled, SIM_LAYER, symbol, TRACK_1, VIEW, VIEW_LAYER,
} from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const THREE: LineString = { type: 'LineString', coordinates: [[18.0, 59.3], [18.2, 59.4], [18.5, 59.6]] };

function computed(version: number) {
  return routeInfo(ROUTE_A, 'Alpha', {
    version,
    points: [
      { legMetres: 0, distanceMetres: 0, arrivalSeconds: 0, speed: 10, speedFrom: 'typed' },
      { legMetres: 12_000, distanceMetres: 12_000, arrivalSeconds: 1200, speed: 10, speedFrom: 'typed' },
    ],
    problems: [{ point: 1, message: 'a step to 0 is only allowed at the last point' }],
  });
}

/** The editor open on route A (with `objects` on it), its panel rendered. */
async function editing(options: { readonly objects?: boolean; readonly route?: MapObject; readonly permissions?: readonly string[]; readonly version?: number } = {}): Promise<Rig> {
  const rig = await activated(options.permissions === undefined ? {} : { permissions: options.permissions });
  const routeA = options.route ?? route(ROUTE_A, 'Alpha', options.objects === true ? { groups: groups(TRACK_1), edit: { number: 4, objects: 'move' } } : {});
  feedPicture(rig.ctx, [routeA, route(ROUTE_B, 'Route 2'), symbol(TRACK_1, SIM_LAYER)]);
  rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: computed(options.version ?? routeA.version) });
  await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
  const Editor = panel(rig.ctx, 'route-editor');
  render(<Editor />);
  await screen.findByRole('region', { name: 'Point 1' });
  return rig;
}

/** The one-point pane on point `n`, stepped to with "Next point" (A58). */
function point(n: number): HTMLElement {
  for (let i = 0; i < 1000; i++) {
    const pane = screen.getByRole('region', { name: /^Point \d+$/ });
    if (pane.getAttribute('aria-label') === `Point ${String(n)}`) return pane;
    fireEvent.click(within(pane).getByRole('button', { name: 'Next point' }));
  }
  throw new Error(`no point ${String(n)}`);
}

async function commit(field: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(field, { target: { value: text } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);
    await settled();
  });
}

describe('"New route" (A35, A36)', () => {
  it('draws a line into the active Simulation layer and creates the route', async () => {
    const rig = await activated();
    feedPicture(rig.ctx, [route(ROUTE_B, 'Route 2')]);
    act(() => {
      rig.map.activeLayer.set(SIM_LAYER);
    });
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    expect(rig.map.runningInteraction).toBe('draw:line');
    expect(rig.map.drawCalls.at(-1)?.style).toEqual(ROUTE_STYLE);
    expect(rig.ctx.addedPanels.some((p) => p.panel.id === 'route-editor')).toBe(true);
    await act(async () => {
      rig.map.completeDrawing(THREE);
      await settled();
    });
    const request = rig.ctx.submitted.at(-1);
    expect(request).toMatchObject({ entityType: 'object', operation: 'create' });
    const data = lastData(rig.ctx);
    expect(data).toMatchObject({
      type: 'core.shape', dataType: 'simulator.route', dataSource: 'manual', layerId: SIM_LAYER, geometry: THREE,
      style: { strokeDash: 'dash', pointMarkers: 'circle' }, properties: { name: 'Route 3' }, label: rig.ctx.defaultLabel,
    });
    expect(lastExtension(rig.ctx)).toEqual({ points: Array.from({ length: 3 }, () => ({ speedKind: 'instant', speed: NEW_ROUTE_SPEED, altitudeKind: 'instant' })), end: 'stop' });
  });

  it('needs a Simulation layer as the active layer', async () => {
    const rig = await activated();
    feedPicture(rig.ctx, []);
    act(() => {
      rig.map.activeLayer.set(VIEW_LAYER);
    });
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    const button = screen.getByRole('button', { name: 'New route' });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('title')).toBe(NO_SIMULATION_LAYER);
  });

  it('follows the active layer', async () => {
    const rig = await activated();
    feedPicture(rig.ctx, []);
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    expect(screen.getByRole('button', { name: 'New route' })).toHaveProperty('disabled', true);
    act(() => {
      rig.map.activeLayer.set(SIM_LAYER);
    });
    expect(screen.getByRole('button', { name: 'New route' })).toHaveProperty('disabled', false);
  });

  it('closes the editor when the drawing is cancelled, and sends nothing', async () => {
    const rig = await activated();
    feedPicture(rig.ctx, []);
    act(() => {
      rig.map.activeLayer.set(SIM_LAYER);
    });
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    await act(async () => {
      rig.map.completeDrawing(null);
      await settled();
    });
    expect(rig.ctx.submitted).toEqual([]);
    expect(rig.ctx.addedPanels.some((p) => p.panel.id === 'route-editor')).toBe(false);
  });
});

describe('the values (functions 5, 6 and 8; A37 to A39)', () => {
  it("saves a typed speed in the user's unit as m/s, removing the point's time (criterion 6)", async () => {
    const { ctx } = await editing({ route: route(ROUTE_A, 'Alpha', { points: [{ speed: 8.33 }, { speed: 8.33, time: { seconds: 60, from: 'previous', unit: 'mps' } }] }) });
    await commit(within(point(2)).getByLabelText('Speed (km/h)'), '36');
    expect(ctx.submitted).toHaveLength(1); // Enter, then leaving the field, sends it once
    expect(lastExtension(ctx)['points']).toEqual([{ speed: 8.33 }, { speed: 10 }]);
    expect(lastData(ctx).extensions?.['other']).toEqual({ kept: true });
  });

  it('refuses a speed above 2 000 m/s in any unit, and sends nothing (criterion 25)', async () => {
    const { ctx } = await editing();
    act(() => {
      fireEvent.change(screen.getByLabelText('Speed unit'), { target: { value: 'kn' } });
      fireEvent.change(screen.getByLabelText('Altitude unit'), { target: { value: 'm' } });
    });
    await commit(within(point(1)).getByLabelText('Speed (kn)'), '4000');
    expect(await screen.findByText('A speed must be from 0 to 3887.7 kn')).toBeDefined();
    expect(ctx.submitted).toEqual([]);
  });

  it('saves a typed time with its unit for rounding; at a step point the speed stays (criterion 5, Q2)', async () => {
    const { ctx } = await editing();
    await commit(within(point(2)).getByLabelText('Time (h:mm:ss)'), '2:00');
    expect((lastExtension(ctx)['points'] as unknown[])[1]).toEqual({ speed: 8.33, time: { seconds: 120, from: 'previous', unit: 'kmh' } });
  });

  it('replaces the speed with a typed time at a ramp point (A38)', async () => {
    const { ctx } = await editing({ route: route(ROUTE_A, 'Alpha', { points: [{ speed: 8.33 }, { speedKind: 'ramp', speed: 8.33 }] }) });
    await commit(within(point(2)).getByLabelText('Time (h:mm:ss)'), '90');
    expect((lastExtension(ctx)['points'] as unknown[])[1]).toEqual({ speedKind: 'ramp', time: { seconds: 90, from: 'previous', unit: 'kmh' } });
  });

  it('counts a typed time from the start when chosen', async () => {
    const { ctx } = await editing({ route: route(ROUTE_A, 'Alpha', { points: [{ speed: 8.33 }, { speed: 8.33, time: { seconds: 60, from: 'previous', unit: 'kmh' } }] }) });
    const second = point(2);
    await act(async () => {
      fireEvent.change(within(second).getByLabelText('Counted'), { target: { value: 'start' } });
      await settled();
    });
    expect((lastExtension(ctx)['points'] as unknown[])[1]).toEqual({ speed: 8.33, time: { seconds: 60, from: 'start', unit: 'kmh' } });
  });

  it('refuses a time that is not one', async () => {
    const { ctx } = await editing();
    await commit(within(point(2)).getByLabelText('Time (h:mm:ss)'), 'soon');
    expect(screen.getByText('Type a time as h:mm:ss, m:ss or seconds')).toBeDefined();
    expect(ctx.submitted).toEqual([]);
  });

  it('saves an altitude in feet as metres, refuses one outside −1 000 to 30 000 m, and an empty one keeps the object\'s own (criterion 6, 25)', async () => {
    const { ctx } = await editing();
    act(() => {
      fireEvent.change(screen.getByLabelText('Speed unit'), { target: { value: 'kmh' } });
      fireEvent.change(screen.getByLabelText('Altitude unit'), { target: { value: 'ft' } });
    });
    await commit(within(point(1)).getByLabelText('Altitude (ft)'), '1000');
    expect((lastExtension(ctx)['points'] as { altitude?: number }[])[0]?.altitude).toBeCloseTo(304.8, 6);
    await commit(within(point(2)).getByLabelText('Altitude (ft)'), '-5000');
    expect(screen.getByText('An altitude must be from -3280.8 to 98425.2 ft')).toBeDefined();
    expect(ctx.submitted).toHaveLength(1);
  });

  it('sets step or ramp, labelled as Q3 says', async () => {
    const { ctx } = await editing();
    const select = within(point(2)).getByLabelText('Altitude change');
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Step at this point', 'Ramp over the leg into this point']);
    await act(async () => {
      fireEvent.change(select, { target: { value: 'ramp' } });
      await settled();
    });
    expect((lastExtension(ctx)['points'] as unknown[])[1]).toEqual({ speed: 8.33, altitudeKind: 'ramp' });
  });

  it('renames the route (A47) and sets its end behaviour', async () => {
    const { ctx } = await editing();
    await commit(screen.getByLabelText('Name'), 'Northern leg');
    expect(lastData(ctx).properties).toEqual({ name: 'Northern leg' });
    await act(async () => {
      fireEvent.change(screen.getAllByLabelText('At the end')[0] as HTMLElement, { target: { value: 'restart' } });
      await settled();
    });
    expect(lastExtension(ctx)['end']).toBe('restart');
  });

  it('never asks move-or-disconnect for a value edit, even with objects on the route (Q10)', async () => {
    const { ctx } = await editing({ objects: true });
    await commit(within(point(1)).getByLabelText('Speed (km/h)'), '20');
    expect(screen.queryByText(/The route has objects on it/)).toBeNull();
    expect(lastExtension(ctx)['edit']).toEqual({ number: 4, objects: 'move' });
  });
});

describe('the computed values (function 6, criterion 2)', () => {
  it("shows the server part's values for the version shown, and the point's problems", async () => {
    await editing();
    await vi.waitFor(() => {
      expect(within(point(2)).getByText(/leg 12,000 m · arrives 0:20:00/)).toBeDefined();
    });
    expect(within(point(2)).getByLabelText<HTMLInputElement>('Time (h:mm:ss)').value).toBe('0:20:00');
    expect(within(point(2)).getAllByText('computed')).toHaveLength(1);
    expect(within(point(2)).getByText('a step to 0 is only allowed at the last point')).toBeDefined();
  });

  it('waits for the values of the version shown', async () => {
    await editing({ version: 2 });
    expect(await screen.findByText("Waiting for the server's values for this version…")).toBeDefined();
    expect(within(point(2)).queryByText(/leg 12,000 m/)).toBeNull();
  });
});

describe('changing the line (functions 4 and 9; Q10, Q13, A40, A41)', () => {
  it('reshapes a route without objects at once', async () => {
    const { ctx, map } = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Reshape' }));
    expect(map.editCalls.at(-1)?.id).toBe(ROUTE_A);
    const moved: LineString = { type: 'LineString', coordinates: [[18.05, 59.31], [18.25, 59.42]] };
    await act(async () => {
      map.completeDrawing(moved);
      await settled();
    });
    expect(lastData(ctx).geometry).toEqual(moved);
    expect(lastExtension(ctx)['edit']).toBeUndefined();
  });

  it('asks move-or-disconnect for a route with objects, and sends the answer with a new edit number (criterion 7)', async () => {
    const { ctx, map } = await editing({ objects: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reshape' }));
    await act(async () => {
      map.completeDrawing({ type: 'LineString', coordinates: [[18.05, 59.31], [18.25, 59.42]] });
      await settled();
    });
    expect(screen.getByText(/The route was reshaped\. The route has objects on it\./)).toBeDefined();
    expect(ctx.submitted).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Disconnect them' }));
      await settled();
    });
    expect(lastExtension(ctx)['edit']).toEqual({ number: 5, objects: 'disconnect' });
  });

  it('moves the objects with it, or undoes the change', async () => {
    const { ctx, map } = await editing({ objects: true });
    for (const [answer, sent] of [['Undo the change', 0], ['Move them with it', 1]] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Reshape' }));
      await act(async () => {
        map.completeDrawing({ type: 'LineString', coordinates: [[18.05, 59.31], [18.25, 59.42]] });
        await settled();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: answer }));
        await settled();
      });
      expect(ctx.submitted).toHaveLength(sent);
    }
    expect(lastExtension(ctx)['edit']).toEqual({ number: 5, objects: 'move' });
  });

  it('inserts a point where the user clicks, copying the previous point\'s values (Q13)', async () => {
    const { ctx, map } = await editing({ route: route(ROUTE_A, 'Alpha', { points: [{ speed: 5, altitude: 100, events: [{ kind: 'hide' }] }, { speed: 8.33 }] }) });
    fireEvent.click(within(point(1)).getByRole('button', { name: 'Insert point after point 1' }));
    expect(map.runningInteraction).toBe('pickPoint');
    await act(async () => {
      map.completeInteraction([18.1, 59.35]);
      await settled();
    });
    expect(lastData(ctx).geometry).toEqual({ type: 'LineString', coordinates: [[18.0, 59.3], [18.1, 59.35], [18.2, 59.4]] });
    expect(lastExtension(ctx)['points']).toEqual([
      { speed: 5, altitude: 100, events: [{ kind: 'hide' }] },
      { speedKind: 'instant', speed: 5, altitudeKind: 'instant', altitude: 100 },
      { speed: 8.33 },
    ]);
    // The editor shows the route as the update left it: three points now.
    expect(within(point(3)).getByRole('button', { name: 'Add point at the end' })).toBeDefined();
  });

  it('deletes a point with its entry, but never below two points (A41)', async () => {
    const three = { ...route(ROUTE_A, 'Alpha', { points: [{ speed: 1 }, { speed: 2 }, { speed: 3 }] }), geometry: THREE };
    const { ctx } = await editing({ route: three });
    const second = point(2);
    await act(async () => {
      fireEvent.click(within(second).getByRole('button', { name: 'Delete point 2' }));
      await settled();
    });
    expect(lastData(ctx).geometry).toEqual({ type: 'LineString', coordinates: [[18.0, 59.3], [18.5, 59.6]] });
    expect(lastExtension(ctx)['points']).toEqual([{ speed: 1 }, { speed: 3 }]);
    cleanup();
    await editing();
    expect(within(point(1)).getByRole('button', { name: 'Delete point 1' })).toHaveProperty('disabled', true);
  });

  it('says so when the route is not drawn on the map', async () => {
    const { map } = await editing();
    map.setNotDrawn([ROUTE_A]);
    fireEvent.click(screen.getByRole('button', { name: 'Reshape' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The route is not drawn on the map here');
  });
});

describe('the review of C2', () => {
  it('reads the computed values once a second while the editor is open, and stops when it closes (A45)', async () => {
    vi.useFakeTimers();
    try {
      const rig = await activated();
      feedPicture(rig.ctx, [route(ROUTE_A, 'Alpha')]);
      rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: computed(3) });
      await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
      const Editor = panel(rig.ctx, 'route-editor');
      const { unmount } = render(<Editor />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      const reads = rig.server.gets(`routes/${ROUTE_A}`);
      expect(reads).toBeGreaterThanOrEqual(4);
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(rig.server.gets(`routes/${ROUTE_A}`)).toBe(reads);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not delete a point when the route changed its points meanwhile', async () => {
    const { ctx } = await editing({ objects: true, route: { ...route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1), points: [{ speed: 1 }, { speed: 2 }, { speed: 3 }] }), geometry: THREE } });
    fireEvent.click(within(point(2)).getByRole('button', { name: 'Delete point 2' }));
    act(() => {
      ctx.live.changes([{
        sequenceNo: 9, requestId: ROUTE_A, entityType: 'object', operation: 'update', entityId: ROUTE_A, version: 4, previousVersion: 3,
        state: { ...route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1), points: [{ speed: 1 }, { speed: 2 }] }), version: 4 }, label: ctx.defaultLabel,
        at: '2026-10-27T08:00:01.000Z', by: { plugin: 'core-shell' },
      }]);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move them with it' }));
      await settled();
    });
    expect(ctx.submitted).toEqual([]);
    expect((await screen.findByRole('alert')).textContent).toContain('The route changed its points meanwhile; delete it again');
  });

  it('builds the second of two quick edits from the first one\'s result', async () => {
    const { ctx } = await editing();
    await commit(within(point(1)).getByLabelText('Speed (km/h)'), '36');
    await commit(within(point(2)).getByLabelText('Speed (km/h)'), '72');
    expect(ctx.submitted).toHaveLength(2);
    expect(ctx.submitted[1]).toMatchObject({ baseVersion: 4 });
    expect(lastExtension(ctx)['points']).toEqual([{ speed: 10 }, { speed: 20 }]);
  });

  it('no longer shows a value as saved when its update was rejected', async () => {
    const { ctx } = await editing();
    ctx.answerWith((request) => ({
      outcome: 'rejected',
      rejection: { requestId: request.requestId, entityType: 'object', operation: 'update', entityId: request.entityId, code: 'VALIDATION_FAILED', message: 'no', at: '2026-10-27T08:00:00.000Z' },
    }));
    const box = within(point(1)).getByLabelText<HTMLInputElement>('Speed (km/h)');
    await commit(box, '50');
    expect(box.value).toBe('30');
  });

  it('shows an error of the map view instead of throwing it', async () => {
    const { map } = await editing();
    vi.spyOn(map, 'pickPoint').mockRejectedValueOnce(new Error('broken'));
    fireEvent.click(within(point(1)).getByRole('button', { name: 'Insert point after point 1' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The map could not do it: Error: broken');
  });

  it('goes back to the open route when "New route" is cancelled', async () => {
    const rig = await editing();
    act(() => {
      rig.map.activeLayer.set(SIM_LAYER);
    });
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    await act(async () => {
      rig.map.completeDrawing(null);
      await settled();
    });
    expect(rig.ctx.addedPanels.some((p) => p.panel.id === 'route-editor')).toBe(true);
    expect(await screen.findByRole('region', { name: 'Point 1' })).toBeDefined();
  });
});

describe('ending the interactions (A42; CR-0025 part 1)', () => {
  it('ends a reshape when the editor closes', async () => {
    const { map, ctx } = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Reshape' }));
    expect(map.runningInteraction).toBe('edit');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close the route editor' }));
      await settled();
    });
    expect(map.runningInteraction).toBeNull();
    expect(ctx.submitted).toEqual([]);
  });

  it('ends a pick when another route is opened', async () => {
    const { map, ctx } = await editing();
    fireEvent.click(within(point(1)).getByRole('button', { name: 'Insert point after point 1' }));
    await act(async () => {
      await ctx.runObjectAction('edit-route', [ROUTE_B]);
      await settled();
    });
    expect(map.runningInteraction).toBeNull();
    expect(ctx.submitted).toEqual([]);
  });

  it('ends a reshape on a workspace switch', async () => {
    const { map, ctx } = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Reshape' }));
    await act(async () => {
      map.switchWorkspace();
      ctx.switchWorkspace(VIEW_WORKSPACE);
      ctx.switchWorkspace(SIMULATION);
      await settled();
    });
    expect(map.runningInteraction).toBeNull();
    expect(ctx.submitted).toEqual([]);
  });

  it('ends a reshape and says so when the route is deleted', async () => {
    const { map, ctx } = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Reshape' }));
    await act(async () => {
      ctx.live.changes([{
        sequenceNo: 9, requestId: ROUTE_A, entityType: 'object', operation: 'delete', entityId: ROUTE_A, version: 4, previousVersion: 3,
        state: null, label: ctx.defaultLabel, at: '2026-10-27T08:00:01.000Z', by: { plugin: 'core-shell' },
      }]);
      await settled();
    });
    expect(map.runningInteraction).toBeNull();
    expect((await screen.findByRole('alert')).textContent).toContain('The route was deleted');
  });
});

describe('a route that goes away while open (part D; function 9b)', () => {
  /** The editor open on Alpha, built under fake timers (findByRole waits on real ones). */
  async function openUnderFakeTimers(): Promise<Rig> {
    const rig = await activated();
    feedPicture(rig.ctx, [route(ROUTE_A, 'Alpha')]);
    rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: computed(3) });
    await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
    const Editor = panel(rig.ctx, 'route-editor');
    render(<Editor />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(rig.server.gets(`routes/${ROUTE_A}`)).toBeGreaterThanOrEqual(2);
    return rig;
  }

  function changed(ctx: Rig['ctx'], state: MapObject | null): void {
    ctx.live.changes([{
      sequenceNo: 9, requestId: ROUTE_A, entityType: 'object', operation: state === null ? 'delete' : 'update', entityId: ROUTE_A, version: 4, previousVersion: 3,
      state: state === null ? null : { ...state, version: 4 }, label: ctx.defaultLabel, at: '2026-10-28T08:00:01.000Z', by: { plugin: 'draw-shapes' },
    }]);
  }

  it('counts a data type changed by another plugin as gone, and stops reading it', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, server } = await openUnderFakeTimers();
      await act(async () => {
        changed(ctx, { ...route(ROUTE_A, 'Alpha'), dataType: 'core.general' });
        await vi.advanceTimersByTimeAsync(100);
      });
      const reads = server.gets(`routes/${ROUTE_A}`);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(server.gets(`routes/${ROUTE_A}`)).toBe(reads);
      expect(screen.getByRole('alert').textContent).toContain('This is no longer a route: its data type was changed');
      expect(screen.queryByText('Waiting for the route…')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so once: a dismissed notice stays dismissed while the picture changes', async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = await openUnderFakeTimers();
      await act(async () => {
        changed(ctx, { ...route(ROUTE_A, 'Alpha'), dataType: 'core.general' });
        await vi.advanceTimersByTimeAsync(100);
      });
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      await act(async () => {
        feedPicture(ctx, [{ ...route(ROUTE_A, 'Alpha'), dataType: 'core.general', version: 5 }, symbol(TRACK_1, SIM_LAYER)]);
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a route again, without the notice, once it is a route again', async () => {
    vi.useFakeTimers();
    try {
      const { ctx } = await openUnderFakeTimers();
      await act(async () => {
        changed(ctx, { ...route(ROUTE_A, 'Alpha'), dataType: 'core.general' });
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.getByRole('alert')).toBeDefined();
      await act(async () => {
        feedPicture(ctx, [route(ROUTE_A, 'Alpha', {}, 6)]);
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('region', { name: 'Point 1' })).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops reading a deleted route', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, server } = await openUnderFakeTimers();
      await act(async () => {
        changed(ctx, null);
        await vi.advanceTimersByTimeAsync(100);
      });
      const reads = server.gets(`routes/${ROUTE_A}`);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(server.gets(`routes/${ROUTE_A}`)).toBe(reads);
      expect(screen.getByRole('alert').textContent).toContain('The route was deleted');
      expect(screen.queryByText('Waiting for the route…')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('read-only (function 23, A46, criterion 22)', () => {
  it('shows the values without letting them change', async () => {
    await editing({ permissions: [VIEW] });
    expect(screen.getByText(EDIT_HINT)).toBeDefined();
    expect(within(point(1)).getByLabelText('Speed (km/h)')).toHaveProperty('readOnly', true);
    for (const name of ['Reshape', 'Insert point after point 1', 'Add event at point 1']) expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
    expect(within(point(1)).getByLabelText('Speed change')).toHaveProperty('disabled', true);
  });

  it('offers no "New route"', async () => {
    const rig = await activated({ permissions: [VIEW] });
    feedPicture(rig.ctx, []);
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    expect(screen.getByRole('button', { name: 'New route' }).getAttribute('title')).toBe(EDIT_HINT);
  });
});

describe('opening the editor (A35)', () => {
  it('opens from the route row\'s Edit, with the route\'s objects in list order (A43)', async () => {
    const rig = await activated();
    feedPicture(rig.ctx, [route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1) }), symbol(TRACK_1, SIM_LAYER)]);
    rig.server.on('GET', 'routes', { status: 200, body: { running: false, routes: [routeInfo(ROUTE_A, 'Alpha')] } });
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Alpha' }));
    const Editor = panel(rig.ctx, 'route-editor');
    render(<Editor />);
    expect(within(screen.getByRole('region', { name: 'Objects on the route' })).getByText('Track 1')).toBeDefined();
  });

  it('brings its panel to the front when it opens, and again for another route (part D)', async () => {
    const rig = await activated();
    feedPicture(rig.ctx, [route(ROUTE_A, 'Alpha'), route(ROUTE_B, 'Bravo')]);
    await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
    expect(rig.ctx.addedPanels.find((p) => p.panel.id === 'route-editor')?.shown).toBe(1);
    await rig.ctx.runObjectAction('edit-route', [ROUTE_B]);
    expect(rig.ctx.addedPanels.find((p) => p.panel.id === 'route-editor')?.shown).toBe(2);
  });

  it('is offered for routes only', async () => {
    const rig = await activated();
    feedPicture(rig.ctx, [route(ROUTE_A, 'Alpha'), symbol(TRACK_1, SIM_LAYER)]);
    await expect(rig.ctx.runObjectAction('edit-route', [TRACK_1])).rejects.toThrow(/would not offer/);
  });
});
