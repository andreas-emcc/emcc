// "Put on route" and "Take off route" (brief function 10; A28, A29), and the hidden tracks' fade
// list (functions 13 and 22; A31; criterion 10).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import { SIMULATION } from '../src/picture.ts';
import { activated, feedPicture, groups, route, ROUTE_A, ROUTE_B, SIM_LAYER, symbol, TRACK_1, TRACK_2, TRACK_3, VIEW, VIEW_LAYER, VIEW_TRACK } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function picture(rig: Rig, hidden: readonly string[] = []): void {
  feedPicture(rig.ctx, [
    route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1) }),
    route(ROUTE_B, 'Bravo'),
    ...[TRACK_1, TRACK_2, TRACK_3].map((id) => symbol(id, SIM_LAYER, hidden.includes(id) ? { hidden: true } : undefined)),
    symbol(VIEW_TRACK, VIEW_LAYER),
  ]);
}

/** The "Put on route" dialog over the map (from M4, A68), or undefined while it is closed. */
function dialog(rig: Rig) {
  return rig.ctx.overlays.find((o) => o.id === 'put-on-route');
}

function Dialog(props: { readonly rig: Rig }) {
  const entry = dialog(props.rig);
  if (entry === undefined) throw new Error('the dialog is not open');
  const C = entry.component;
  return <C />;
}

describe('"Put on route" (function 10)', () => {
  it('opens its panel for the chosen tracks, with the first route chosen', async () => {
    const rig = await activated();
    picture(rig);
    await rig.ctx.runObjectAction('put-on-route', [TRACK_2, TRACK_3]);
    render(<Dialog rig={rig} />);
    expect(screen.getByText(/2 objects chosen/)).toBeDefined();
    expect(screen.getByLabelText<HTMLSelectElement>('Route').value).toBe(ROUTE_A);
    expect(dialog(rig)).toMatchObject({ position: 'top-right', order: 200, workspaces: [SIMULATION] });
    expect(rig.ctx.addedPanels.some((p) => p.panel.id === 'put-on-route')).toBe(false);
    // The focus is in the dialog, so that Escape reaches it.
    expect(screen.getByRole('dialog', { name: 'Put on route' }).contains(document.activeElement)).toBe(true);
  });

  it('puts them on the route as a convoy with its spacing, and closes', async () => {
    const rig = await activated();
    picture(rig);
    rig.server.on('POST', 'put-on-route', { status: 200, body: { route: ROUTE_B, objects: [TRACK_2, TRACK_3] } });
    await rig.ctx.runObjectAction('put-on-route', [TRACK_2, TRACK_3]);
    render(<Dialog rig={rig} />);
    fireEvent.change(screen.getByLabelText('Route'), { target: { value: ROUTE_B } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'convoy' } });
    fireEvent.change(screen.getByLabelText('Spacing (m)'), { target: { value: '75,5' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Put on route' }));
      await Promise.resolve();
    });
    expect(rig.server.posts('put-on-route').map((c) => c.body)).toEqual([{ route: ROUTE_B, kind: 'convoy', spacing: 75.5, objects: [TRACK_2, TRACK_3] }]);
    await vi.waitFor(() => {
      expect(dialog(rig)).toBeUndefined();
    });
  });

  it("sends each object on its own or a formation without a spacing", async () => {
    const rig = await activated();
    picture(rig);
    rig.server.on('POST', 'put-on-route', { status: 200, body: {} });
    await rig.ctx.runObjectAction('put-on-route', [TRACK_2]);
    render(<Dialog rig={rig} />);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'formation' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Put on route' }));
      await Promise.resolve();
    });
    expect(rig.server.posts('put-on-route').map((c) => c.body)).toEqual([{ route: ROUTE_A, kind: 'formation', objects: [TRACK_2] }]);
  });

  it("refuses a convoy's spacing outside 1 m to 100 km", async () => {
    const rig = await activated();
    picture(rig);
    await rig.ctx.runObjectAction('put-on-route', [TRACK_2, TRACK_3]);
    render(<Dialog rig={rig} />);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'convoy' } });
    for (const [typed, problem] of [['0.5', 'The spacing must be from 1 to 100000 m'], ['fast', 'The spacing must be a number'], ['', 'Type the spacing']]) {
      fireEvent.change(screen.getByLabelText('Spacing (m)'), { target: { value: typed } });
      expect(screen.getByText(problem ?? '')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Put on route' })).toHaveProperty('disabled', true);
    }
    expect(rig.server.posts()).toEqual([]);
  });

  it('shows a refusal, and keeps the panel open', async () => {
    const rig = await activated();
    picture(rig);
    rig.server.on('POST', 'put-on-route', { status: 404, body: { error: 'not a symbol in the simulation' } });
    await rig.ctx.runObjectAction('put-on-route', [TRACK_2]);
    render(<Dialog rig={rig} />);
    fireEvent.click(screen.getByRole('button', { name: 'Put on route' }));
    expect((await screen.findByRole('alert')).textContent).toContain('not a symbol in the simulation');
    expect(dialog(rig)).toBeDefined();
  });

  it('closes with its close button and with Escape, and opens once for another choice (criterion 29)', async () => {
    const rig = await activated();
    picture(rig);
    await rig.ctx.runObjectAction('put-on-route', [TRACK_2]);
    await rig.ctx.runObjectAction('put-on-route', [TRACK_3]);
    expect(rig.ctx.overlays.filter((o) => o.id === 'put-on-route')).toHaveLength(1);
    render(<Dialog rig={rig} />);
    expect(screen.getByText(/1 object chosen/)).toBeDefined();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    });
    expect(dialog(rig)).toBeUndefined();
    cleanup();
    await rig.ctx.runObjectAction('put-on-route', [TRACK_2]);
    render(<Dialog rig={rig} />);
    act(() => {
      fireEvent.keyDown(screen.getByLabelText('Kind'), { key: 'Escape' });
    });
    expect(dialog(rig)).toBeUndefined();
  });

  it('is offered only for tracks in Simulation (function 3)', async () => {
    const rig = await activated();
    picture(rig);
    await expect(rig.ctx.runObjectAction('put-on-route', [VIEW_TRACK])).rejects.toThrow(/would not offer/);
    await expect(rig.ctx.runObjectAction('put-on-route', [ROUTE_A])).rejects.toThrow(/would not offer/);
  });

  it('is not offered without plugin.simulator.edit (criterion 22)', async () => {
    const rig = await activated({ permissions: [VIEW] });
    picture(rig);
    await expect(rig.ctx.runObjectAction('put-on-route', [TRACK_2])).rejects.toThrow(/would not offer/);
    await expect(rig.ctx.runObjectAction('take-off-route', [TRACK_1])).rejects.toThrow(/would not offer/);
  });
});

describe('"Take off route" (function 10, A29)', () => {
  it('is offered only when every chosen object is on a route', async () => {
    const rig = await activated();
    picture(rig);
    await expect(rig.ctx.runObjectAction('take-off-route', [TRACK_1, TRACK_2])).rejects.toThrow(/would not offer/);
  });

  it('takes them off at once', async () => {
    const rig = await activated();
    picture(rig);
    rig.server.on('POST', 'take-off-route', { status: 200, body: { objects: [TRACK_1] } });
    await rig.ctx.runObjectAction('take-off-route', [TRACK_1]);
    expect(rig.server.posts('take-off-route').map((c) => c.body)).toEqual([{ objects: [TRACK_1] }]);
    expect(rig.ctx.notifications).toEqual([]);
  });

  it('shows a failure as a notification', async () => {
    const rig = await activated();
    picture(rig);
    rig.server.on('POST', 'take-off-route', { status: 504 });
    await rig.ctx.runObjectAction('take-off-route', [TRACK_1]);
    expect(rig.ctx.notifications).toEqual([{ severity: 'error', message: 'Take off route: No answer in time; it may have been done' }]);
  });
});

describe('the hidden tracks (function 13, criterion 10: "Hide" fades the object on the Simulation map)', () => {
  it('fades the tracks marked hidden, and follows the picture', async () => {
    const rig = await activated();
    picture(rig, [TRACK_2]);
    expect([...rig.map.faded]).toEqual([TRACK_2]);
    expect(rig.map.fadeLists.map((l) => l.plugin)).toEqual(['simulator']);
    act(() => {
      rig.ctx.live.changes([{
        sequenceNo: 5, requestId: TRACK_2, entityType: 'object', operation: 'update', entityId: TRACK_2, version: 2, previousVersion: 1,
        state: { ...symbol(TRACK_2, SIM_LAYER), version: 2 }, label: symbol(TRACK_2, SIM_LAYER).label, at: '2026-10-27T08:00:01.000Z', by: { plugin: 'simulator' },
      }]);
    });
    expect([...rig.map.faded]).toEqual([]);
  });

  it('criterion 26: sets the list again after a switch to View and back, which clears it (function 22, A31)', async () => {
    const rig = await activated();
    picture(rig, [TRACK_3]);
    rig.map.switchWorkspace();
    expect([...rig.map.faded]).toEqual([]);
    rig.ctx.switchWorkspace(VIEW_WORKSPACE);
    rig.map.switchWorkspace();
    rig.ctx.switchWorkspace(SIMULATION);
    expect([...rig.map.faded]).toEqual([TRACK_3]);
  });

  it('sets no list outside Simulation, where the map view would show it (A56)', async () => {
    const rig = await activated();
    picture(rig, [TRACK_3]);
    rig.map.switchWorkspace();
    rig.ctx.switchWorkspace(VIEW_WORKSPACE);
    picture(rig, [TRACK_2]);
    expect([...rig.map.faded]).toEqual([]);
    rig.map.switchWorkspace();
    rig.ctx.switchWorkspace(SIMULATION);
    expect([...rig.map.faded]).toEqual([TRACK_2]);
  });
});
