/**
 * Layer order (brief function 4): ordered by `drawOrder`, higher on top; ties broken by id, the
 * higher id on top. Ids are compared as plain strings (UUIDs in lowercase canonical form).
 */
import type { Layer, Uuid } from '@emc2/plugin-sdk';

/** The layers bottom first. */
export function orderLayers(layers: Iterable<Layer>): Layer[] {
  return [...layers].sort((a, b) => a.drawOrder - b.drawOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A stacking index per layer: 0 for the bottom layer, increasing upwards. */
export function stackIndex(layers: Iterable<Layer>): Map<Uuid, number> {
  return new Map(orderLayers(layers).map((layer, index) => [layer.id, index]));
}
