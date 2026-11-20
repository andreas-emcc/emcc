import { describe, expect, it } from 'vitest';
import { boxAt, distanceToSegment, pickAt, type PickCandidate } from '../../src/core/pick.ts';
import { uuid } from '../fixtures.ts';

const box = (n: number, stack: number, order: number, x: number, y: number, size = 30): PickCandidate => ({
  kind: 'box', id: uuid(n), stack, order, left: x - size / 2, top: y - size / 2, right: x + size / 2, bottom: y + size / 2, at: [x, y],
});

/** A text object's box, 100 by 40 pixels at (200, 200), turned `angle` radians clockwise. */
const quad = (n: number, angle: number, stack = 0, order = 0): PickCandidate => {
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const corners = ([[-50, -20], [50, -20], [50, 20], [-50, 20]] as const).map(([dx, dy]): [number, number] => [200 + dx * cos - dy * sin, 200 + dx * sin + dy * cos]);
  return { kind: 'quad', id: uuid(n), stack, order, corners, at: [200, 200] };
};

describe('pick: a text object\'s box (brief function 45)', () => {
  it('is hit anywhere inside the box, and within the tolerance outside it', () => {
    expect(pickAt([quad(1, 0)], [200, 200])).toEqual([uuid(1)]);
    expect(pickAt([quad(1, 0)], [245, 215])).toEqual([uuid(1)]); // near a corner, inside
    expect(pickAt([quad(1, 0)], [254, 200], 0)).toEqual([]);
    expect(pickAt([quad(1, 0)], [254, 200])).toEqual([uuid(1)]); // 4 px outside, the default tolerance 5
    expect(pickAt([quad(1, 0)], [200, 230], 0)).toEqual([]);
  });

  it('follows the turn: a point inside the unturned box is outside when it is turned 90 degrees, and the other way round', () => {
    const turned = Math.PI / 2;
    expect(pickAt([quad(1, 0)], [240, 200], 0)).toEqual([uuid(1)]);
    expect(pickAt([quad(1, turned)], [240, 200], 0)).toEqual([]);
    expect(pickAt([quad(1, turned)], [200, 240], 0)).toEqual([uuid(1)]);
    expect(pickAt([quad(1, 0)], [200, 240], 0)).toEqual([]);
  });

  it('is taken by a selection box that holds its position, crosses its edge or lies wholly inside it, and not by one beside it', () => {
    const select = (from: [number, number], to: [number, number]) => boxAt([quad(1, 0.4)], { from, to });
    expect(select([190, 190], [210, 210])).toEqual([uuid(1)]);
    expect(select([0, 0], [400, 400])).toEqual([uuid(1)]);
    expect(select([240, 0], [260, 400])).toEqual([uuid(1)]); // across the box's right end
    expect(select([198, 198], [202, 202])).toEqual([uuid(1)]); // wholly inside the box, as a symbol's position is in it
    expect(select([0, 0], [100, 100])).toEqual([]);
    expect(select([300, 300], [400, 400])).toEqual([]);
  });
});

describe('pick (criterion 6)', () => {
  it('returns the topmost object first: higher layer first, then the one drawn later', () => {
    const candidates = [box(1, 0, 5, 100, 100), box(2, 2, 0, 105, 100), box(3, 2, 7, 95, 100), box(4, 1, 9, 100, 102)];
    expect(pickAt(candidates, [100, 100])).toEqual([uuid(3), uuid(2), uuid(4), uuid(1)]);
  });

  it('honours the tolerance in pixels', () => {
    const candidates = [box(1, 0, 0, 100, 100, 10)];
    expect(pickAt(candidates, [108, 100], 0)).toEqual([]);
    expect(pickAt(candidates, [108, 100], 3)).toEqual([uuid(1)]);
    expect(pickAt(candidates, [108, 100])).toEqual([uuid(1)]); // default 5
  });

  it('hits circles, lines and the outline of an area, its holes included', () => {
    const candidates: PickCandidate[] = [
      { kind: 'circle', id: uuid(1), stack: 0, order: 0, center: [10, 10], radius: 4 },
      { kind: 'line', id: uuid(2), stack: 0, order: 1, pixels: [[0, 50], [100, 50]], width: 2 },
      {
        kind: 'polygon', id: uuid(3), stack: 0, order: 2, width: 1,
        rings: [[[200, 200], [300, 200], [300, 300], [200, 300], [200, 200]], [[240, 240], [260, 240], [260, 260], [240, 260], [240, 240]]],
      },
    ];
    expect(pickAt(candidates, [16, 10], 2)).toEqual([uuid(1)]);
    expect(pickAt(candidates, [50, 54], 3)).toEqual([uuid(2)]);
    expect(pickAt(candidates, [50, 58], 3)).toEqual([]);
    expect(pickAt(candidates, [220, 220], 0)).toEqual([]); // inside the area, away from every outline
    expect(pickAt(candidates, [250, 250], 0)).toEqual([]); // inside the hole
    expect(pickAt(candidates, [250, 200], 0)).toEqual([uuid(3)]); // on the outline
    expect(pickAt(candidates, [240, 250], 1)).toEqual([uuid(3)]); // on the hole's edge
  });

  it('picks an area by its outline only, filled or not: a click inside passes through to what lies under it (criterion 54)', () => {
    const ring: [number, number][] = [[100, 100], [300, 100], [300, 300], [100, 300], [100, 100]];
    const candidates: PickCandidate[] = [
      box(1, 0, 0, 200, 200), // a symbol inside the area, in a lower layer
      { kind: 'polygon', id: uuid(2), stack: 1, order: 0, rings: [ring], width: 2 },
      { kind: 'line', id: uuid(3), stack: 0, order: 1, pixels: [[150, 250], [250, 250]], width: 2 }, // a line under the area
    ];
    expect(pickAt(candidates, [200, 200])).toEqual([uuid(1)]); // the symbol, not the area
    expect(pickAt(candidates, [200, 250])).toEqual([uuid(3)]);
    expect(pickAt(candidates, [160, 160])).toEqual([]); // empty map inside the area
    expect(pickAt(candidates, [200, 100])).toEqual([uuid(2)]); // the outline
    expect(pickAt(candidates, [200, 101], 0)).toEqual([uuid(2)]); // within half the outline's width (2 px: 1 px each side)
    expect(pickAt(candidates, [200, 103], 0)).toEqual([]);
    expect(pickAt(candidates, [200, 105])).toEqual([uuid(2)]); // within the pick tolerance of 5 px
  });

  it('measures the distance to a segment', () => {
    expect(distanceToSegment([0, 0], [10, 0], [5, 3])).toBe(3);
    expect(distanceToSegment([0, 0], [10, 0], [13, 4])).toBe(5);
    expect(distanceToSegment([2, 2], [2, 2], [5, 6])).toBe(5);
  });
});

describe('selection box (brief function 14, criterion 26)', () => {
  const box = { from: [200, 100], to: [100, 200] } as const; // dragged from the top right to the bottom left
  const line = (n: number, pixels: [number, number][], stack = 0, order = 0): PickCandidate => ({ kind: 'line', id: uuid(n), stack, order, pixels, width: 2 });
  const area = (n: number, ring: [number, number][]): PickCandidate => ({ kind: 'polygon', id: uuid(n), stack: 0, order: 0, rings: [ring], width: 2 });
  const symbol = (n: number, x: number, y: number, stack = 0, order = 0): PickCandidate =>
    ({ kind: 'box', id: uuid(n), stack, order, left: x - 15, top: y - 30, right: x + 15, bottom: y, at: [x, y] });

  it("takes a symbol by its drawn position, not by its image: an image reaching in does not count", () => {
    expect(boxAt([symbol(1, 150, 150)], box)).toEqual([uuid(1)]);
    expect(boxAt([symbol(2, 150, 220)], box)).toEqual([]); // its image's top edge (y 190) is in the box
    expect(boxAt([{ kind: 'circle', id: uuid(3), stack: 0, order: 0, center: [100, 200], radius: 4 }], box)).toEqual([uuid(3)]); // on the edge
  });

  it('takes a line whose path crosses the box, also with no point inside', () => {
    expect(boxAt([line(1, [[50, 150], [250, 150]])], box)).toEqual([uuid(1)]);
    expect(boxAt([line(2, [[50, 50], [250, 250]])], box)).toEqual([uuid(2)]); // diagonally through
    expect(boxAt([line(3, [[50, 50], [250, 50], [250, 250]])], box)).toEqual([]); // around it
    expect(boxAt([line(4, [[90, 50], [90, 250]])], box)).toEqual([]); // beside it
    expect(boxAt([line(5, [[150, 150]])], box)).toEqual([uuid(5)]); // a single point
  });

  it('takes an area by its outline only: a box wholly inside an area does not select it (owner, 2026-10-16)', () => {
    expect(boxAt([area(1, [[0, 0], [300, 0], [300, 300], [0, 300], [0, 0]])], box)).toEqual([]);
    expect(boxAt([area(2, [[150, 150], [300, 150], [300, 300], [150, 150]])], box)).toEqual([uuid(2)]);
    expect(boxAt([area(3, [[50, 120], [250, 120], [250, 300], [50, 300], [50, 120]])], box)).toEqual([uuid(3)]); // its top edge crosses
  });

  it('lists the ids topmost first, each once', () => {
    const ids = boxAt([symbol(1, 150, 150, 0, 9), symbol(2, 160, 150, 2, 0), symbol(3, 140, 150, 2, 4), line(2, [[0, 150], [300, 150]], 2, 0)], box);
    expect(ids).toEqual([uuid(3), uuid(2), uuid(1)]);
  });
});
