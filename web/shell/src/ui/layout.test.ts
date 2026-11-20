import { describe, expect, it } from 'vitest';
import {
  bottomTabOf, clampSize, DEFAULT_LAYOUT, fittedSizes, isPanelCollapsed, layoutFromJson, maxSize, MIN_MAP_WIDTH, MIN_SIZE, movePanel, panelsIn, selectBottomTab, setPaneCollapsed, setPaneSize,
  setPanelCollapsed, shiftPanel, showPanel, STRIP, type Layout, type Placeable, type Room,
} from './layout.ts';

const room = (width: number, height = 800, shown: Partial<Room['shown']> = {}): Room => ({
  width, height, shown: { left: true, right: true, bottom: true, ...shown },
});

let seq = 0;
const panel = (id: string, defaultPane: Placeable['defaultPane'], order = 100): Placeable => ({ id, defaultPane, order, seq: ++seq });
const ids = (layout: Layout, panels: readonly Placeable[], pane: Placeable['defaultPane']) => panelsIn(layout, panels, pane).map((p) => p.id);

describe('the layout of the panes', () => {
  const panels = [panel('layers/list', 'left'), panel('draw/symbols', 'right', 50), panel('coords/go', 'right'), panel('core-shell/status', 'right', 10_000),
    panel('objects/table', 'bottom'), panel('log/lines', 'bottom', 20)];

  it('puts each panel in its default pane, by order and then as registered', () => {
    expect(ids(DEFAULT_LAYOUT, panels, 'left')).toEqual(['layers/list']);
    expect(ids(DEFAULT_LAYOUT, panels, 'right')).toEqual(['draw/symbols', 'coords/go', 'core-shell/status']);
    expect(ids(DEFAULT_LAYOUT, panels, 'bottom')).toEqual(['log/lines', 'objects/table']);
    expect(bottomTabOf(DEFAULT_LAYOUT, panels)?.id).toBe('log/lines');
  });

  it('moves a panel to the end of another pane, and there it is the bottom tab', () => {
    let layout = movePanel(DEFAULT_LAYOUT, panels, 'draw/symbols', 'left');
    expect(ids(layout, panels, 'left')).toEqual(['layers/list', 'draw/symbols']);
    expect(ids(layout, panels, 'right')).toEqual(['coords/go', 'core-shell/status']);
    layout = movePanel(layout, panels, 'layers/list', 'bottom');
    expect(ids(layout, panels, 'bottom')).toEqual(['log/lines', 'objects/table', 'layers/list']);
    expect(bottomTabOf(layout, panels)?.id).toBe('layers/list');
    expect(movePanel(layout, panels, 'layers/list', 'bottom')).toBe(layout); // already there
    expect(movePanel(layout, panels, 'gone/x', 'left')).toBe(layout);
  });

  it('moves a panel up and down within its pane, not past either end', () => {
    let layout = shiftPanel(DEFAULT_LAYOUT, panels, 'core-shell/status', -1);
    expect(ids(layout, panels, 'right')).toEqual(['draw/symbols', 'core-shell/status', 'coords/go']);
    layout = shiftPanel(layout, panels, 'core-shell/status', -1);
    expect(ids(layout, panels, 'right')).toEqual(['core-shell/status', 'draw/symbols', 'coords/go']);
    expect(shiftPanel(layout, panels, 'core-shell/status', -1)).toBe(layout);
    expect(shiftPanel(layout, panels, 'coords/go', 1)).toBe(layout);
    const shifted = shiftPanel(layout, panels, 'objects/table', -1);
    expect(ids(shifted, panels, 'bottom')).toEqual(['objects/table', 'log/lines']);
    expect(bottomTabOf(shifted, panels)?.id).toBe('objects/table'); // the tab moved stays the one shown
    expect(bottomTabOf(shiftPanel(DEFAULT_LAYOUT, panels, 'log/lines', 1), panels)?.id).toBe('log/lines');
  });

  it("keeps the user's order, and puts panels registered later after it", () => {
    const layout = shiftPanel(DEFAULT_LAYOUT, panels, 'coords/go', -1);
    const more = [...panels, panel('bookmarks/tree', 'right', 1)];
    expect(ids(layout, more, 'right')).toEqual(['coords/go', 'draw/symbols', 'core-shell/status', 'bookmarks/tree']);
    // A panel the user placed comes back where it was once its plugin registers it again.
    const moved = movePanel(DEFAULT_LAYOUT, panels, 'coords/go', 'left');
    const again = [...panels.filter((p) => p.id !== 'coords/go'), panel('coords/go', 'right')];
    expect(ids(moved, again, 'left')).toEqual(['layers/list', 'coords/go']);
  });

  it('collapses panels and panes, and keeps each pane between its least and largest size', () => {
    // Panels start collapsed (T-153); the layout keeps those the user expanded.
    expect(isPanelCollapsed(DEFAULT_LAYOUT, 'coords/go')).toBe(true);
    expect(setPanelCollapsed(DEFAULT_LAYOUT, 'coords/go', true)).toBe(DEFAULT_LAYOUT);
    const open = setPanelCollapsed(DEFAULT_LAYOUT, 'coords/go', false);
    expect(open.expanded).toEqual(['coords/go']);
    expect(isPanelCollapsed(open, 'coords/go')).toBe(false);
    expect(isPanelCollapsed(open, 'draw/symbols')).toBe(true);
    let layout = setPanelCollapsed(open, 'coords/go', true);
    expect(layout.expanded).toEqual([]);
    layout = setPaneCollapsed(layout, 'left', true);
    expect(layout.panes.left.collapsed).toBe(true);
    expect(setPaneSize(layout, 'right', 400, room(1000)).panes.right.size).toBe(400);
    expect(setPaneSize(layout, 'right', 50, room(1000)).panes.right.size).toBe(MIN_SIZE);
    // At most 60 % of the window, and the map keeps its width beside the left pane's strip.
    expect(setPaneSize(layout, 'right', 1500, room(2000)).panes.right.size).toBe(1200);
    expect(setPaneSize(layout, 'right', 900, room(1000)).panes.right.size).toBe(600);
    expect(setPaneSize(layout, 'right', 900, room(800)).panes.right.size).toBe(800 - MIN_MAP_WIDTH - STRIP);
    expect(setPaneSize(layout, 'bottom', 900, room(1000, 500)).panes.bottom.size).toBe(300);
    expect(clampSize(500, 100)).toBe(MIN_SIZE); // a tiny window still leaves the least size
    const sized = setPaneSize(layout, 'right', 300, room(1000));
    expect(setPaneSize(sized, 'right', 300, room(1000))).toBe(sized);
  });

  it('never lets the side panes take the map: their sizes are fitted to the window, the right pane giving way first', () => {
    // Both at 60 % of a wide window: fine there.
    let layout = setPaneSize(DEFAULT_LAYOUT, 'left', 600, room(1000, 800, { right: false }));
    expect(layout.panes.left.size).toBe(600);
    expect(maxSize(layout, 'right', room(2000))).toBe(2000 - MIN_MAP_WIDTH - 600);
    expect(maxSize(layout, 'right', room(1000))).toBe(MIN_SIZE); // never below the least size
    layout = setPaneSize(layout, 'right', 600, room(3000));
    expect(fittedSizes(layout, room(3000))).toEqual({ left: 600, right: 600, bottom: 170 });
    // The window shrinks: the map keeps its width, the user's sizes stay for when it grows again.
    expect(fittedSizes(layout, room(1200))).toEqual({ left: 600, right: 1200 - MIN_MAP_WIDTH - 600, bottom: 170 });
    expect(fittedSizes(layout, room(900))).toEqual({ left: 900 - MIN_MAP_WIDTH - MIN_SIZE, right: MIN_SIZE, bottom: 170 });
    expect(layout.panes.right.size).toBe(600);
    // A collapsed or absent pane takes only its strip, or nothing.
    expect(fittedSizes(setPaneCollapsed(layout, 'left', true), room(800)).right).toBe(800 - MIN_MAP_WIDTH - STRIP);
    expect(fittedSizes(layout, room(700, 800, { left: false })).right).toBe(700 - MIN_MAP_WIDTH);
    expect(fittedSizes(layout, room(1000, 200)).bottom).toBe(MIN_SIZE);
  });

  it('show() expands the pane and the panel, and in the bottom pane chooses its tab', () => {
    let layout = setPaneCollapsed(DEFAULT_LAYOUT, 'right', true);
    layout = showPanel(layout, panels, 'coords/go');
    expect(layout.panes.right.collapsed).toBe(false);
    expect(layout.expanded).toEqual(['coords/go']);
    layout = showPanel(setPaneCollapsed(layout, 'bottom', true), panels, 'objects/table');
    expect(layout.panes.bottom.collapsed).toBe(false);
    expect(bottomTabOf(layout, panels)?.id).toBe('objects/table');
    expect(showPanel(layout, panels, 'gone/x')).toBe(layout);
  });

  it('falls back to the first bottom panel when the chosen tab is gone', () => {
    const layout = selectBottomTab(DEFAULT_LAYOUT, 'objects/table');
    expect(bottomTabOf(layout, panels)?.id).toBe('objects/table');
    expect(bottomTabOf(layout, panels.filter((p) => p.id !== 'objects/table'))?.id).toBe('log/lines');
    expect(bottomTabOf(layout, [])).toBeNull();
  });
});

describe('a layout from a saved setup', () => {
  const saved: Layout = {
    panes: { left: { size: 300, collapsed: true }, right: { size: 290, collapsed: false }, bottom: { size: null, collapsed: false } },
    placed: { 'layers/list': 'bottom', 'gone/panel': 'left' },
    sequence: { left: [], right: [], bottom: ['objects/table', 'layers/list'] },
    expanded: ['coords/go'],
    bottomTab: 'layers/list',
  };

  it('is read back as it was saved, panels of plugins not running included', () => {
    expect(layoutFromJson(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(layoutFromJson(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)))).toEqual(DEFAULT_LAYOUT);
  });

  it('collapses every panel, once, in a layout saved before panels started collapsed (T-153)', () => {
    const rest = Object.fromEntries(Object.entries(saved).filter(([key]) => key !== 'expanded'));
    expect(layoutFromJson(JSON.parse(JSON.stringify({ ...rest, collapsed: ['draw/symbols'] })))).toEqual({ ...saved, expanded: [] });
    expect(layoutFromJson(JSON.parse(JSON.stringify(rest))), 'neither list').toBeNull();
  });

  it("reads a size equal to the compact default, saved before the densities came, as not resized: it follows the density", () => {
    const old = layoutFromJson({ ...saved, panes: { ...saved.panes, right: { size: 288, collapsed: false }, bottom: { size: 170, collapsed: false } } });
    expect([old?.panes.right.size, old?.panes.bottom.size, old?.panes.left.size]).toEqual([null, null, 300]);
  });

  it('keeps sizes within reason; what is shown is fitted to the window anyway', () => {
    const sized = (size: number) => layoutFromJson({ ...saved, panes: { ...saved.panes, left: { size, collapsed: false } } })?.panes.left.size;
    expect(sized(12.6)).toBe(MIN_SIZE);
    expect(sized(1e9)).toBe(10_000);
    expect(sized(300.4)).toBe(300);
  });

  it('is null for anything that is not a layout', () => {
    const broken: unknown[] = [
      null, 'layout', [], {},
      { ...saved, panes: { left: saved.panes.left, right: saved.panes.right } },
      { ...saved, panes: { ...saved.panes, bottom: { size: 'wide', collapsed: false } } },
      { ...saved, panes: { ...saved.panes, bottom: { size: 200, collapsed: 'no' } } },
      { ...saved, placed: { 'layers/list': 'top' } },
      { ...saved, sequence: { ...saved.sequence, left: [1] } },
      { ...saved, expanded: 'coords/go' },
      { ...saved, expanded: undefined, collapsed: 'coords/go' },
      { ...saved, bottomTab: 3 },
    ];
    for (const value of broken) expect(layoutFromJson(JSON.parse(JSON.stringify(value)) as unknown)).toBeNull();
  });
});
