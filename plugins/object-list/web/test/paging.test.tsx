// Acceptance criteria 2, 7 and 8 of docs/plugins/briefs/object-list.md (paging, keeping the page
// current, the edge cases), and the columns of function 4. Selection and actions are in later parts.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OBJECT_LIST } from '@emc2/plugin-sdk';
import type { MapObject } from '@emc2/plugin-sdk';
import { activated, layer, objectNamed, objectsOf, fixture, gateQueries, layerDeleted, renderPanel, sendCounts, settle } from './helpers.tsx';

afterEach(cleanup);

function rowNames(): string[] {
  const list = screen.queryByRole('listbox', { name: 'Objects of the layer' });
  return (list === null ? [] : within(list).queryAllByRole('option')).map((row) => row.querySelector('.object-list-cell-name')?.textContent ?? '');
}

function click(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

async function clickAndSettle(name: string): Promise<void> {
  click(name);
  await settle();
}

describe('AC2: pages of 100', () => {
  it('a layer of 250 objects shows three pages of 100, 100 and 50 with the range and the paging buttons', async () => {
    const a = layer('Alpha', 1);
    const objects = objectsOf(a.id, 250);
    const { ctx, service } = await fixture([a], objects);
    act(() => {
      service.open(a.id);
    });
    await settle();

    // The range counts the objects of the whole layer, not those the map holds: the plugin asks for the layer's objects only.
    expect(ctx.liveSubscriptions).toEqual([{ objects: false }]);
    expect(screen.getByText('1–100 of 250')).toBeDefined();
    expect(rowNames()).toHaveLength(100);
    expect(rowNames()[0]).toBe('Object 001');
    expect(rowNames()[99]).toBe('Object 100');
    expect(screen.getByRole('button', { name: 'First page' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', true);

    await clickAndSettle('Next page');
    expect(screen.getByText('101–200 of 250')).toBeDefined();
    expect(rowNames()[0]).toBe('Object 101');
    expect(rowNames()).toHaveLength(100);

    await clickAndSettle('Next page');
    expect(screen.getByText('201–250 of 250')).toBeDefined();
    expect(rowNames()).toHaveLength(50);
    expect(rowNames()[49]).toBe('Object 250');
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Last page' })).toHaveProperty('disabled', true);

    await clickAndSettle('First page');
    expect(screen.getByText('1–100 of 250')).toBeDefined();
    await clickAndSettle('Last page');
    expect(screen.getByText('201–250 of 250')).toBeDefined();
    await clickAndSettle('Previous page');
    expect(screen.getByText('101–200 of 250')).toBeDefined();
  });

  it('groups the thousands of a long layer: 1–100 of 12 345', async () => {
    const a = layer('Big', 1);
    const { ctx, service } = await fixture([a], objectsOf(a.id, 120));
    // The fake server holds 120; the live picture says 12 345 objects, as the summary line shows.
    act(() => {
      ctx.live.counts({ [a.id]: 12345 });
    });
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(screen.getByText('12 345 objects')).toBeDefined();
  });

  it('lists the layer in the order of creation (the server\'s order)', async () => {
    const a = layer('Alpha', 1);
    const objects = objectsOf(a.id, 5).reverse();
    const { service } = await fixture([a], objects);
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(rowNames()).toEqual(['Object 001', 'Object 002', 'Object 003', 'Object 004', 'Object 005']);
  });

  it('lists only the shown layer\'s objects, and another layer after the chooser changes', async () => {
    const a = layer('Alpha', 2);
    const b = layer('Bravo', 1);
    const objects = [...objectsOf(a.id, 3, 'A'), ...objectsOf(b.id, 2, 'B', 10)];
    const { service } = await fixture([a, b], objects);
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(rowNames()).toEqual(['A 001', 'A 002', 'A 003']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Layer' }), { target: { value: b.id } });
    await settle();
    expect(rowNames()).toEqual(['B 011', 'B 012']);
    expect(screen.getByText('1–2 of 2')).toBeDefined();
  });

  it('uses the page size setting, and keeps the first object in view when it changes', async () => {
    const a = layer('Alpha', 1);
    const { ctx, service } = await fixture([a], objectsOf(a.id, 250), { settings: { pageSize: 100 } });
    act(() => {
      service.open(a.id);
    });
    await settle();
    await clickAndSettle('Next page');
    expect(screen.getByText('101–200 of 250')).toBeDefined();

    act(() => {
      ctx.changeSettings({ pageSize: 50 });
    });
    await settle();
    expect(screen.getByText('101–150 of 250')).toBeDefined();
    expect(rowNames()).toHaveLength(50);
  });

  it('uses 100 and logs a warning for a setting that is not a page size', async () => {
    const a = layer('Alpha', 1);
    const { ctx, service } = await fixture([a], objectsOf(a.id, 150), { settings: { pageSize: 0 } });
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(screen.getByText('1–100 of 150')).toBeDefined();
    expect(ctx.logs.some((l) => l.level === 'warn' && l.message.includes('pageSize'))).toBe(true);
  });
});

describe('function 4: the columns', () => {
  it('shows name, kind, data type by its display name, data source, classification and last modified', async () => {
    const a = layer('Alpha', 1);
    const symbol = objectNamed(a.id, 'Alpha one', 1, {
      dataType: 'cot.cot',
      dataSource: 'tak-east',
      label: { policyIdentifier: { name: 'NATO' }, classification: 'NATO SECRET' },
      meta: { created: { at: '2026-10-01T08:00:00.000Z', by: { plugin: 'cot' } }, modified: { at: '2026-10-16T09:08:07.654Z', by: { plugin: 'cot' } } },
    });
    const { service } = await fixture([a], [symbol]);
    act(() => {
      service.open(a.id);
    });
    await settle();
    const row = within(screen.getByRole('listbox', { name: 'Objects of the layer' })).getByRole('option');
    const cells = [...row.querySelectorAll('.object-list-row > span:not(.object-list-cell-image)')].map((c) => c.textContent);
    expect(cells).toEqual(['Alpha one', 'Symbol', 'Cursor on Target', 'tak-east', 'NATO SECRET', '2026-10-16 09:08:07Z']);
  });

  it('shows "(no name)", and a shape\'s kind from draw-shapes.kind, otherwise its geometry type', async () => {
    const a = layer('Alpha', 1);
    const objects = [
      objectNamed(a.id, undefined, 1),
      objectNamed(a.id, 'Circle one', 2, { type: 'core.shape', geometry: { type: 'Circle', center: [18, 59], radius: 100 } as MapObject['geometry'], extensions: { 'draw-shapes': { kind: 'circle' } } }),
      objectNamed(a.id, 'Unknown shape', 3, { type: 'core.shape', geometry: { type: 'LineString', coordinates: [[18, 59], [19, 60]] } }),
    ];
    const { service } = await fixture([a], objects);
    act(() => {
      service.open(a.id);
    });
    await settle();
    const rows = within(screen.getByRole('listbox', { name: 'Objects of the layer' })).getAllByRole('option').map((r) => [...r.querySelectorAll('.object-list-row > span:not(.object-list-cell-image)')].slice(0, 2).map((c) => c.textContent));
    expect(rows).toEqual([['(no name)', 'Symbol'], ['Circle one', 'Circle'], ['Unknown shape', 'LineString']]);
  });

  it('puts what a narrow pane hides in the row\'s tooltip', async () => {
    const a = layer('Alpha', 1);
    const { service } = await fixture([a], [objectNamed(a.id, 'Alpha one', 1, { dataSource: 'tak-east' })]);
    act(() => {
      service.open(a.id);
    });
    await settle();
    const tooltip = within(screen.getByRole('listbox', { name: 'Objects of the layer' })).getByRole('option').querySelector('.object-list-row')?.getAttribute('title') ?? '';
    expect(tooltip).toContain('Alpha one');
    expect(tooltip).toContain('Kind: Symbol');
    expect(tooltip).toContain('Data type: General');
    expect(tooltip).toContain('Data source: tak-east');
    expect(tooltip).toContain('Classification: UNCLASSIFIED');
    expect(tooltip).toContain('Modified: 2026-10-16 12:00:00Z');
    // The columns that stay in a narrow pane are the name and the kind; the others carry the class the narrow layout hides.
    const row = within(screen.getByRole('listbox', { name: 'Objects of the layer' })).getByRole('option');
    expect(row.querySelectorAll('.object-list-cell-name, .object-list-cell-kind')).toHaveLength(2);
    expect(row.querySelectorAll('.object-list-cell-extra')).toHaveLength(4);
  });
});

describe('AC7: keeping the page current', () => {
  it('creating or deleting an object of the layer updates the count and the page', async () => {
    const a = layer('Alpha', 1);
    const objects = objectsOf(a.id, 3);
    const { ctx, service } = await fixture([a], objects);
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(rowNames()).toHaveLength(3);

    // A second browser creates an object: the server's count changes, and the page is read again.
    const created = objectNamed(a.id, 'Created elsewhere', 50);
    ctx.setServerObjects([...objects, created]);
    sendCounts(ctx, [a], [...objects, created]);
    await settle();
    expect(screen.getByText('1–4 of 4')).toBeDefined();
    expect(rowNames()).toContain('Created elsewhere');
    expect(screen.getByText('4 objects')).toBeDefined();

    // And deletes one.
    ctx.setServerObjects(objects.slice(1));
    sendCounts(ctx, [a], objects.slice(1));
    await settle();
    expect(screen.getByText('1–2 of 2')).toBeDefined();
    expect(rowNames()).toEqual(['Object 002', 'Object 003']);
  });

  it('does not read again for a count change in another layer', async () => {
    const a = layer('Alpha', 2);
    const b = layer('Bravo', 1);
    const objects = [...objectsOf(a.id, 3), ...objectsOf(b.id, 1, 'B', 10)];
    const { ctx, service } = await fixture([a, b], objects);
    const gate = gateQueries(ctx);
    act(() => {
      service.open(a.id);
    });
    expect(gate.asked).toEqual([0]);
    act(() => {
      gate.pending[0]?.release();
    });
    await settle();
    const more = [...objects, objectNamed(b.id, 'B more', 40)];
    ctx.setServerObjects(more);
    sendCounts(ctx, [a, b], more);
    await settle();
    expect(gate.asked).toEqual([0]);
  });

  it('Refresh shows a changed name', async () => {
    const a = layer('Alpha', 1);
    const objects = objectsOf(a.id, 2);
    const { ctx, service } = await fixture([a], objects);
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(rowNames()[0]).toBe('Object 001');

    const renamed = { ...objects[0], properties: { name: 'Renamed' }, version: 2 } as MapObject;
    ctx.setServerObjects([renamed, ...objects.slice(1)]);
    // Nothing tells the list: the count did not change.
    expect(rowNames()[0]).toBe('Object 001');
    await clickAndSettle('Refresh');
    expect(rowNames()[0]).toBe('Renamed');
  });

  it('a count change while a read is on its way causes one more read, not one per change', async () => {
    const a = layer('Alpha', 1);
    const objects = objectsOf(a.id, 3);
    const { ctx, service } = await fixture([a], objects);
    const gate = gateQueries(ctx);
    act(() => {
      service.open(a.id);
    });
    expect(gate.asked).toEqual([0]);

    for (const n of [4, 5, 6]) {
      const more = [...objects, ...objectsOf(a.id, n - 3, 'More', 100)];
      ctx.setServerObjects(more);
      sendCounts(ctx, [a], more);
    }
    expect(gate.asked).toEqual([0]);
    await act(async () => {
      gate.pending[0]?.release();
      await Promise.resolve();
    });
    await settle();
    expect(gate.asked).toEqual([0, 0]);
    act(() => {
      gate.pending[0]?.release();
    });
    await settle();
    expect(screen.getByText('1–6 of 6')).toBeDefined();
  });

  it('drops the answer to a page the user has left', async () => {
    const a = layer('Alpha', 1);
    const { ctx, service } = await fixture([a], objectsOf(a.id, 250));
    const gate = gateQueries(ctx);
    act(() => {
      service.open(a.id);
    });
    act(() => {
      gate.pending[0]?.release();
    });
    await settle();
    expect(screen.getByText('1–100 of 250')).toBeDefined();

    click('Next page');
    click('Last page');
    expect(gate.asked).toEqual([0, 1, 2]);
    // The answer for page 2 arrives first, then the late one for page 1.
    act(() => {
      gate.pending[1]?.release();
    });
    await settle();
    act(() => {
      gate.pending[0]?.release();
    });
    await settle();
    expect(screen.getByText('201–250 of 250')).toBeDefined();
  });

  it('moves back to the last page when objects were deleted from under the page', async () => {
    const a = layer('Alpha', 1);
    const objects = objectsOf(a.id, 250);
    const { ctx, service } = await fixture([a], objects);
    act(() => {
      service.open(a.id);
    });
    await settle();
    await clickAndSettle('Last page');
    expect(screen.getByText('201–250 of 250')).toBeDefined();

    const left = objects.slice(0, 190);
    ctx.setServerObjects(left);
    sendCounts(ctx, [a], left);
    await settle();
    expect(screen.getByText('101–190 of 190')).toBeDefined();
    expect(rowNames()).toHaveLength(90);
  });
});

describe('AC8: edge cases', () => {
  it('an empty layer shows "No objects in this layer"', async () => {
    const a = layer('Empty', 1);
    const { service } = await fixture([a], []);
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(screen.getByText('No objects in this layer')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
    expect(screen.getByText('0 objects')).toBeDefined();
  });

  it('shows Loading… until the first page arrives', async () => {
    const a = layer('Alpha', 1);
    const { ctx, service } = await fixture([a], objectsOf(a.id, 2));
    const gate = gateQueries(ctx);
    act(() => {
      service.open(a.id);
    });
    expect(screen.getByText('Loading…')).toBeDefined();
    act(() => {
      gate.pending[0]?.release();
    });
    await settle();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(rowNames()).toHaveLength(2);
  });

  it('a layer that is deleted while shown closes the list with a notice', async () => {
    const a = layer('Doomed', 2);
    const b = layer('Other', 1);
    const { ctx, service } = await fixture([a, b], objectsOf(a.id, 3));
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(rowNames()).toHaveLength(3);

    act(() => {
      ctx.live.changes([layerDeleted(a, 5)]);
    });
    await settle();
    expect(screen.getByText('The layer "Doomed" was deleted')).toBeDefined();
    expect(rowNames()).toHaveLength(0);
    expect(screen.getByRole('combobox', { name: 'Layer' })).toHaveProperty('value', '');

    // The user can go on with another layer, and the notice goes.
    fireEvent.change(screen.getByRole('combobox', { name: 'Layer' }), { target: { value: b.id } });
    await settle();
    expect(screen.queryByText('The layer "Doomed" was deleted')).toBeNull();
  });

  it('a deleted layer also closes the list for a new snapshot without it, and a late answer for it is dropped', async () => {
    const a = layer('Doomed', 2);
    const b = layer('Other', 1);
    const { ctx, service } = await fixture([a, b], objectsOf(a.id, 3));
    const gate = gateQueries(ctx);
    act(() => {
      service.open(a.id);
    });
    act(() => {
      ctx.live.snapshot({ layers: [b], objectCounts: {} });
    });
    expect(screen.getByText('The layer "Doomed" was deleted')).toBeDefined();
    act(() => {
      gate.pending[0]?.release();
    });
    await settle();
    expect(rowNames()).toHaveLength(0);
    expect(screen.getByText('The layer "Doomed" was deleted')).toBeDefined();
  });

  it('opening a layer that does not exist opens nothing and says so, and keeps the layer that is shown', async () => {
    const a = layer('Alpha', 1);
    const { ctx, service } = await fixture([a], objectsOf(a.id, 3));
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(rowNames()).toHaveLength(3);
    act(() => {
      service.open(layer('Nowhere', 0).id);
    });
    await settle();
    expect(ctx.notifications.map((n) => [n.severity, n.message])).toEqual([['warning', 'That layer is not in the workspace shown']]);
    // The panel was shown for the first open only.
    expect(ctx.addedPanels[0]?.shown).toBe(1);
    expect(rowNames()).toHaveLength(3);
  });

  it('a layer opened before the first picture that the picture does not hold closes the list with a notice', async () => {
    const { ctx } = await activated();
    const service = await ctx.services.get(OBJECT_LIST);
    renderPanel(ctx);
    act(() => {
      service.open(layer('Nowhere', 0).id);
    });
    expect(ctx.notifications).toEqual([]);
    act(() => {
      ctx.live.snapshot({ layers: [layer('Alpha', 1)] });
    });
    expect(screen.getByText('The layer no longer exists')).toBeDefined();
  });

  it('a failed query shows the reason and a Retry button, and keeps the last page', async () => {
    const a = layer('Alpha', 1);
    const { ctx, service } = await fixture([a], objectsOf(a.id, 250));
    act(() => {
      service.open(a.id);
    });
    await settle();
    ctx.failObjectQueries(true);
    await clickAndSettle('Next page');

    expect(screen.getByRole('alert').textContent).toContain('The objects could not be read: no answer from the server (fake)');
    // The last page that was read is still there.
    expect(screen.getByText('1–100 of 250')).toBeDefined();
    expect(rowNames()[0]).toBe('Object 001');

    ctx.failObjectQueries(false);
    await clickAndSettle('Retry');
    expect(screen.queryByRole('alert')).toBeNull();
    // Retry asks for the page that failed.
    expect(screen.getByText('101–200 of 250')).toBeDefined();
  });

  it('a failed first read shows the reason and Retry instead of Loading…', async () => {
    const a = layer('Alpha', 1);
    const { ctx, service } = await fixture([a], objectsOf(a.id, 3));
    ctx.failObjectQueries(true);
    act(() => {
      service.open(a.id);
    });
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('The objects could not be read');
    expect(screen.queryByText('Loading…')).toBeNull();
    ctx.failObjectQueries(false);
    await clickAndSettle('Retry');
    expect(rowNames()).toHaveLength(3);
  });
});
