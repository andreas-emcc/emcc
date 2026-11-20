// Acceptance criteria 27 to 30 and 32 to 34 of the brief (M6): the new-layer dialog with the
// layer's classification (function 23; SDK 1.5.0 part 4) and the active layer over the map
// (function 24). Criteria 31 and 35 are browser checks.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NATO_CLASSIFICATIONS } from '@emc2/plugin-sdk';
import type { ChangeRequest, LayerContent, SecurityLabel, WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import { openBrowser, settle, type Browser, type BrowserOptions } from './browser.tsx';
import { assertSchemaValid, FakeServer, LABEL, layer } from './fakeServer.ts';

afterEach(cleanup);

const SIM: WorkspaceInfo = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };

function dataOf(request: ChangeRequest | undefined): LayerContent {
  if (!request || !('data' in request) || request.entityType !== 'layer') throw new Error('not a layer create or update');
  return request.data;
}

function dialogOf(browser: Browser) {
  return within(browser.view.getByRole('alertdialog', { name: 'New layer' }));
}

async function openDialog(browser: Browser, button = 'New layer') {
  fireEvent.click(browser.view.getByRole('button', { name: button }));
  await settle();
  return dialogOf(browser);
}

describe('AC27 (M6): the new-layer dialog', () => {
  it('opens with "Layer N" and the NATO order lowest first, UNCLASSIFIED chosen; Create sends one schema-valid createLayer', async () => {
    const server = new FakeServer([layer('Layer 1', 1)]);
    const one = await openBrowser(server);
    const dialog = await openDialog(one);
    expect(dialog.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Layer 2');
    const select = dialog.getByRole<HTMLSelectElement>('combobox', { name: 'Classification' });
    expect([...select.options].map((o) => o.value)).toEqual([...NATO_CLASSIFICATIONS]);
    expect(select.value).toBe('UNCLASSIFIED');
    expect(server.requests).toEqual([]);

    fireEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await settle();
    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    if (request === undefined) throw new Error('no request');
    assertSchemaValid(request);
    expect(request).toMatchObject({ entityType: 'layer', operation: 'create' });
    expect(dataOf(request)).toMatchObject({ name: 'Layer 2', visible: true, label: LABEL });
    expect(one.view.queryByRole('alertdialog')).toBeNull();
    expect(one.listed()).toEqual(['Layer 2', 'Layer 1']);
    expect(one.map.activeLayer.value).toBe(server.layerNamed('Layer 2').id);
  });

  it('Cancel and Escape send nothing', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    fireEvent.click((await openDialog(one)).getByRole('button', { name: 'Cancel' }));
    expect(one.view.queryByRole('alertdialog')).toBeNull();
    await openDialog(one);
    fireEvent.keyDown(one.view.getByRole('alertdialog', { name: 'New layer' }), { key: 'Escape' });
    expect(one.view.queryByRole('alertdialog')).toBeNull();
    await settle();
    expect(server.requests).toEqual([]);
  });
});

describe('AC28 (M6): a chosen classification and a typed name', () => {
  const withCategories: SecurityLabel = {
    ...LABEL, categories: [{ tagName: 'Releasable to', type: 'permissive', values: ['SWE', 'NOR'] }],
  };

  it('sends the label with SECRET, the policy and the categories unchanged, and the typed name trimmed', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server, { defaultLabel: withCategories });
    const dialog = await openDialog(one);
    fireEvent.change(dialog.getByRole('textbox', { name: 'Name' }), { target: { value: '  Reference  ' } });
    fireEvent.change(dialog.getByRole('combobox', { name: 'Classification' }), { target: { value: 'SECRET' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(dataOf(server.requests[0])).toMatchObject({ name: 'Reference', label: { ...withCategories, classification: 'SECRET' } });
  });

  it('an empty name sends nothing, keeps the dialog open and says why (owner, 2026-11-11)', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server);
    const dialog = await openDialog(one);
    const name = dialog.getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: '   ' } });
    expect(dialog.getByText('Enter a name')).toBeDefined();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await settle();
    expect(server.requests).toEqual([]);
    expect(one.view.getByRole('alertdialog', { name: 'New layer' })).toBeDefined();
    fireEvent.change(name, { target: { value: 'B' } });
    expect(dialog.queryByText('Enter a name')).toBeNull();
  });
});

describe("AC29 (M6): the policy's order", () => {
  const nato = (options: BrowserOptions) => openBrowser(new FakeServer([layer('A', 1)]), options);

  it('finds the order of policy "nato" under "NATO", ignoring case', async () => {
    const order = ['UNCLASSIFIED', 'RESTRICTED', 'SECRET'];
    const one = await nato({ defaultLabel: { ...LABEL, policyIdentifier: { name: 'nato' } }, classifications: { NATO: order } });
    const select = (await openDialog(one)).getByRole<HTMLSelectElement>('combobox', { name: 'Classification' });
    expect([...select.options].map((o) => o.value)).toEqual(order);
  });

  for (const [what, options] of [
    ['with no orders configured', { classifications: {} }],
    ['with a default classification outside the order', { defaultLabel: { ...LABEL, classification: 'INTERNAL' } }],
    ['without an order for the policy', { defaultLabel: { ...LABEL, policyIdentifier: { name: 'OTHER' } } }],
  ] as const) {
    it(`${what}: no select, and the layer gets the default label`, async () => {
      const server = new FakeServer([layer('A', 1)]);
      const one = await openBrowser(server, options);
      const dialog = await openDialog(one);
      expect(dialog.queryByRole('combobox')).toBeNull();
      fireEvent.click(dialog.getByRole('button', { name: 'Create' }));
      await settle();
      expect(dataOf(server.requests[0]).label).toEqual(options.defaultLabel ?? LABEL);
    });
  }
});

describe('AC30 (M6): as before', () => {
  it('in Simulation the request carries the workspace, from "Create first layer" too', async () => {
    const server = new FakeServer([layer('V1', 1)]);
    const one = await openBrowser(server, { workspaces: [SIM], workspace: SIM.id });
    const dialog = await openDialog(one, 'Create first layer');
    fireEvent.change(dialog.getByRole('combobox', { name: 'Classification' }), { target: { value: 'RESTRICTED' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Create' }));
    await settle();
    expect(dataOf(server.requests[0])).toMatchObject({ workspace: SIM.id, name: 'Layer 1', label: { ...LABEL, classification: 'RESTRICTED' } });
    expect(one.listed()).toEqual(['Layer 1']);
  });

  it('without the permission the buttons stay disabled and no dialog opens', async () => {
    const server = new FakeServer([layer('A', 1)]);
    const one = await openBrowser(server, { user: createFakeUser({ permissions: [] }) });
    const create = one.view.getByRole<HTMLButtonElement>('button', { name: 'New layer' });
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(one.view.queryByRole('alertdialog')).toBeNull();
    expect(server.requests).toEqual([]);
  });
});

/** Renders the overlay the panel added, as the shell would in the Map Pane. */
function renderOverlay(one: Browser) {
  const overlay = one.ctx.overlays[0];
  if (overlay === undefined) throw new Error('no overlay');
  const Overlay = overlay.component;
  const { container } = render(<Overlay />);
  const box = () => {
    const found = container.querySelector<HTMLElement>('.layer-panel-active');
    if (found === null) throw new Error('no box');
    return found;
  };
  return { box, text: () => box().textContent };
}

describe('AC32 (M6): the active layer over the map', () => {
  it('adds one overlay at the bottom left, order 110, in every workspace', async () => {
    const one = await openBrowser(new FakeServer([layer('A', 1)]));
    expect(one.ctx.overlays.map((o) => [o.id, o.position, o.order, o.workspaces])).toEqual([['layer-panel-active', 'bottom-left', 110, ['*']]]);
  });

  it('shows "Active layer: Layer 2" for the active Layer 2, and "No active layer" with none or an unknown id', async () => {
    const server = new FakeServer([layer('Layer 2', 2), layer('Layer 1', 1)]);
    const one = await openBrowser(server);
    const overlay = renderOverlay(one);
    expect(overlay.text()).toBe('Active layer: Layer 2');
    act(() => {
      one.map.activeLayer.set(null);
    });
    // The panel fills the gap with the top layer (function 21), so it shows a moment without one only in between.
    expect(overlay.text()).toBe('Active layer: Layer 2');
    act(() => {
      one.ctx.live.snapshot({ layers: [] });
    });
    expect(overlay.text()).toBe('No active layer');
  });

  it('shows "No active layer" for an id the picture does not hold', async () => {
    const server = new FakeServer([]);
    const one = await openBrowser(server);
    const overlay = renderOverlay(one);
    act(() => {
      one.map.activeLayer.set('0190e7f0-0000-7000-8000-000000000001');
    });
    expect(overlay.text()).toBe('No active layer');
  });

  it('adds no overlay without a map view', async () => {
    const one = await openBrowser(new FakeServer([layer('A', 1)]), { withMapView: false });
    expect(one.ctx.overlays).toEqual([]);
  });
});

describe('AC33 (M6): the overlay follows', () => {
  it('another plugin making a layer active, a rename, a lock and unlock from a second browser, and a delete', async () => {
    const server = new FakeServer([layer('A', 2), layer('B', 1)]);
    const one = await openBrowser(server);
    const two = await openBrowser(server);
    const overlay = renderOverlay(one);
    const subscriptions = one.ctx.liveSubscriptions.length;
    act(() => {
      one.map.activeLayer.set(server.layerNamed('B').id);
    });
    expect(overlay.text()).toBe('Active layer: B');

    fireEvent.click(two.view.getByRole('button', { name: 'Rename B' }));
    const field = two.view.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'C' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(overlay.text()).toBe('Active layer: C');

    fireEvent.click(two.view.getByRole('button', { name: 'Lock C' }));
    await settle();
    expect(within(overlay.box()).getByRole('img', { name: 'Locked' })).toBeDefined();
    fireEvent.click(two.view.getByRole('button', { name: 'Unlock C' }));
    await settle();
    expect(within(overlay.box()).queryByRole('img', { name: 'Locked' })).toBeNull();

    fireEvent.click(two.view.getByRole('button', { name: 'Delete C' }));
    fireEvent.click(within(two.view.getByRole('alertdialog', { name: 'Delete layer' })).getByRole('button', { name: 'Delete' }));
    await settle();
    // Function 21: the layer below, or from the bottom the top one.
    expect(overlay.text()).toBe('Active layer: A');
    expect(one.ctx.liveSubscriptions.length).toBe(subscriptions);
  });
});

describe('AC34 (M6): long names and no clicks', () => {
  it('cuts a 200-character name with "…" by CSS, whole in the title; no button, link or tab stop', async () => {
    const long = 'L'.repeat(200);
    const one = await openBrowser(new FakeServer([layer(long, 1)]));
    const { box } = renderOverlay(one);
    expect(box().title).toBe(`Active layer: ${long}`);
    expect(box().querySelector('.layer-panel-active-name')?.textContent).toBe(long);
    expect(box().querySelectorAll('button, a, input, select, [tabindex]')).toHaveLength(0);
    expect(within(box()).queryAllByRole('button')).toEqual([]);
  });

  it('shows a locked layer with the lock before the name', async () => {
    const one = await openBrowser(new FakeServer([{ ...layer('A', 1), locked: true }]));
    const { box } = renderOverlay(one);
    expect([...box().children].map((c) => c.querySelector('[role="img"]')?.getAttribute('aria-label') ?? c.textContent)).toEqual(['Active layer: ', 'Locked', 'A']);
  });
});
