// The Routes panel (brief functions 14, 22 and 23): the routes' states, why one cannot run, the
// controls per route and for all, the end behaviour, and the rights.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOT_TAKEN } from '../src/server.ts';
import { RUN_HINT, EDIT_HINT } from '../src/permissions.ts';
import { activated, EDIT, feedPicture, groups, panel, route, ROUTE_A, ROUTE_B, routeInfo, TRACK_1, VIEW } from './harness.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const TWO_ROUTES = {
  running: true,
  routes: [
    routeInfo(ROUTE_A, 'Alpha', { state: 'running', objects: [TRACK_1] }),
    routeInfo(ROUTE_B, 'Bravo', { runnable: false, problems: [{ point: 1, message: 'speed above 2000 m/s' }, { point: null, message: 'needs two points' }] }),
  ],
};

async function shown(options: Parameters<typeof activated>[0] = {}) {
  const rig = await activated(options);
  rig.server.on('GET', 'routes', { status: 200, body: TWO_ROUTES });
  feedPicture(rig.ctx, [route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1), end: 'restart' }), route(ROUTE_B, 'Bravo')]);
  const Panel = panel(rig.ctx, 'routes');
  render(<Panel />);
  await screen.findByRole('listitem', { name: 'Alpha' });
  return rig;
}

describe('the Routes panel (function 22)', () => {
  it("shows each route's state, objects, length, duration and mean speed in the user's units (criterion 6)", async () => {
    await shown();
    const alpha = screen.getByRole('listitem', { name: 'Alpha' });
    expect(within(alpha).getByText('Running')).toBeDefined();
    expect(within(alpha).getByText(/1 object · 12,000 m · 0:24:00 · mean 30.0 km\/h/)).toBeDefined();
    act(() => {
      fireEvent.change(screen.getByLabelText('Speed unit'), { target: { value: 'kn' } });
      fireEvent.change(screen.getByLabelText('Altitude unit'), { target: { value: 'ft' } });
    });
    expect(within(alpha).getByText(/39,370 ft · 0:24:00 · mean 16.2 kn/)).toBeDefined();
    expect(screen.getByText('The simulation runs.')).toBeDefined();
  });

  it('says why a route cannot run, and does not offer to start it (criterion 25)', async () => {
    await shown();
    const bravo = screen.getByRole('listitem', { name: 'Bravo' });
    expect(within(bravo).getByText('Point 2: speed above 2000 m/s')).toBeDefined();
    expect(within(bravo).getByText('needs two points')).toBeDefined();
    const start = within(bravo).getByRole('button', { name: 'Start Bravo' });
    expect(start).toHaveProperty('disabled', true);
    expect(start.getAttribute('title')).toBe('Bravo cannot run');
  });

  it('starts, pauses and resets one route, and reads the routes again at once (criterion 11, A25)', async () => {
    const { server } = await shown();
    server.on('POST', `routes/${ROUTE_A}/start`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha') });
    server.on('POST', `routes/${ROUTE_A}/pause`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha') });
    server.on('POST', `routes/${ROUTE_A}/reset`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha') });
    const reads = server.gets('routes');
    const alpha = screen.getByRole('listitem', { name: 'Alpha' });
    for (const action of ['Start', 'Pause', 'Reset']) {
      await act(async () => {
        fireEvent.click(within(alpha).getByRole('button', { name: `${action} Alpha` }));
        await Promise.resolve();
      });
    }
    expect(server.posts().map((c) => [c.path, c.body])).toEqual([
      [`routes/${ROUTE_A}/start`, {}],
      [`routes/${ROUTE_A}/pause`, {}],
      [`routes/${ROUTE_A}/reset`, {}],
    ]);
    await vi.waitFor(() => {
      expect(server.gets('routes')).toBeGreaterThan(reads);
    });
  });

  it('starts, pauses and resets all routes (criterion 11)', async () => {
    const { server } = await shown();
    for (const action of ['start', 'pause', 'reset']) server.on('POST', `routes/${action}`, { status: 200, body: TWO_ROUTES });
    for (const label of ['Start all routes', 'Pause all routes', 'Reset all routes']) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: label }));
        await Promise.resolve();
      });
    }
    expect(server.posts().map((c) => c.path)).toEqual(['routes/start', 'routes/pause', 'routes/reset']);
  });

  it('shows a 405 as "not taken yet" until the CDA builds the edge (A33)', async () => {
    const { server } = await shown();
    server.on('POST', 'routes/start', { status: 405 });
    fireEvent.click(screen.getByRole('button', { name: 'Start all routes' }));
    expect((await screen.findByRole('alert')).textContent).toContain(NOT_TAKEN);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers Retry for a 503, which sends the command again (A33)', async () => {
    const { server } = await shown();
    server.on('POST', 'routes/pause', { status: 503 });
    fireEvent.click(screen.getByRole('button', { name: 'Pause all routes' }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    server.on('POST', 'routes/pause', { status: 200, body: TWO_ROUTES });
    fireEvent.click(retry);
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(server.posts('routes/pause')).toHaveLength(2);
  });

  it('sets the end behaviour with a change request on the route, keeping the rest of it (A30)', async () => {
    const { ctx } = await shown();
    const alpha = screen.getByRole('listitem', { name: 'Alpha' });
    const select = within(alpha).getByLabelText('At the end');
    expect(select).toHaveProperty('value', 'restart');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'stop' } });
      await Promise.resolve();
    });
    const request = ctx.submitted.at(-1);
    expect(request).toMatchObject({ entityType: 'object', operation: 'update', entityId: ROUTE_A, baseVersion: 3 });
    const data = request?.entityType === 'object' && 'data' in request ? request.data : null;
    expect(data?.extensions?.['simulator']).toMatchObject({ end: 'stop', groups: groups(TRACK_1), points: [{ speed: 8.33 }, { speed: 8.33 }] });
    expect(data?.extensions?.['other']).toEqual({ kept: true });
    expect(data?.geometry).toEqual(route(ROUTE_A, 'Alpha').geometry);
  });

  it("shows a rejected end behaviour change (criterion 1: without plugin.simulator.edit, changes are refused)", async () => {
    const { ctx } = await shown();
    ctx.answerWith((request) => ({
      outcome: 'rejected',
      rejection: { requestId: request.requestId, entityType: 'object', operation: 'update', entityId: request.entityId, code: 'PERMISSION_DENIED', message: 'no', at: '2026-10-27T08:00:00.000Z' },
    }));
    fireEvent.change(within(screen.getByRole('listitem', { name: 'Bravo' })).getByLabelText('At the end'), { target: { value: 'restart' } });
    expect((await screen.findByRole('alert')).textContent).toContain(EDIT_HINT);
  });

  it('reads the routes once a second while shown, and stops when it is closed (A25)', async () => {
    vi.useFakeTimers();
    const { ctx, server } = await activated();
    const Panel = panel(ctx, 'routes');
    const { unmount } = render(<Panel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(server.gets('routes')).toBe(4);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(server.gets('routes')).toBe(4);
  });

  it('says when the routes cannot be read', async () => {
    const { ctx, server } = await activated();
    server.down = true;
    const Panel = panel(ctx, 'routes');
    render(<Panel />);
    expect((await screen.findByText('The server cannot be reached')).textContent).toBeDefined();
  });
});

describe('the rights (function 23, criterion 22)', () => {
  it('disables the controls without plugin.simulator.run, and says why', async () => {
    await shown({ permissions: [VIEW, EDIT] });
    for (const name of ['Start all routes', 'Pause Alpha', 'Reset Bravo']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveProperty('disabled', true);
      expect(button.getAttribute('title')).toBe(RUN_HINT);
    }
  });

  it('shows the panel read-only without plugin.simulator.edit', async () => {
    await shown({ permissions: [VIEW] });
    expect(screen.getByText(EDIT_HINT)).toBeDefined();
    expect(within(screen.getByRole('listitem', { name: 'Alpha' })).getByLabelText('At the end')).toHaveProperty('disabled', true);
    // The units are the user's own display choice.
    expect(screen.getByLabelText('Speed unit')).toHaveProperty('disabled', false);
  });
});
