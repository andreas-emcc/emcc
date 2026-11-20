// Locked layers (brief function 25, criterion 32; SDK 1.3.0, ADR-0042; A79 to A84): "New route" and the
// route editor follow the lock of the layer live; the commands are not affected.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Layer, LineString, MapObject } from '@emc2/plugin-sdk';
import { SIMULATION } from '../src/picture.ts';
import { activated, groups, layer, panel, route, ROUTE_A, routeInfo, settled, SIM_LAYER, symbol, TRACK_1, VIEW_LAYER } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
});

const THREE: LineString = { type: 'LineString', coordinates: [[18.0, 59.3], [18.2, 59.4], [18.5, 59.6]] };
const LOCKED_HERE = 'Layer "Simulation layer" is locked';
const HIDE = { kind: 'hide' };

function simulationLayer(locked: boolean, version = 1): Layer {
  return { ...layer(SIM_LAYER, SIMULATION), version, ...(locked ? { locked: true } : {}) };
}

function feed(ctx: Rig['ctx'], locked: boolean, objects: readonly MapObject[]): void {
  ctx.live.snapshot({ layers: [simulationLayer(locked), layer(VIEW_LAYER)], objects });
  ctx.setServerObjects(objects);
}

let sequence = 100;

/** Another user locks or unlocks the Simulation layer, as the live picture tells it. */
function lockLive(ctx: Rig['ctx'], locked: boolean): void {
  sequence++;
  act(() => {
    ctx.live.changes([{
      sequenceNo: sequence, requestId: SIM_LAYER, entityType: 'layer', operation: 'update', entityId: SIM_LAYER, version: sequence, previousVersion: sequence - 1,
      state: simulationLayer(locked, sequence), label: ctx.defaultLabel, at: '2026-10-30T08:00:01.000Z', by: { plugin: 'layer-panel', user: 'someone' },
    }]);
  });
}

async function editing(locked: boolean): Promise<Rig> {
  const rig = await activated();
  const routeA = route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1), points: [{ speed: 8.33, events: [HIDE] }, { speed: 8.33 }, { speed: 8.33 }] });
  feed(rig.ctx, locked, [{ ...routeA, geometry: THREE }, symbol(TRACK_1, SIM_LAYER)]);
  rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha', { objects: [TRACK_1] }) });
  rig.server.on('GET', 'routes', { status: 200, body: { running: false, routes: [routeInfo(ROUTE_A, 'Alpha', { objects: [TRACK_1] })] } });
  await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
  const Editor = panel(rig.ctx, 'route-editor');
  render(<Editor />);
  await screen.findByRole('region', { name: 'Point 1' });
  return rig;
}

describe('"New route" in a locked layer (criterion 32; A79, A80)', () => {
  it('is disabled with its title while the active layer is locked, and follows the lock', async () => {
    const rig = await activated();
    feed(rig.ctx, true, []);
    act(() => {
      rig.map.activeLayer.set(SIM_LAYER);
    });
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    const button = () => screen.getByRole('button', { name: 'New route' });
    expect(button()).toHaveProperty('disabled', true);
    expect(button().getAttribute('title')).toBe('The active layer "Simulation layer" is locked');
    lockLive(rig.ctx, false);
    expect(button()).toHaveProperty('disabled', false);
    lockLive(rig.ctx, true);
    expect(button()).toHaveProperty('disabled', true);
  });

  it('ends a drawing whose layer becomes locked, and sends nothing', async () => {
    const rig = await activated();
    feed(rig.ctx, false, []);
    act(() => {
      rig.map.activeLayer.set(SIM_LAYER);
    });
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    expect(rig.map.runningInteraction).toBe('draw:line');
    lockLive(rig.ctx, true);
    await act(settled);
    expect(rig.map.runningInteraction).toBeNull();
    expect(rig.ctx.submitted).toEqual([]);
  });
});

describe('"Edit route" in a locked layer (criterion 32; A81, A82)', () => {
  it('opens read only with the notice, and sends nothing', async () => {
    const rig = await editing(true);
    expect(screen.getByText(LOCKED_HERE)).toBeDefined();
    const reshape = screen.getByRole('button', { name: 'Reshape' });
    expect(reshape).toHaveProperty('disabled', true);
    expect(reshape.getAttribute('title')).toBe(LOCKED_HERE);
    expect(screen.getByLabelText<HTMLInputElement>('Name').readOnly).toBe(true);
    expect(screen.getByLabelText('At the end')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('region', { name: 'All points' })).toBeNull();
    const point = screen.getByRole('region', { name: 'Point 1' });
    expect(within(point).getByLabelText<HTMLInputElement>('Speed (km/h)').readOnly).toBe(true);
    expect(within(point).getByRole('button', { name: 'Add event at point 1' })).toHaveProperty('disabled', true);
    expect(within(point).getByRole('button', { name: 'Add event at point 1' }).getAttribute('title')).toBe(LOCKED_HERE);
    expect(rig.ctx.submitted).toEqual([]);
  });

  it('follows the lock live, both ways', async () => {
    const rig = await editing(false);
    const reshape = () => screen.getByRole('button', { name: 'Reshape' });
    expect(reshape()).toHaveProperty('disabled', false);
    lockLive(rig.ctx, true);
    expect(reshape()).toHaveProperty('disabled', true);
    expect(screen.getByText(LOCKED_HERE)).toBeDefined();
    lockLive(rig.ctx, false);
    expect(reshape()).toHaveProperty('disabled', false);
    expect(screen.queryByText(LOCKED_HERE)).toBeNull();
  });

  it('ends a reshape whose layer becomes locked, and sends nothing', async () => {
    const rig = await editing(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reshape' }));
    expect(rig.map.runningInteraction).toBe('edit');
    lockLive(rig.ctx, true);
    await act(settled);
    expect(rig.map.runningInteraction).toBeNull();
    expect(rig.ctx.submitted).toEqual([]);
  });

  it('shows its events read only in the Event panel, and "At the end" in the Routes panel disabled', async () => {
    const rig = await editing(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open event 1 at point 1' }));
    const Event = panel(rig.ctx, 'event');
    const Routes = panel(rig.ctx, 'routes');
    render(<Event />);
    render(<Routes />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    expect(save.getAttribute('title')).toBe(LOCKED_HERE);
    await act(settled);
    const end = within(screen.getByRole('listitem', { name: 'Alpha' })).getByLabelText('At the end');
    expect(end).toHaveProperty('disabled', true);
    expect(end.closest('span')?.getAttribute('title')).toBe(LOCKED_HERE);
  });
});

describe('the commands in a locked layer (criterion 32, A83)', () => {
  it('still sends "Take off route" for a track in a locked layer', async () => {
    const rig = await editing(true);
    rig.server.on('POST', 'take-off-route', { status: 200, body: { objects: [TRACK_1] } });
    await act(async () => {
      await rig.ctx.runObjectAction('take-off-route', [TRACK_1]);
    });
    expect(rig.server.posts('take-off-route')).toHaveLength(1);
  });
});
