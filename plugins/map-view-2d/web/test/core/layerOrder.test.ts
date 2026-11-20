import { describe, expect, it } from 'vitest';
import { orderLayers, stackIndex } from '../../src/core/layerOrder.ts';
import { layer } from '../fixtures.ts';

describe('layer order (criterion 5)', () => {
  it('draws layers in drawOrder order, higher on top', () => {
    const ordered = orderLayers([layer(1, 30), layer(2, -5), layer(3, 10)]);
    expect(ordered.map((l) => l.drawOrder)).toEqual([-5, 10, 30]);
  });

  it('breaks ties by id, the higher id on top', () => {
    const ordered = orderLayers([layer(9, 1), layer(3, 1), layer(5, 1)]);
    expect(ordered.map((l) => l.id)).toEqual([layer(3).id, layer(5).id, layer(9).id]);
  });

  it('reorders when a layer changes its drawOrder', () => {
    const a = layer(1, 1);
    const b = layer(2, 2);
    expect(stackIndex([a, b]).get(a.id)).toBe(0);
    const raised = { ...a, drawOrder: 3 };
    expect(stackIndex([raised, b]).get(a.id)).toBe(1);
    expect(stackIndex([raised, b]).get(b.id)).toBe(0);
  });
});
