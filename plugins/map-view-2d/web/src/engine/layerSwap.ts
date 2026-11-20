/**
 * Swapping the WebGL style without a blank frame (T-200; brief function 33).
 *
 * In OpenLayers 10.10 `setStyle` on a WebGL layer throws its renderer away. The new renderer draws nothing until it has
 * loaded the style's images and built its buffers in a worker, and with the old layer's symbols gone that is a blank
 * layer for a moment. So the style is not set on the layer in use: a **second layer** with the new style is added next to
 * it, on the same source and in the same WebGL canvas, the old layer goes on drawing, and when the new one has its buffers
 * and has drawn a frame the old one is taken away. This class decides when; the engine does the layers (`LayerSwapPort`).
 */

/** What the swap needs of the engine's layers. `L` is the engine's layer type. */
export interface LayerSwapPort<L> {
  /** A new layer with the new style for the layer `id`, added to the map next to the old one; it draws nothing until it is ready. */
  add(id: string): L;
  /** Whether the new layer has its buffers, so that its next frame draws its objects (not merely that it has none to make). */
  ready(layer: L): boolean;
  /** Puts the new layer in place of the old one for `id`, and takes the old one away. */
  replace(id: string, next: L): void;
  /** Takes a new layer away that is not used after all (the swap was cancelled). */
  discard(next: L): void;
}

/** After how many rendered frames a swap is given up when a new layer is still not ready (the view is moving, or the browser never says): the old layers stay and the engine tries again. */
export const SWAP_MAX_FRAMES = 600;

export class LayerSwap<L> {
  private readonly next = new Map<string, L>();
  private readyFrames = 0;
  private frames = 0;
  private open = true;

  /** Adds the new layers at once. `done` is called once when the layers have been replaced, `giveUp` when the swap was given up (the new layers are gone then). */
  constructor(
    private readonly port: LayerSwapPort<L>,
    ids: readonly string[],
    private readonly done: () => void,
    private readonly giveUp: () => void = () => undefined,
  ) {
    for (const id of ids) this.next.set(id, port.add(id));
  }

  /** Whether the swap is still going on. */
  get busy(): boolean {
    return this.open;
  }

  /** The ids whose layers are being replaced. */
  get ids(): readonly string[] {
    return [...this.next.keys()];
  }

  /**
   * Call after each rendered frame. When every new layer has been ready for one frame, its objects have been drawn
   * in that frame, so the old layers are taken away and `done` is called.
   */
  frame(): void {
    if (!this.open) return;
    this.frames++;
    const allReady = [...this.next.values()].every((layer) => this.port.ready(layer));
    this.readyFrames = allReady ? this.readyFrames + 1 : 0;
    if (this.readyFrames >= 2) this.finish();
    else if (this.frames >= SWAP_MAX_FRAMES) {
      this.cancel();
      this.giveUp();
    }
  }

  /** The layer `id` is gone from the engine: its new layer is not needed. */
  drop(id: string): void {
    const layer = this.next.get(id);
    if (layer === undefined) return;
    this.next.delete(id);
    this.port.discard(layer);
    if (this.open && this.next.size === 0) this.finish();
  }

  /** Gives the swap up: the new layers are taken away and the old ones stay. */
  cancel(): void {
    if (!this.open) return;
    this.open = false;
    for (const layer of this.next.values()) this.port.discard(layer);
    this.next.clear();
  }

  private finish(): void {
    this.open = false;
    for (const [id, layer] of this.next) this.port.replace(id, layer);
    this.next.clear();
    this.done();
  }
}
