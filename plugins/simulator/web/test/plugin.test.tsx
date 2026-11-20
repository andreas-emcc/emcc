// The web part's registration (brief function 22): its panels and object actions appear in
// Simulation only, and its live picture names its workspace.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import plugin from '../src/index.tsx';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import { SIMULATION } from '../src/picture.ts';
import { Watched } from '../src/model.ts';
import { activated, EDIT, feedPicture, panel, route, ROUTE_A, ROUTE_B, routeInfo, RUN, settled, SIMULATION_INFO, VIEW } from './harness.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css), and requires the map view', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
    expect(manifest.requires).toEqual(['emc2.map-view']);
  });

  it('adds the Routes, Ground truth outputs and Sensors panels in Simulation only, and reports OK (functions 22, 27)', async () => {
    const { ctx } = await activated();
    expect(ctx.addedPanels.map((p) => [p.panel.id, p.panel.defaultPane, p.panel.workspaces])).toEqual([
      ['routes', 'left', [SIMULATION]],
      ['outputs', 'right', [SIMULATION]],
      ['sensors', 'right', [SIMULATION]],
    ]);
    expect(ctx.addedPanels.find((p) => p.panel.id === 'outputs')?.panel.title).toBe('Ground truth outputs');
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('adds "Put on route" and "Take off route" in Simulation only, for users with plugin.simulator.edit (function 10)', async () => {
    const { ctx } = await activated();
    expect(ctx.objectActions.map((a) => [a.id, a.permission, a.workspaces, a.multiple, a.appliesTo.types])).toEqual([
      ['put-on-route', EDIT, [SIMULATION], true, ['core.symbol']],
      ['edit-route', undefined, [SIMULATION], false, ['core.shape']],
      ['take-off-route', EDIT, [SIMULATION], true, ['core.symbol']],
    ]);
  });

  it("subscribes once, to the whole Simulation workspace, whichever is shown (function 22, CR-0025 part 5, Q11)", async () => {
    const { ctx } = await activated();
    expect(ctx.liveSubscriptions).toEqual([{ workspaces: [SIMULATION] }]);
  });

  it('keeps its panels and actions when the map view failed, and says the fading is off (the review of C1)', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id, uses: ['emc2.map-view'], workspaces: [SIMULATION_INFO], workspace: SIMULATION });
    await plugin.activate(ctx);
    await settled();
    expect(ctx.addedPanels.map((p) => p.panel.id)).toEqual(['routes', 'outputs', 'sensors']);
    expect(ctx.objectActions.map((a) => a.id)).toEqual(['put-on-route', 'edit-route', 'take-off-route']);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'DEGRADED', detail: 'no map view: hidden tracks are not faded, no coverage is drawn, and routes cannot be drawn' });
  });

  it('reads nothing from the server part until a panel shows it (A25), but the sensors for their coverage (function 33) and the drawn dwells (function 43)', async () => {
    const { server } = await activated();
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET sensors', 'GET sensors/dwells']);
  });
});

describe("a user without plugin.simulator.view (Q15; the ITA's finding 3)", () => {
  it('gets no panels, actions or live picture, and nothing is read for it', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, server } = await activated({ permissions: [EDIT, RUN] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(ctx.addedPanels).toEqual([]);
      expect(ctx.objectActions).toEqual([]);
      expect(ctx.liveSubscriptions).toEqual([]);
      expect(server.calls).toEqual([]);
      expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'no plugin.simulator.view: nothing to show' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('with the view permission alone, gets the panels, which read (function 1)', async () => {
    const { ctx, server } = await activated({ permissions: [VIEW] });
    expect(ctx.addedPanels.map((p) => p.panel.id)).toEqual(['routes', 'outputs', 'sensors']);
    const Routes = panel(ctx, 'routes');
    render(<Routes />);
    await act(settled);
    expect(server.gets('routes')).toBe(1);
  });
});

describe('a refused read (A48)', () => {
  it("stops the panel's reading, shows why, and reads again once the panel is shown again", async () => {
    vi.useFakeTimers();
    try {
      const { ctx, server } = await activated();
      server.on('GET', 'routes', { status: 403, body: { error: 'forbidden' } }).on('GET', 'outputs', { status: 403, body: { error: 'forbidden' } });
      const Routes = panel(ctx, 'routes');
      const Outputs = panel(ctx, 'outputs');
      const shown = render(<><Routes /><Outputs /></>);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect([server.gets('routes'), server.gets('outputs')]).toEqual([1, 1]);
      expect(screen.getAllByText('You may not do this')).toHaveLength(2);
      shown.unmount();
      render(<><Routes /><Outputs /></>);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect([server.gets('routes'), server.gets('outputs')]).toEqual([2, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the route editor's reading of its route, and still reads another route opened", async () => {
    vi.useFakeTimers();
    try {
      const { ctx, server } = await activated();
      feedPicture(ctx, [route(ROUTE_A, 'Alpha'), route(ROUTE_B, 'Bravo')]);
      server.on('GET', `routes/${ROUTE_A}`, { status: 403, body: { error: 'forbidden' } });
      await ctx.runObjectAction('edit-route', [ROUTE_A]);
      const Editor = panel(ctx, 'route-editor');
      render(<Editor />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(server.gets(`routes/${ROUTE_A}`)).toBe(1);
      server.on('GET', `routes/${ROUTE_B}`, { status: 200, body: routeInfo(ROUTE_B, 'Bravo') });
      await act(async () => {
        await ctx.runObjectAction('edit-route', [ROUTE_B]);
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(server.gets(`routes/${ROUTE_B}`)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('once stopped, reads once after a command but not every second, until watched afresh', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      const watched = new Watched(() => {
        reads++;
        return Promise.resolve();
      }, 1000);
      const release = watched.watch();
      watched.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(reads).toBe(1);
      watched.readNow();
      await vi.advanceTimersByTimeAsync(5000);
      expect(reads).toBe(2);
      release();
      watched.watch();
      await vi.advanceTimersByTimeAsync(2500);
      expect(reads).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is only a 403: after a 503 or no answer the panel goes on reading and recovers', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, server } = await activated();
      server.on('GET', 'routes', { status: 503, body: { error: 'starting' } });
      const Routes = panel(ctx, 'routes');
      render(<Routes />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(server.gets('routes')).toBe(3);
      server.down = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      server.down = false;
      server.on('GET', 'routes', { status: 200, body: { running: false, routes: [] } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(server.gets('routes')).toBe(4);
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
