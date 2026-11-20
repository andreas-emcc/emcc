// Draw order arithmetic (brief, function 2). Higher drawOrder is drawn on top; ties are broken by
// id, the higher id on top (layer schema, map-view-2d brief). Pure functions.
import type { Layer, LayerContent, Uuid } from '@emc2/plugin-sdk';

/** Sorts layers top of the draw order first: by drawOrder, then by id, both descending. */
export function topFirst(layers: readonly Layer[]): Layer[] {
  return [...layers].sort((a, b) => b.drawOrder - a.drawOrder || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** One layer's new drawOrder. */
export interface DrawOrderChange {
  readonly layer: Layer;
  readonly drawOrder: number;
}

/**
 * The drawOrder changes that move a layer to `newIndex` (top first) in `layers`, which must be
 * sorted with {@link topFirst}. Normally only the moved layer changes: it gets the midpoint between
 * its new neighbours, or one more than the top or one less than the bottom. If no such value fits
 * strictly between the neighbours (floating-point limit, or neighbours with equal drawOrder), all
 * layers are renumbered 0…n-1 in the new order, and only those whose value changes are returned.
 * Returns nothing if the layer is unknown or already there.
 */
export function planMove(layers: readonly Layer[], layerId: Uuid, newIndex: number): DrawOrderChange[] {
  const from = layers.findIndex((l) => l.id === layerId);
  const moved = layers[from];
  if (moved === undefined) return [];
  const to = Math.max(0, Math.min(layers.length - 1, Math.trunc(newIndex)));
  if (to === from) return [];

  const order = layers.filter((l) => l.id !== layerId);
  order.splice(to, 0, moved);
  const above = order[to - 1];
  const below = order[to + 1];
  const candidate = between(above?.drawOrder, below?.drawOrder);
  if (candidate !== null) return [{ layer: moved, drawOrder: candidate }];
  return renumbered(order);
}

/** A value strictly between the two, or null if there is none. Absent means open-ended. */
function between(above: number | undefined, below: number | undefined): number | null {
  const value =
    above !== undefined && below !== undefined ? below + (above - below) / 2
    : above !== undefined ? above - 1
    : below !== undefined ? below + 1
    : 0;
  const fits = Number.isFinite(value) && (above === undefined || value < above) && (below === undefined || value > below);
  return fits ? value : null;
}

function renumbered(order: readonly Layer[]): DrawOrderChange[] {
  return order
    .map((layer, index) => ({ layer, drawOrder: order.length - 1 - index }))
    .filter((change) => change.drawOrder !== change.layer.drawOrder);
}

/** The drawOrder for a new layer on top. */
export function drawOrderOnTop(layers: readonly Layer[]): number {
  const top = layers[0];
  return top === undefined ? 0 : top.drawOrder + 1;
}

/** "Layer N", with N one more than the highest number in a name of that form (brief, function 5). */
export function nextLayerName(layers: readonly Layer[]): string {
  let highest = 0;
  for (const layer of layers) {
    const match = /^Layer (\d+)$/.exec(layer.name);
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]));
  }
  return `Layer ${String(highest + 1)}`;
}

/**
 * The complete content of a layer, as an update sends it (model rule 5), with some fields replaced.
 * It carries the layer's own `workspace` as stored, or none for a View layer, never another one
 * (brief, function 17). It carries `locked` only when the lock is switched, so that a rename or a
 * move keeps the stored lock (function 22; SDK 1.3.0).
 */
export function contentOf(layer: Layer, replace: Partial<Pick<LayerContent, 'name' | 'drawOrder' | 'locked'>> = {}): LayerContent {
  const { workspace, name, drawOrder, visible, label, extensions } = layer;
  return {
    ...(workspace !== undefined ? { workspace } : {}),
    name: replace.name ?? name,
    drawOrder: replace.drawOrder ?? drawOrder,
    visible,
    label,
    ...(extensions !== undefined ? { extensions } : {}),
    ...(replace.locked !== undefined ? { locked: replace.locked } : {}),
  };
}
