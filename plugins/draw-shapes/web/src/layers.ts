// The layers, from the subscription `{ objects: false }` (brief, function 7): the layer list for the
// edit panel's Layer field and the check that the active layer exists. No objects come with it.
// A snapshot replaces everything (it can come at any time); a layer change event is applied only if
// it is newer than what is known.
import type { ChangeEvent, Layer, Snapshot, Unsubscribe, Uuid } from '@emc2/plugin-sdk';

export class LayerTracker {
  private layerById = new Map<Uuid, Layer>();
  private sorted: readonly Layer[] = [];
  private readonly listeners = new Set<() => void>();

  onChange(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The layers, top first: a higher `drawOrder` is on top, and the higher id wins a tie. */
  get layers(): readonly Layer[] {
    return this.sorted;
  }

  snapshot(snapshot: Snapshot): void {
    this.layerById = new Map(snapshot.layers.map((l) => [l.id, l]));
    this.resort();
    this.emit();
  }

  changes(batch: readonly ChangeEvent[]): void {
    let changed = false;
    for (const event of batch) {
      if (event.entityType !== 'layer') continue;
      const known = this.layerById.get(event.entityId);
      if (known !== undefined && event.version <= known.version) continue;
      if (event.state === null) this.layerById.delete(event.entityId);
      else this.layerById.set(event.entityId, event.state as Layer);
      changed = true;
    }
    if (!changed) return;
    this.resort();
    this.emit();
  }

  private resort(): void {
    this.sorted = [...this.layerById.values()].sort((a, b) => b.drawOrder - a.drawOrder || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
