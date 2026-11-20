// Acceptance criteria 3, 4, 6, 11, 12 and 13 of docs/plugins/briefs/object-list.md: the shared
// selection, the object action menu on rows, the double-click, the symbol image, and the list
// without a map view. The action handlers themselves (Edit, Delete, Centre on, Zoom to) belong to
// other plugins and the shell; here the list is checked to open the menu for the right objects.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SELECTION, uuidv7 } from '@emc2/plugin-sdk';
import type { MapObject, SymbolService, Uuid } from '@emc2/plugin-sdk';
import { createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import { SELECTION_FULL } from '../src/controller.ts';
import { fixture, layer, objectNamed, objectsOf, settle } from './helpers.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rows(): HTMLElement[] {
  return within(screen.getByRole('listbox', { name: 'Objects of the layer' })).getAllByRole('option');
}

/** The row of an object, found by its name. */
function row(name: string): HTMLElement {
  const found = rows().find((r) => r.querySelector('.object-list-cell-name')?.textContent === name);
  if (!found) throw new Error(`no row ${name}`);
  return found;
}

function selectedNames(): string[] {
  return rows().filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => r.querySelector('.object-list-cell-name')?.textContent ?? '');
}

async function opened(objects: (layerId: Uuid) => MapObject[], options: Parameters<typeof fixture>[2] = {}) {
  const l = layer('Alpha', 1);
  const all = objects(l.id);
  const f = await fixture([l], all, options);
  act(() => {
    f.service.open(l.id);
  });
  await settle();
  return { ...f, layer: l, objects: all };
}

describe('AC3: the rows share the map\'s selection', () => {
  it('a click selects the object on the map and replaces the selection', async () => {
    const { map, objects } = await opened((id) => objectsOf(id, 4));
    if (!map) throw new Error('no map');
    fireEvent.click(row('Object 002'));
    expect(map.selection.value).toEqual([objects[1]?.id]);
    expect(selectedNames()).toEqual(['Object 002']);

    fireEvent.click(row('Object 003'));
    expect(map.selection.value).toEqual([objects[2]?.id]);
    expect(selectedNames()).toEqual(['Object 003']);
  });

  it('Ctrl+click adds and removes, and Cmd+click does the same', async () => {
    const { map, objects } = await opened((id) => objectsOf(id, 4));
    if (!map) throw new Error('no map');
    fireEvent.click(row('Object 001'));
    fireEvent.click(row('Object 003'), { ctrlKey: true });
    expect(map.selection.value).toEqual([objects[0]?.id, objects[2]?.id]);
    expect(selectedNames()).toEqual(['Object 001', 'Object 003']);

    fireEvent.click(row('Object 004'), { metaKey: true });
    expect(selectedNames()).toEqual(['Object 001', 'Object 003', 'Object 004']);

    fireEvent.click(row('Object 001'), { ctrlKey: true });
    expect(map.selection.value).toEqual([objects[2]?.id, objects[3]?.id]);
    expect(selectedNames()).toEqual(['Object 003', 'Object 004']);

    // A plain click replaces it all again.
    fireEvent.click(row('Object 002'));
    expect(selectedNames()).toEqual(['Object 002']);
  });

  it('selecting on the map highlights the row, also for objects set by another plugin', async () => {
    const { map, objects } = await opened((id) => objectsOf(id, 4));
    if (!map) throw new Error('no map');
    expect(selectedNames()).toEqual([]);
    act(() => {
      map.selection.set([objects[1]?.id as Uuid, objects[3]?.id as Uuid]);
    });
    expect(selectedNames()).toEqual(['Object 002', 'Object 004']);
    act(() => {
      map.selection.set([]);
    });
    expect(selectedNames()).toEqual([]);
  });

  it('shows the highlight of a selection that was made before the list opened', async () => {
    const l = layer('Alpha', 1);
    const objects = objectsOf(l.id, 3);
    const f = await fixture([l], objects);
    f.map?.selection.set([objects[0]?.id as Uuid]);
    // The plugin attaches to the map view on activation; a selection made later reaches it as an event.
    act(() => {
      f.service.open(l.id);
    });
    await settle();
    expect(selectedNames()).toEqual(['Object 001']);
  });

  it('keeps ids of objects the list does not show when a row is added or removed', async () => {
    const elsewhere = [uuidv7(1), uuidv7(2)];
    const { map, objects } = await opened((id) => objectsOf(id, 3));
    if (!map) throw new Error('no map');
    act(() => {
      map.selection.set(elsewhere);
    });
    fireEvent.click(row('Object 002'), { ctrlKey: true });
    expect(map.selection.value).toEqual([...elsewhere, objects[1]?.id]);
    fireEvent.click(row('Object 002'), { ctrlKey: true });
    expect(map.selection.value).toEqual(elsewhere);
  });

  it('adds nothing past 1 000 objects, with a notice; a plain click still replaces', async () => {
    const full = Array.from({ length: MAX_SELECTION }, (_, i) => uuidv7(1000 + i));
    const { ctx, map } = await opened((id) => objectsOf(id, 3));
    if (!map) throw new Error('no map');
    act(() => {
      map.selection.set(full);
    });
    fireEvent.click(row('Object 001'), { ctrlKey: true });
    expect(map.selection.value).toHaveLength(MAX_SELECTION);
    expect(map.selection.value).toEqual(full);
    expect(ctx.notifications).toEqual([{ severity: 'warning', message: SELECTION_FULL }]);
    expect(SELECTION_FULL).toContain('1000');

    // Removing still works at the limit, and so does replacing.
    act(() => {
      map.selection.set([...full.slice(0, MAX_SELECTION - 1), ...[]]);
    });
    fireEvent.click(row('Object 001'), { ctrlKey: true });
    expect(map.selection.value).toHaveLength(MAX_SELECTION);
    fireEvent.click(row('Object 002'));
    expect(selectedNames()).toEqual(['Object 002']);
    expect(map.selection.value).toHaveLength(1);
  });

  it('puts no selection through the SDK\'s silent cut: the list never sets more than 1 000', async () => {
    const full = Array.from({ length: MAX_SELECTION }, (_, i) => uuidv7(1000 + i));
    const { map } = await opened((id) => objectsOf(id, 2));
    if (!map) throw new Error('no map');
    act(() => {
      map.selection.set(full);
    });
    const before = map.selectionWarnings;
    fireEvent.click(row('Object 001'), { ctrlKey: true });
    expect(map.selectionWarnings).toBe(before);
  });
});

describe('AC4: the shell\'s object action menu on rows', () => {
  it('a right click on a selected row of a selection of 3 offers the actions for the 3 objects', async () => {
    const { ctx, map, objects } = await opened((id) => objectsOf(id, 5));
    if (!map) throw new Error('no map');
    const three = [objects[0]?.id as Uuid, objects[2]?.id as Uuid, objects[4]?.id as Uuid];
    act(() => {
      map.selection.set(three);
    });
    fireEvent.contextMenu(row('Object 003'), { clientX: 120, clientY: 45 });
    expect(ctx.openedMenus).toEqual([{ at: [120, 45], target: { objects: three } }]);
    expect(map.selection.value).toEqual(three);
  });

  it('applies to the whole selection, also with objects the list does not show', async () => {
    const elsewhere = uuidv7(7);
    const { ctx, map, objects } = await opened((id) => objectsOf(id, 2));
    if (!map) throw new Error('no map');
    act(() => {
      map.selection.set([elsewhere, objects[0]?.id as Uuid]);
    });
    fireEvent.contextMenu(row('Object 001'), { clientX: 1, clientY: 2 });
    expect(ctx.openedMenus.at(-1)?.target).toEqual({ objects: [elsewhere, objects[0]?.id] });
  });

  it('on an unselected row, that row becomes the selection first', async () => {
    const { ctx, map, objects } = await opened((id) => objectsOf(id, 5));
    if (!map) throw new Error('no map');
    act(() => {
      map.selection.set([objects[0]?.id as Uuid, objects[1]?.id as Uuid]);
    });
    fireEvent.contextMenu(row('Object 004'), { clientX: 30, clientY: 40 });
    expect(map.selection.value).toEqual([objects[3]?.id]);
    expect(selectedNames()).toEqual(['Object 004']);
    expect(ctx.openedMenus).toEqual([{ at: [30, 40], target: { objects: [objects[3]?.id] } }]);
  });

  it('opens the shell\'s menu instead of the browser\'s', async () => {
    await opened((id) => objectsOf(id, 1));
    const notPrevented = fireEvent.contextMenu(row('Object 001'));
    expect(notPrevented).toBe(false);
  });
});

describe('AC6 and AC12: Centre on and Zoom to, and the double-click', () => {
  it('a double-click zooms the map to the object, also when the map did not hold it', async () => {
    const { map, objects } = await opened((id) => objectsOf(id, 3));
    if (!map) throw new Error('no map');
    // The map has no copy of this object (outside its area, or in a cluster): zoomTo fetches it. Lon ≠ lat.
    map.setObjectPositions({ [objects[1]?.id as Uuid]: [21.5, 52.25] });
    fireEvent.doubleClick(row('Object 002'));
    await settle();
    expect(map.zoomToCalls).toEqual([[objects[1]?.id]]);
    expect(map.viewport.center).toEqual([21.5, 52.25]);
    expect(map.centreOnCalls).toEqual([]);
  });

  it('says so when the object is gone or cannot be shown', async () => {
    const { ctx, map } = await opened((id) => objectsOf(id, 2));
    if (!map) throw new Error('no map');
    // The fake map knows no object's position, as for an object that was deleted meanwhile.
    map.setObjectPositions({});
    const before = map.viewport.center;
    fireEvent.doubleClick(row('Object 001'));
    await settle();
    expect(ctx.notifications).toEqual([{ severity: 'warning', message: 'The object is gone or cannot be shown on this map' }]);
    expect(map.viewport.center).toEqual(before);
  });

  it('shows an error when the map view cannot zoom', async () => {
    const { ctx, map } = await opened((id) => objectsOf(id, 2));
    if (!map) throw new Error('no map');
    map.zoomTo = () => Promise.reject(new Error('the map failed'));
    fireEvent.doubleClick(row('Object 001'));
    await settle();
    expect(ctx.notifications).toEqual([{ severity: 'error', message: 'The map could not zoom to the object' }]);
  });

  it('opens the menu for objects the map does not hold, so Centre on and Zoom to can fetch them', async () => {
    const { ctx, objects } = await opened((id) => objectsOf(id, 2));
    fireEvent.contextMenu(row('Object 002'), { clientX: 5, clientY: 6 });
    expect(ctx.openedMenus.at(-1)?.target).toEqual({ objects: [objects[1]?.id] });
  });
});

describe('AC11: the list changes nothing itself', () => {
  it('sends no change request and registers no action of its own', async () => {
    const { ctx, objects } = await opened((id) => objectsOf(id, 4));
    fireEvent.click(row('Object 001'));
    fireEvent.click(row('Object 002'), { ctrlKey: true });
    fireEvent.contextMenu(row('Object 003'), { clientX: 1, clientY: 1 });
    fireEvent.doubleClick(row('Object 004'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(objects).toHaveLength(4);
    expect(ctx.submitted).toEqual([]);
    expect(ctx.objectActions).toEqual([]);
    expect(ctx.mapActions).toEqual([]);
  });
});

describe('AC13: without a map view', () => {
  it('lists and pages, but rows cannot be selected or zoomed to, and the menu has no map actions', async () => {
    const { ctx, objects } = await opened((id) => objectsOf(id, 3), { withMapView: false });
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(screen.getByText('1–3 of 3')).toBeDefined();
    fireEvent.click(row('Object 001'));
    fireEvent.click(row('Object 002'), { ctrlKey: true });
    fireEvent.doubleClick(row('Object 003'));
    await settle();
    expect(selectedNames()).toEqual([]);
    expect(ctx.notifications).toEqual([]);

    // The menu still opens, for the row alone: there is no selection to widen it to.
    fireEvent.contextMenu(row('Object 003'), { clientX: 9, clientY: 8 });
    expect(ctx.openedMenus).toEqual([{ at: [9, 8], target: { objects: [objects[2]?.id] } }]);
  });

  it('with draw-shapes absent, a shape shows its geometry type as the kind', async () => {
    await opened((id) => [objectNamed(id, 'A line', 1, { type: 'core.shape', geometry: { type: 'LineString', coordinates: [[18, 59], [19, 60]] } })]);
    expect(row('A line').querySelector('.object-list-cell-kind')?.textContent).toBe('LineString');
  });
});

describe('the symbol image (function 4)', () => {
  const SYMBOL = { standard: 'APP-6D', sidc: '10031000001211000000' } as const;

  function stubCanvas(): { drawImage: ReturnType<typeof vi.fn> } {
    const context = { clearRect: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    return context;
  }

  function recording(): { symbols: SymbolService; sizes: number[] } {
    const symbols = createFakeSymbolService();
    const sizes: number[] = [];
    const render = symbols.render.bind(symbols);
    return {
      sizes,
      symbols: {
        ...symbols,
        render(request) {
          sizes.push(request.size);
          return render(request);
        },
      },
    };
  }

  it('draws a symbol\'s image at the size of the row, and leaves other objects without one', async () => {
    const context = stubCanvas();
    const { symbols, sizes } = recording();
    await opened(
      (id) => [objectNamed(id, 'A symbol', 1, { symbol: SYMBOL }), objectNamed(id, 'A shape', 2, { type: 'core.shape' })],
      { withSymbols: true, symbols },
    );
    expect(row('A symbol').querySelector('canvas.object-list-image')).not.toBeNull();
    expect(row('A shape').querySelector('canvas')).toBeNull();
    // The fake's compact row is 26 px: the image is a little smaller.
    expect(sizes).toEqual([22]);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });

  it('follows the density', async () => {
    stubCanvas();
    const { symbols, sizes } = recording();
    const { ctx } = await opened((id) => [objectNamed(id, 'A symbol', 1, { symbol: SYMBOL })], { withSymbols: true, symbols });
    expect(sizes.at(-1)).toBe(22);
    act(() => {
      ctx.changeTheme({ density: 'comfortable' }, { sizeRow: '34px' });
    });
    expect(sizes.at(-1)).toBe(30);
    expect(row('A symbol').querySelector('canvas')?.width).toBe(30);
  });

  it('works without a symbol service: the rows have no image, and nothing else is missing', async () => {
    const { ctx } = await opened((id) => [objectNamed(id, 'A symbol', 1, { symbol: SYMBOL })]);
    expect(row('A symbol').querySelector('canvas')).toBeNull();
    expect(screen.getByText('1–1 of 1')).toBeDefined();
    expect(ctx.statusHistory.at(-1)?.state).toBe('OK');
  });

  it('leaves the cell empty for a symbol the service cannot draw', async () => {
    stubCanvas();
    const symbols = createFakeSymbolService();
    symbols.render = () => {
      throw new Error('no such symbol');
    };
    await opened((id) => [objectNamed(id, 'A symbol', 1, { symbol: SYMBOL })], { withSymbols: true, symbols });
    expect(row('A symbol').querySelector('canvas')).toBeNull();
  });
});
