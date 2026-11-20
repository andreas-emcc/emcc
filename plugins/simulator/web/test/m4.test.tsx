// From M4 (T-101, T-108): the route editor's layout (criterion 28; A65 to A67) and the default panes
// (criterion 31; BS, A70).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LineString } from '@emc2/plugin-sdk';
import { SIMULATION } from '../src/picture.ts';
import { activated, feedPicture, panel, route, ROUTE_A, ROUTE_B, routeInfo } from './harness.tsx';

afterEach(() => {
  cleanup();
});

const THREE: LineString = { type: 'LineString', coordinates: [[18.0, 59.3], [18.2, 59.4], [18.5, 59.6]] };

async function editing() {
  const rig = await activated();
  feedPicture(rig.ctx, [{ ...route(ROUTE_A, 'Alpha', { points: [{ speed: 1 }, { speed: 2 }, { speed: 3 }] }), geometry: THREE }, route(ROUTE_B, 'Route 2')]);
  rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha') });
  await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
  const Editor = panel(rig.ctx, 'route-editor');
  render(<Editor />);
  await screen.findByRole('region', { name: 'Point 1' });
  return rig;
}

describe('the route editor from M4 (criterion 28)', () => {
  it('has the up arrow for the next point first, and the down arrow for the previous', async () => {
    await editing();
    const pane = screen.getByRole('region', { name: 'Point 1' });
    const names = within(pane).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names.slice(0, 2)).toEqual(['Next point', 'Previous point']);
    fireEvent.click(within(pane).getByRole('button', { name: 'Next point' }));
    expect(within(screen.getByRole('region', { name: 'Point 2' })).getByText('Point 2 of 3')).toBeDefined();
  });

  it('puts "Reshape" at the end of the row of "At the end", and the unit selectors in "All points"', async () => {
    await editing();
    const reshape = screen.getByRole('button', { name: 'Reshape' });
    expect(reshape.parentElement?.className).toBe('simulator-push-end');
    expect(reshape.parentElement?.parentElement?.contains(screen.getByLabelText('At the end'))).toBe(true);
    const all = screen.getByRole('region', { name: 'All points' });
    fireEvent.change(within(all).getByLabelText('Speed unit'), { target: { value: 'kn' } });
    expect(within(all).getByLabelText('Speed (kn)')).toBeDefined();
    expect(within(screen.getByRole('region', { name: 'Point 1' })).getByLabelText('Speed (kn)')).toBeDefined();
  });
});

describe('the default panes (criterion 31; BS)', () => {
  it('opens Routes in the left pane, and the route editor, the outputs, Sensors and the event panel in the right', async () => {
    const rig = await editing();
    expect(rig.ctx.addedPanels.map((p) => [p.panel.id, p.panel.defaultPane, p.panel.workspaces])).toEqual([
      ['routes', 'left', [SIMULATION]],
      ['outputs', 'right', [SIMULATION]],
      ['sensors', 'right', [SIMULATION]],
      ['route-editor', 'right', [SIMULATION]],
    ]);
  });
});
