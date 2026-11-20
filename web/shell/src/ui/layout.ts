/**
 * The View tab's layout (ADR-0031 point 4): which pane holds each panel and in what order, the panes'
 * sizes, what is collapsed and the bottom pane's tab. Plain data, changed only by the functions here,
 * so that the setups (`setups/setups.ts`) save and restore it as it is. Panels are named by their plugin and
 * their own id (`<plugin>/<panel>`), which stays the same from one start to the next.
 *
 * A panel without a place of the user's is in its default pane, in the order of the panels' `order`.
 * Once the user moves or reorders a panel, its pane keeps the user's sequence; panels added later
 * come after it.
 */
import type { Density, Pane } from '@emc2/plugin-sdk';

export type { Pane };

export const PANES: readonly Pane[] = ['left', 'right', 'bottom'];

/** The panes' accessible names; the right pane keeps the name it had before the panes. */
export const PANE_NAMES: Readonly<Record<Pane, string>> = { left: 'Left pane', right: 'Control Pane', bottom: 'Bottom pane' };

/** How far one arrow key on a pane's handle moves its edge, in CSS pixels. */
export const KEY_STEP = 16;

export interface PaneLayout {
  /**
   * Width of a side pane, height of the bottom pane, in CSS pixels, as the user set it; null until
   * the user resizes it: then it has the density's default (looks.md; owner, 2026-10-17).
   */
  readonly size: number | null;
  readonly collapsed: boolean;
}

export interface Layout {
  readonly panes: Readonly<Record<Pane, PaneLayout>>;
  /** The pane the user put a panel in, by panel id. */
  readonly placed: Readonly<Record<string, Pane>>;
  /** Per pane, the user's sequence of panel ids; empty until the user moved or reordered one there. */
  readonly sequence: Readonly<Record<Pane, readonly string[]>>;
  /**
   * The ids of the panels the user expanded (left and right panes). Every other panel there is
   * collapsed: panels start collapsed (T-153; owner, 2026-11-10).
   */
  readonly expanded: readonly string[];
  /** The bottom pane's tab; the first panel there if null or gone. */
  readonly bottomTab: string | null;
}

/** The panes' default sizes per density (looks.md, "Density"). */
export const DENSITY_SIZES: Readonly<Record<Density, Readonly<Record<Pane, number>>>> = {
  compact: { left: 248, right: 288, bottom: 170 },
  comfortable: { left: 268, right: 312, bottom: 188 },
};
/** The compact density's, which every pane had before the densities came. */
export const DEFAULT_SIZES: Readonly<Record<Pane, number>> = DENSITY_SIZES.compact;
export const MIN_SIZE = 160;
/** A pane takes at most this share of the window's width (side) or height (bottom). */
export const MAX_SHARE = 0.6;
/** The map keeps at least this width beside the side panes (conformance review F1). */
export const MIN_MAP_WIDTH = 320;
/** The width of a collapsed side pane's strip. */
export const STRIP = 32;

export const DEFAULT_LAYOUT: Layout = {
  panes: {
    left: { size: null, collapsed: false },
    right: { size: null, collapsed: false },
    bottom: { size: null, collapsed: false },
  },
  placed: {},
  sequence: { left: [], right: [], bottom: [] },
  expanded: [],
  bottomTab: null,
};

/** What the layout needs to know of a registered panel. */
export interface Placeable {
  /** `<plugin>/<panel>`. */
  readonly id: string;
  readonly defaultPane: Pane;
  readonly order: number;
  /** Registration order, for equal `order`. */
  readonly seq: number;
}

export function paneOf(layout: Layout, panel: Placeable): Pane {
  return layout.placed[panel.id] ?? panel.defaultPane;
}

/** The panels in one pane, in their order: the user's sequence first, then the others by `order`. */
export function panelsIn<P extends Placeable>(layout: Layout, panels: readonly P[], pane: Pane): P[] {
  const here = panels.filter((p) => paneOf(layout, p) === pane)
    .sort((a, b) => a.order - b.order || a.seq - b.seq);
  const sequence = layout.sequence[pane];
  if (sequence.length === 0) return here;
  const rank = new Map(sequence.map((id, i) => [id, i]));
  const ranked = here.filter((p) => rank.has(p.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...ranked, ...here.filter((p) => !rank.has(p.id))];
}

/** The panel in the bottom pane whose tab is shown. */
export function bottomTabOf<P extends Placeable>(layout: Layout, panels: readonly P[]): P | null {
  const bottom = panelsIn(layout, panels, 'bottom');
  return bottom.find((p) => p.id === layout.bottomTab) ?? bottom[0] ?? null;
}

/** Moves a panel to the end of another pane. */
export function movePanel(layout: Layout, panels: readonly Placeable[], id: string, to: Pane): Layout {
  const panel = panels.find((p) => p.id === id);
  if (panel === undefined || paneOf(layout, panel) === to) return layout;
  const from = paneOf(layout, panel);
  const target = panelsIn(layout, panels, to).map((p) => p.id);
  return {
    ...layout,
    placed: { ...layout.placed, [id]: to },
    sequence: {
      ...layout.sequence,
      [from]: layout.sequence[from].filter((x) => x !== id),
      [to]: [...target, id],
    },
    bottomTab: to === 'bottom' ? id : layout.bottomTab,
  };
}

/** Moves a panel one place earlier (-1) or later (+1) within its pane; in the bottom pane it stays the tab shown. */
export function shiftPanel(layout: Layout, panels: readonly Placeable[], id: string, by: -1 | 1): Layout {
  const panel = panels.find((p) => p.id === id);
  if (panel === undefined) return layout;
  const pane = paneOf(layout, panel);
  const ids = panelsIn(layout, panels, pane).map((p) => p.id);
  const at = ids.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= ids.length) return layout;
  const next = [...ids];
  next.splice(at, 1);
  next.splice(to, 0, id);
  return { ...layout, sequence: { ...layout.sequence, [pane]: next }, bottomTab: pane === 'bottom' ? id : layout.bottomTab };
}

/** Whether a panel of the left or right pane is collapsed: unless the user expanded it (T-153). */
export function isPanelCollapsed(layout: Layout, id: string): boolean {
  return !layout.expanded.includes(id);
}

export function setPanelCollapsed(layout: Layout, id: string, collapsed: boolean): Layout {
  if (isPanelCollapsed(layout, id) === collapsed) return layout;
  return { ...layout, expanded: collapsed ? layout.expanded.filter((x) => x !== id) : [...layout.expanded, id] };
}

export function setPaneCollapsed(layout: Layout, pane: Pane, collapsed: boolean): Layout {
  if (layout.panes[pane].collapsed === collapsed) return layout;
  return { ...layout, panes: { ...layout.panes, [pane]: { ...layout.panes[pane], collapsed } } };
}

/** The size, kept between {@link MIN_SIZE} and `max` (never below {@link MIN_SIZE}). */
export function clampSize(size: number, max: number): number {
  return Math.round(Math.max(MIN_SIZE, Math.min(size, max)));
}

/** The window's size, which panes are on the page (a pane without panels is not), and the density's default sizes. */
export interface Room {
  readonly width: number;
  readonly height: number;
  readonly shown: Readonly<Record<Pane, boolean>>;
  /** The default sizes of panes the user has not resized; the compact ones if not given. */
  readonly defaults?: Readonly<Record<Pane, number>>;
}

/** A pane's size before fitting: the user's, else the density's default. */
const sizeOf = (layout: Layout, pane: Pane, room: Room): number => layout.panes[pane].size ?? (room.defaults ?? DEFAULT_SIZES)[pane];

/** How wide a side pane is on the page: its size, a collapsed strip, or nothing. */
const takes = (layout: Layout, pane: 'left' | 'right', room: Room, size: number) =>
  !room.shown[pane] ? 0 : layout.panes[pane].collapsed ? STRIP : size;

/**
 * The largest size a pane may take now: a side pane at most {@link MAX_SHARE} of the window's width,
 * and leaving {@link MIN_MAP_WIDTH} beside the other side pane as it is shown; the bottom pane at
 * most {@link MAX_SHARE} of the window's height.
 */
export function maxSize(layout: Layout, pane: Pane, room: Room): number {
  if (pane === 'bottom') return Math.max(MIN_SIZE, Math.floor(room.height * MAX_SHARE));
  const other = pane === 'left' ? 'right' : 'left';
  const otherSize = fittedSizes(layout, room)[other];
  return Math.max(MIN_SIZE, Math.floor(Math.min(room.width * MAX_SHARE, room.width - MIN_MAP_WIDTH - takes(layout, other, room, otherSize))));
}

/**
 * The sizes the panes are shown at in this room. The layout keeps the user's sizes, so that they come
 * back when the window grows again (and a setup saved on a larger screen fits a smaller one); what is
 * shown is fitted: each side pane at most {@link MAX_SHARE} of the width, and together they leave the
 * map {@link MIN_MAP_WIDTH}, the right pane giving way first.
 */
export function fittedSizes(layout: Layout, room: Room): Readonly<Record<Pane, number>> {
  const share = Math.floor(room.width * MAX_SHARE);
  let left = clampSize(sizeOf(layout, 'left', room), share);
  let right = clampSize(sizeOf(layout, 'right', room), share);
  right = clampSize(right, room.width - MIN_MAP_WIDTH - takes(layout, 'left', room, left));
  left = clampSize(left, room.width - MIN_MAP_WIDTH - takes(layout, 'right', room, right));
  return { left, right, bottom: clampSize(sizeOf(layout, 'bottom', room), Math.floor(room.height * MAX_SHARE)) };
}

/** Sets a pane's size, kept between {@link MIN_SIZE} and {@link maxSize} for this room. */
export function setPaneSize(layout: Layout, pane: Pane, size: number, room: Room): Layout {
  const clamped = clampSize(size, maxSize(layout, pane, room));
  if (layout.panes[pane].size === clamped) return layout;
  return { ...layout, panes: { ...layout.panes, [pane]: { ...layout.panes[pane], size: clamped } } };
}

export function selectBottomTab(layout: Layout, id: string): Layout {
  return layout.bottomTab === id ? layout : { ...layout, bottomTab: id };
}

/** The largest pane size a saved layout may bring; what is shown is fitted to the window anyway. */
const MAX_SAVED_SIZE = 10_000;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPane = (value: unknown): value is Pane => value === 'left' || value === 'right' || value === 'bottom';
const strings = (value: unknown): readonly string[] | null =>
  Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null;

/**
 * A layout as a setup saved it (part 7), or null if it is not one: a setup comes from the server and
 * may have been written by another version. Panels it names that are not registered are kept, so
 * that they find their place when their plugin runs again. A layout saved before T-153 lists the
 * panels the user collapsed instead of those expanded: its panels all start collapsed, once (owner,
 * 2026-11-10).
 */
export function layoutFromJson(value: unknown): Layout | null {
  if (!isRecord(value) || !isRecord(value.panes) || !isRecord(value.placed) || !isRecord(value.sequence)) return null;
  const panes: Partial<Record<Pane, PaneLayout>> = {};
  const sequence: Partial<Record<Pane, readonly string[]>> = {};
  for (const pane of PANES) {
    const saved = value.panes[pane];
    if (!isRecord(saved)) return null;
    const size = saved.size;
    if ((size !== null && (typeof size !== 'number' || !Number.isFinite(size))) || typeof saved.collapsed !== 'boolean') return null;
    // A size equal to the compact default was saved before the densities came: not resized.
    const own = typeof size === 'number' && size !== DEFAULT_SIZES[pane] ? Math.round(Math.max(MIN_SIZE, Math.min(size, MAX_SAVED_SIZE))) : null;
    panes[pane] = { size: own, collapsed: saved.collapsed };
    const ids = strings(value.sequence[pane]);
    if (ids === null) return null;
    sequence[pane] = ids;
  }
  const placed = Object.entries(value.placed);
  const expanded = 'expanded' in value ? strings(value.expanded) : strings(value.collapsed) === null ? null : [];
  if (!placed.every(([, pane]) => isPane(pane)) || expanded === null) return null;
  if (value.bottomTab !== null && typeof value.bottomTab !== 'string') return null;
  return {
    panes: panes as Record<Pane, PaneLayout>,
    placed: Object.fromEntries(placed) as Record<string, Pane>,
    sequence: sequence as Record<Pane, readonly string[]>,
    expanded,
    bottomTab: value.bottomTab,
  };
}

/** `PanelHandle.show()`: its pane and the panel expanded, and in the bottom pane its tab chosen. */
export function showPanel(layout: Layout, panels: readonly Placeable[], id: string): Layout {
  const panel = panels.find((p) => p.id === id);
  if (panel === undefined) return layout;
  const pane = paneOf(layout, panel);
  let next = setPaneCollapsed(layout, pane, false);
  next = setPanelCollapsed(next, id, false);
  return pane === 'bottom' ? selectBottomTab(next, id) : next;
}
