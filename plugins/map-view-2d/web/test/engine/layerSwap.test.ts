import { describe, expect, it } from 'vitest';
import { LayerSwap, SWAP_MAX_FRAMES, type LayerSwapPort } from '../../src/engine/layerSwap.ts';

interface Fake {
  readonly id: string;
  ready: boolean;
}

function mark(layer: Fake | undefined, ready = true): void {
  if (layer === undefined) throw new Error('no layer');
  layer.ready = ready;
}

function setup(ids: readonly string[] = ['a', 'b']) {
  const added: Fake[] = [];
  const replaced: string[] = [];
  const discarded: Fake[] = [];
  const port: LayerSwapPort<Fake> = {
    add: (id) => {
      const layer = { id, ready: false };
      added.push(layer);
      return layer;
    },
    ready: (layer) => layer.ready,
    replace: (id) => {
      replaced.push(id);
    },
    discard: (layer) => {
      discarded.push(layer);
    },
  };
  let done = 0;
  let gaveUp = 0;
  const swap = new LayerSwap(port, ids, () => {
    done++;
  }, () => {
    gaveUp++;
  });
  return { swap, added, replaced, discarded, done: () => done, gaveUp: () => gaveUp };
}

describe('layer swap (T-200: the style is swapped without a blank frame)', () => {
  it('adds a new layer for each layer at once, and replaces nothing before they are ready', () => {
    const { swap, added, replaced, done } = setup();
    expect(added.map((l) => l.id)).toEqual(['a', 'b']);
    expect(swap.busy).toBe(true);
    for (let i = 0; i < 20; i++) swap.frame();
    expect(replaced).toEqual([]);
    expect(done()).toBe(0);
  });

  it('replaces the layers when every new layer has been ready for one frame: its objects were drawn in that frame', () => {
    const { swap, added, replaced, done } = setup();
    mark(added[0]);
    swap.frame();
    swap.frame(); // b is not ready
    expect(replaced).toEqual([]);
    mark(added[1]);
    swap.frame(); // the first frame with both ready: they draw in the next
    expect(replaced).toEqual([]);
    swap.frame();
    expect(replaced).toEqual(['a', 'b']);
    expect(done()).toBe(1);
    expect(swap.busy).toBe(false);
    swap.frame();
    expect(done()).toBe(1); // once
  });

  it('starts counting again when a layer is not ready in a frame (its buffers are made again)', () => {
    const { swap, added, replaced } = setup(['a']);
    mark(added[0]);
    swap.frame();
    mark(added[0], false);
    swap.frame();
    mark(added[0]);
    swap.frame();
    expect(replaced).toEqual([]);
    swap.frame();
    expect(replaced).toEqual(['a']);
  });

  it('gives up after a number of frames when a layer is still not ready (the view moves, or the browser never says): the new layers go, the old ones stay', () => {
    const { swap, added, discarded, replaced, done, gaveUp } = setup(['a']);
    for (let i = 0; i < SWAP_MAX_FRAMES - 1; i++) swap.frame();
    expect(gaveUp()).toBe(0);
    swap.frame();
    expect(gaveUp()).toBe(1);
    expect(discarded).toEqual(added);
    expect(replaced).toEqual([]);
    expect(done()).toBe(0);
    expect(swap.busy).toBe(false);
  });

  it('drops the new layer of a layer that is gone, and is done when none is left', () => {
    const { swap, added, discarded, replaced, done } = setup();
    swap.drop('a');
    expect(discarded).toEqual([added[0]]);
    expect(swap.ids).toEqual(['b']);
    mark(added[1]);
    swap.frame();
    swap.frame();
    expect(replaced).toEqual(['b']);
    const second = setup(['x']);
    second.swap.drop('x');
    expect(second.done()).toBe(1);
    expect(done()).toBe(1);
  });

  it('can be given up: the new layers go and nothing is replaced or done', () => {
    const { swap, added, discarded, replaced, done } = setup();
    swap.cancel();
    expect(discarded).toEqual(added);
    expect(swap.busy).toBe(false);
    added.forEach((l) => (l.ready = true));
    swap.frame();
    swap.frame();
    expect(replaced).toEqual([]);
    expect(done()).toBe(0);
    swap.cancel();
    expect(discarded).toHaveLength(2); // once
  });
});
