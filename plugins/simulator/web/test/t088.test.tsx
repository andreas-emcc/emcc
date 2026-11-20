// T-088: the route editor one point at a time with the map highlight (A58, A59), "All points"
// (Q16, A60), "Copy from previous point" (A61), and the routes' colour (BE a, Q17, A62).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import type { JsonValue, LineString, MapObject } from '@emc2/plugin-sdk';
import { HIGHLIGHT_STYLE } from '../src/editor.ts';
import { EDIT_HINT } from '../src/permissions.ts';
import { SIMULATION } from '../src/picture.ts';
import { activated, feedPicture, lastData, lastExtension, panel, route, ROUTE_A, ROUTE_B, routeInfo, settled, SIM_LAYER, VIEW } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
});

const THREE: LineString = { type: 'LineString', coordinates: [[18.0, 59.3], [18.2, 59.4], [18.5, 59.6]] };

const EVENT = { at: 'arrive', kind: 'hide' };

const SAMPLE: JsonValue = [
  { speed: 1, speedKind: 'ramp', altitude: 100, altitudeKind: 'ramp' },
  { speed: 2, time: { seconds: 60, from: 'previous', unit: 'kmh' }, events: [EVENT] },
  { speed: 3, events: [EVENT] },
];

function alpha(points: JsonValue = SAMPLE, style?: MapObject['style']): MapObject {
  const base = route(ROUTE_A, 'Alpha', { points });
  return { ...base, geometry: THREE, ...(style === undefined ? {} : { style }) };
}

async function editing(routeA: MapObject = alpha(), permissions?: readonly string[]): Promise<Rig> {
  const rig = await activated(permissions === undefined ? {} : { permissions });
  feedPicture(rig.ctx, [routeA, route(ROUTE_B, 'Route 2')]);
  rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha', { version: routeA.version }) });
  await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
  const Editor = panel(rig.ctx, 'route-editor');
  render(<Editor />);
  await screen.findByRole('region', { name: 'Point 1' });
  return rig;
}

function shown(): HTMLElement {
  return screen.getByRole('region', { name: /^Point \d+$/ });
}

function step(name: 'Previous point' | 'Next point'): void {
  fireEvent.click(within(shown()).getByRole('button', { name }));
}

function points(rig: Rig): unknown[] {
  return lastExtension(rig.ctx)['points'] as unknown[];
}

describe('one point at a time (A58)', () => {
  it('shows "Point n of m", and the arrows go round', async () => {
    await editing();
    expect(screen.getAllByRole('region', { name: /^Point \d+$/ })).toHaveLength(1);
    expect(within(shown()).getByText('Point 1 of 3')).toBeDefined();
    step('Previous point');
    expect(within(shown()).getByText('Point 3 of 3')).toBeDefined();
    step('Next point');
    step('Next point');
    expect(within(shown()).getByText('Point 2 of 3')).toBeDefined();
  });

  it('shows the point that takes the place of a deleted one, and starts another route at point 1', async () => {
    const rig = await editing();
    step('Previous point');
    await act(async () => {
      fireEvent.click(within(shown()).getByRole('button', { name: 'Delete point 3' }));
      await settled();
    });
    expect(points(rig)).toHaveLength(2);
    expect(within(shown()).getByText('Point 2 of 2')).toBeDefined();
    step('Next point');
    expect(within(shown()).getByText('Point 1 of 2')).toBeDefined();
    step('Next point');
    act(() => {
      rig.ctx.runObjectAction('edit-route', [ROUTE_B]).catch(() => undefined);
    });
    expect(within(await screen.findByRole('region', { name: 'Point 1' })).getByText('Point 1 of 2')).toBeDefined();
  });
});

describe('the highlight on the map (A59)', () => {
  it('marks the point shown, follows the arrows, and is cleared in View and when the editor closes', async () => {
    const rig = await editing();
    expect(rig.map.overlayItems.at(-1)).toEqual([{ kind: 'point', position: [18.0, 59.3], style: HIGHLIGHT_STYLE }]);
    step('Next point');
    expect(rig.map.overlayItems.at(-1)).toEqual([{ kind: 'point', position: [18.2, 59.4], style: HIGHLIGHT_STYLE }]);
    const sets = rig.map.overlayItems.length;
    // A tick of a running simulation changes the picture, not the point: nothing is set again.
    feedPicture(rig.ctx, [alpha(), route(ROUTE_B, 'Route 2')]);
    expect(rig.map.overlayItems).toHaveLength(sets);
    act(() => {
      rig.ctx.switchWorkspace(VIEW_WORKSPACE);
    });
    expect(rig.map.overlayItems.at(-1)).toEqual([]);
    act(() => {
      rig.ctx.switchWorkspace(SIMULATION);
    });
    expect(rig.map.overlayItems.at(-1)).toEqual([{ kind: 'point', position: [18.2, 59.4], style: HIGHLIGHT_STYLE }]);
    fireEvent.click(screen.getByRole('button', { name: 'Close the route editor' }));
    expect(rig.map.overlayItems.at(-1)).toEqual([]);
  });

  it('is cleared when the route is deleted', async () => {
    const rig = await editing();
    act(() => {
      feedPicture(rig.ctx, [route(ROUTE_B, 'Route 2')]);
    });
    expect(rig.map.overlayItems.at(-1)).toEqual([]);
  });
});

describe('"All points" (Q16, A60)', () => {
  function type(label: string, text: string): void {
    fireEvent.change(within(screen.getByRole('region', { name: 'All points' })).getByLabelText(label), { target: { value: text } });
  }

  it('sets the values on every point after the confirmation, and nothing on Cancel', async () => {
    const rig = await editing();
    type('Speed (km/h)', '36');
    fireEvent.change(within(screen.getByRole('region', { name: 'All points' })).getByLabelText('Altitude change'), { target: { value: 'instant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set on all points' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Change all points' });
    expect(dialog.textContent).toContain('All 3 points of Alpha will be changed.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(rig.ctx.submitted).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Set on all points' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change all 3 points' }));
      await settled();
    });
    expect(rig.ctx.submitted).toHaveLength(1);
    // The speed replaces the typed time (A38); the speed change, the altitude and the events stay.
    expect(points(rig)).toEqual([
      { speed: 10, speedKind: 'ramp', altitude: 100, altitudeKind: 'instant' },
      { speed: 10, events: [EVENT], altitudeKind: 'instant' },
      { speed: 10, events: [EVENT], altitudeKind: 'instant' },
    ]);
  });

  it('refuses nothing chosen, and a value outside the limits, without asking', async () => {
    const rig = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Set on all points' }));
    expect(screen.getByText('Choose or type a value to set')).toBeDefined();
    type('Altitude (m)', '40000');
    fireEvent.click(screen.getByRole('button', { name: 'Set on all points' }));
    expect(screen.getByText(/An altitude must be from/)).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(rig.ctx.submitted).toEqual([]);
  });
});

describe('"Copy from previous point" (A61)', () => {
  it('is disabled on the first point', async () => {
    await editing();
    expect(within(shown()).getByRole('button', { name: 'Copy from previous point' })).toHaveProperty('disabled', true);
  });

  it("copies the speed and altitude with their changes; the time goes, the events stay", async () => {
    const rig = await editing();
    step('Next point');
    await act(async () => {
      fireEvent.click(within(shown()).getByRole('button', { name: 'Copy from previous point' }));
      await settled();
    });
    expect(points(rig)[1]).toEqual({ events: [EVENT], speedKind: 'ramp', speed: 1, altitudeKind: 'ramp', altitude: 100 });
    expect(points(rig)[0]).toEqual({ speed: 1, speedKind: 'ramp', altitude: 100, altitudeKind: 'ramp' });
  });
});

describe('read-only (criterion 22)', () => {
  it('has no "All points", and Copy is disabled; the arrows still work', async () => {
    await editing(alpha(), [VIEW]);
    expect(screen.queryByRole('region', { name: 'All points' })).toBeNull();
    step('Next point');
    const copy = within(shown()).getByRole('button', { name: 'Copy from previous point' });
    expect(copy).toHaveProperty('disabled', true);
    expect(copy.getAttribute('title')).toBe(EDIT_HINT);
  });

  it('cannot change the routes\' colour', async () => {
    const rig = await activated({ permissions: [VIEW] });
    feedPicture(rig.ctx, [alpha()]);
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    expect(screen.getByLabelText('Route colour')).toHaveProperty('disabled', true);
  });
});

describe("the routes' colour (BE a, Q17, A62)", () => {
  async function routesPanel(objects: readonly MapObject[]): Promise<Rig> {
    const rig = await activated();
    feedPicture(rig.ctx, [...objects]);
    act(() => {
      rig.map.activeLayer.set(SIM_LAYER);
    });
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    return rig;
  }

  async function choose(colour: string): Promise<void> {
    const box = screen.getByLabelText('Route colour');
    await act(async () => {
      fireEvent.change(box, { target: { value: colour } });
      fireEvent.keyDown(box, { key: 'Enter' });
      fireEvent.blur(box);
      await settled();
    });
  }

  it("shows the routes' most common colour, and gives every route of another colour the chosen one, keeping the rest of its style", async () => {
    const red = { strokeColor: '#aa0000', strokeDash: 'dash', pointMarkers: 'circle' } as const;
    const rig = await routesPanel([
      alpha(SAMPLE, red),
      { ...route(ROUTE_B, 'Bravo'), style: red },
      { ...route('0b5d0d2e-0000-4000-8000-000000000003', 'Charlie'), style: { strokeColor: '#00aa00' } },
    ]);
    expect(screen.getByLabelText<HTMLInputElement>('Route colour').value).toBe('#aa0000');
    await choose('#00aa00');
    expect(rig.ctx.submitted.map((r) => r.entityId)).toEqual([ROUTE_A, ROUTE_B]);
    expect(lastData(rig.ctx).style).toEqual({ strokeColor: '#00aa00', strokeDash: 'dash', pointMarkers: 'circle' });
    expect(lastData(rig.ctx).extensions).toEqual({ simulator: { points: [{ speed: 8.33 }, { speed: 8.33 }] }, other: { kept: true } });
  });

  it('says how many routes kept their colour when updates are refused', async () => {
    const rig = await routesPanel([alpha(), route(ROUTE_B, 'Bravo')]);
    rig.ctx.answerWith((request) => ({
      outcome: 'rejected',
      rejection: { requestId: request.requestId, entityType: 'object', operation: 'update', entityId: request.entityId, code: 'PERMISSION_DENIED', message: 'no', at: '2026-10-29T08:00:00.000Z' },
    }));
    await choose('#00aa00');
    expect(screen.getByRole('alert').textContent).toContain('2 of 2 routes kept their colour');
  });

  it('gives a new route the chosen colour, also with no routes yet', async () => {
    const rig = await routesPanel([]);
    await choose('#123456');
    expect(rig.ctx.submitted).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    expect(rig.map.drawCalls.at(-1)?.style?.strokeColor).toBe('#123456');
    await act(async () => {
      rig.map.completeDrawing(THREE);
      await settled();
    });
    expect(lastData(rig.ctx).style?.strokeColor).toBe('#123456');
  });
});
