/**
 * SDK 1.8.0 (CR-0043 part B; T-202, the UXA's design, ADR-0056): a panel's foot, chips and picture
 * tiles. Their structure is the SDK's; their look (`components.css`) is the UXA's.
 *
 * @example
 * <PanelFoot status={unsaved > 0 ? `${unsaved} unsaved changes` : undefined}>
 *   <Button onClick={revert}>Revert</Button>
 *   <Button variant="primary" onClick={apply}>Apply</Button>
 * </PanelFoot>
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, CircleX, Dot, Info, TriangleAlert } from 'lucide-react';
import type { IconComponent } from '../workspace.ts';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

/**
 * A bar a panel puts last in its body (the UXA's "Saving: one rule"; findings P5): its actions on the
 * right, e.g. Apply, Draw or Place, and an optional status on the left, e.g. "2 unsaved changes".
 * The shell's panel body keeps it pinned to the panel's bottom edge while the body scrolls (CDA,
 * T-203).
 */
export function PanelFoot(props: { readonly children: ReactNode; readonly status?: string }): ReactNode {
  return (
    <div className="emc2-panel-foot" role="group" aria-label="Panel actions">
      {props.status === undefined ? null : <span className="emc2-panel-foot-status" role="status">{props.status}</span>}
      <div className="emc2-panel-foot-actions">{props.children}</div>
    </div>
  );
}

/** A chip's tone (CR-0043 part B): the state it shows. */
export type ChipTone = 'ok' | 'warning' | 'error' | 'info' | 'neutral';

/** Each tone's default icon: a check, a triangle, a circle with a cross, an i and a dot. */
export const CHIP_ICONS: Readonly<Record<ChipTone, IconComponent>> = Object.freeze({
  ok: Check, warning: TriangleAlert, error: CircleX, info: Info, neutral: Dot,
});

/**
 * A state as an icon and a word, never a colour alone (ADR-0056 point 5; findings L3), e.g. in the
 * Monitor. `ok`, `warning` and `error` take their colour tokens, `info` the accent and `neutral` the
 * muted text.
 */
export function Chip(props: { readonly tone: ChipTone; readonly label: string; readonly icon?: IconComponent; readonly title?: string }): ReactNode {
  const Svg = props.icon ?? CHIP_ICONS[props.tone];
  return (
    <span className={cx('emc2-chip', `emc2-chip-${props.tone}`)} title={props.title}>
      <Svg className="emc2-icon" aria-hidden="true" focusable="false" />
      <span className="emc2-chip-label">{props.label}</span>
    </span>
  );
}

/** A picture tile (CR-0043 part B; findings P3): an image with its label under it. */
export interface Tile {
  readonly id: string;
  readonly label: string;
  /** The picture, e.g. a graphic's or a symbol's image. */
  readonly image: ReactNode;
  /** A tooltip, e.g. the full name or why the tile is disabled. */
  readonly title?: string;
  readonly disabled?: boolean;
}

/** A folding group of tiles, with its heading. */
export interface TileGroup {
  readonly id: string;
  readonly label: string;
  readonly tiles: readonly Tile[];
  /** SDK 1.8.0 part G (CR-0043, owner XD A): the group starts closed, also when it joins the grid later. */
  readonly closed?: boolean;
}

/**
 * Where the focus goes from tile `index` of `count` on `key`, or null for a key the grid leaves alone:
 * the keys as `List`'s (CR-0019), Left and Up the previous tile, Right and Down the next, Home and End
 * the first and last.
 */
export function nextTile(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowLeft': case 'ArrowUp': return Math.max(0, index - 1);
    case 'ArrowRight': case 'ArrowDown': return Math.min(count - 1, index + 1);
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/**
 * A grid of picture tiles, one selected (CR-0043 part B; `draw-tactical`'s Graphics, findings P3).
 * One Tab stop: the selected tile, else the first; the arrow keys, Home and End move the focus
 * ({@link nextTile}); Enter or Space selects the focused tile. With `groups`, each group folds under
 * its heading, open at first unless it says `closed` (part G), each group's tiles a listbox of their own with the heading outside it;
 * a search field is the panel's own.
 */
export function TileGrid(props: {
  readonly label: string;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
  readonly tiles?: readonly Tile[];
  readonly groups?: readonly TileGroup[];
}): ReactNode {
  const groups: readonly TileGroup[] = props.groups ?? [{ id: '', label: '', tiles: props.tiles ?? [] }];
  // the groups the user opened or closed against how they start (part G: `closed`)
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const closed = new Set(groups.filter((g) => (g.closed === true) !== toggled.has(g.id)).map((g) => g.id));
  const shown = groups.flatMap((g) => (closed.has(g.id) ? [] : g.tiles));
  const selectedIndex = shown.findIndex((t) => t.id === props.selected);
  const [focused, setFocused] = useState<string | null>(null);
  // one Tab stop: the tile that had the focus last, else the selected one, else the first
  const focusedIndex = focused === null ? -1 : shown.findIndex((t) => t.id === focused);
  const focusIndex = focusedIndex >= 0 ? focusedIndex : selectedIndex >= 0 ? selectedIndex : 0;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const onKey = (event: KeyboardEvent, index: number, tile: Tile) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (tile.disabled !== true) props.onSelect(tile.id);
      return;
    }
    const next = nextTile(event.key, index, shown.length);
    if (next === null) return;
    event.preventDefault();
    const target = shown[next];
    if (target === undefined) return;
    setFocused(target.id);
    refs.current.get(target.id)?.focus();
  };
  const toggle = (id: string) => setToggled((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="emc2-tiles" role="group" aria-label={props.label}>
      {groups.map((g) => (
        <div key={g.id} className="emc2-tile-group">
          {props.groups === undefined ? null : (
            <button type="button" className="emc2-tile-group-head" aria-expanded={!closed.has(g.id)} onClick={() => toggle(g.id)}>{g.label}</button>
          )}
          {closed.has(g.id) ? null : (
            <div className="emc2-tile-grid" role="listbox" aria-label={g.label === '' ? props.label : g.label}>
              {g.tiles.map((tile) => {
                const index = shown.indexOf(tile);
                return (
                  <button
                    key={tile.id}
                    type="button"
                    role="option"
                    aria-selected={tile.id === props.selected}
                    aria-disabled={tile.disabled === true ? true : undefined}
                    tabIndex={index === focusIndex ? 0 : -1}
                    className={cx('emc2-tile', tile.id === props.selected && 'emc2-tile-selected')}
                    title={tile.title}
                    ref={(node) => { if (node === null) refs.current.delete(tile.id); else refs.current.set(tile.id, node); }}
                    onFocus={() => setFocused(tile.id)}
                    onClick={() => { if (tile.disabled !== true) props.onSelect(tile.id); }}
                    onKeyDown={(event) => onKey(event, index, tile)}
                  >
                    <span className="emc2-tile-image" aria-hidden="true">{tile.image}</span>
                    <span className="emc2-tile-label">{tile.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
