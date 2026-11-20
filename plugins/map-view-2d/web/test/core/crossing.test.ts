import { describe, expect, it } from 'vitest';
import { areaOf, fillFaces, fillFacesWithHoles, type XY } from '../../src/core/crossing.ts';

const BOW_TIE: XY[] = [[0, 0], [4, 4], [4, 0], [0, 4]]; // crosses itself at (2, 2)
/** A five-pointed star drawn in one stroke: its five edges cross in the middle. */
const STAR: XY[] = [0, 2, 4, 1, 3].map((k): XY => [100 * Math.cos(((-90 + 72 * k) * Math.PI) / 180), 100 * Math.sin(((-90 + 72 * k) * Math.PI) / 180)]);

/** Whether a point is inside any loop (the union of the loops). */
function inside(loops: readonly (readonly XY[])[], [x, y]: XY): boolean {
  return loops.some((loop) => {
    let in_ = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i] as XY;
      const b = loop[j] as XY;
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) in_ = !in_;
    }
    return in_;
  });
}

describe('fillFaces (T-111: the fill of a polygon whose outline crosses itself)', () => {
  it('gives nothing for a ring that does not cross itself', () => {
    expect(fillFaces([[0, 0], [4, 0], [4, 4], [0, 4]])).toBeNull(); // a square, convex
    expect(fillFaces([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]])).toBeNull(); // closed
    expect(fillFaces([[0, 0], [4, 0], [2, 1], [4, 4], [0, 4]])).toBeNull(); // concave, simple
    expect(fillFaces([[0, 0], [4, 0], [2, 3]])).toBeNull(); // a triangle
    expect(fillFaces([])).toBeNull();
    // Touching at a vertex is not a crossing.
    expect(fillFaces([[0, 0], [2, 2], [4, 0], [4, 4], [2, 2], [0, 4]])).toBeNull();
  });

  it('cuts a bow tie into its two triangles, whether the ring is closed or not', () => {
    for (const ring of [BOW_TIE, [...BOW_TIE, BOW_TIE[0] as XY]]) {
      const loops = fillFaces(ring);
      expect(loops).toHaveLength(2);
      expect((loops ?? []).map((l) => Math.abs(areaOf(l))).sort()).toEqual([4, 4]);
      // Both lobes are filled, and nothing outside them.
      expect(inside(loops ?? [], [1, 2])).toBe(true); // left lobe
      expect(inside(loops ?? [], [3, 2])).toBe(true); // right lobe
      expect(inside(loops ?? [], [2, 0.5])).toBe(false); // the open area below the crossing
      expect(inside(loops ?? [], [2, 3.5])).toBe(false);
      expect(inside(loops ?? [], [5, 2])).toBe(false);
    }
  });

  it('fills every area a star encloses, its middle too (the owner\'s choice: the nonzero rule)', () => {
    const loops = fillFaces(STAR);
    expect(loops).toHaveLength(6); // five points and the pentagon in the middle
    expect(inside(loops ?? [], [0, 0])).toBe(true); // the middle
    expect(inside(loops ?? [], [0, -90])).toBe(true); // the top point
    expect(inside(loops ?? [], [-80.8, -26.3])).toBe(true); // along the left point
    expect(inside(loops ?? [], [0, -60])).toBe(true); // between the top point and the middle
    expect(inside(loops ?? [], [60, -80])).toBe(false); // between two points, outside the star
    expect(inside(loops ?? [], [0, 100])).toBe(false);
    // The middle pentagon is the largest face: the circumradius of the inner pentagon of a star is cos 72° / cos 36° of the star's.
    const largest = Math.max(...(loops ?? []).map((l) => Math.abs(areaOf(l))));
    expect(largest).toBeCloseTo(2.5 * (100 * Math.cos((72 * Math.PI) / 180) / Math.cos((36 * Math.PI) / 180)) ** 2 * Math.sin((72 * Math.PI) / 180), 3);
  });

  it('cuts a ring with several crossings into faces that are simple and do not overlap, a point with x and y different tested', () => {
    const ring: XY[] = [[0, 0], [6, 2], [6, 4], [0, 6], [2, 0], [4, 6], [4, 0]]; // five crossings
    const faces = fillFaces(ring);
    expect(faces).not.toBeNull();
    expect((faces ?? []).length).toBeGreaterThanOrEqual(3);
    for (const face of faces ?? []) expect(fillFaces(face)).toBeNull(); // each is simple
    // Counted once each: the faces' areas add up to the area the ring winds round, and a point lies in one face only.
    for (const point of [[5, 3], [3, 1], [1, 0.3], [3.9, 5], [5, 1.5]] as XY[]) {
      expect((faces ?? []).filter((f) => inside([f], point)).length).toBeLessThanOrEqual(1);
    }
    expect(inside(faces ?? [], [5, 3])).toBe(true);
    expect(inside(faces ?? [], [10, 10])).toBe(false);
  });

  it('is the same for a ring that goes the other way round', () => {
    const forward = fillFaces(STAR) ?? [];
    const backward = fillFaces([...STAR].reverse()) ?? [];
    expect(backward).toHaveLength(forward.length);
    const areas = (faces: readonly XY[][]) => faces.map((f) => Math.abs(areaOf(f))).sort((a, b) => a - b);
    areas(backward).forEach((area, i) => {
      expect(area).toBeCloseTo(areas(forward)[i] ?? Number.NaN, 6);
    });
  });

  it('is fast for a convex ring and for a long one with one crossing', () => {
    const circle: XY[] = Array.from({ length: 2000 }, (_, i): XY => [Math.cos((i * 2 * Math.PI) / 2000), Math.sin((i * 2 * Math.PI) / 2000)]);
    expect(fillFaces(circle)).toBeNull();
    const long: XY[] = [...Array.from({ length: 1500 }, (_, i): XY => [i, (i % 2) * 0.1]), [1500, 5], [0, 5], [-1, 0.2], [1499, -3]];
    const started = Date.now();
    fillFaces(long);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('fillFacesWithHoles (M8: a polygon with holes whose outer ring crosses itself)', () => {
  /** Whether a point is inside any polygon: inside its face and outside its holes. */
  const filled = (polygons: readonly (readonly (readonly XY[])[])[], point: XY): boolean =>
    polygons.some(([face, ...holes]) => inside([face as XY[]], point) && !holes.some((hole) => inside([hole], point)));
  const HOLE: XY[] = [[0.5, 1.5], [1.5, 1.5], [1.5, 2.5], [0.5, 2.5]]; // inside the bow tie's left lobe

  it('gives nothing when the outer ring does not cross itself, holes or not: the fill handles those', () => {
    expect(fillFacesWithHoles([[0, 0], [4, 0], [4, 4], [0, 4]], [[[1, 1], [2, 1], [2, 2]]])).toBeNull();
    expect(fillFacesWithHoles([], [])).toBeNull();
  });

  it('is the faces alone without holes', () => {
    const polygons = fillFacesWithHoles(BOW_TIE, []);
    expect(polygons).toHaveLength(2);
    expect(polygons?.every((polygon) => polygon.length === 1)).toBe(true);
  });

  it('cuts a hole out of the face that holds it, and fills the other lobe and the rest of that lobe', () => {
    const polygons = fillFacesWithHoles(BOW_TIE, [HOLE]) ?? [];
    expect(polygons).toHaveLength(2);
    expect(polygons.map((polygon) => polygon.length).sort()).toEqual([1, 2]); // the hole belongs to one face
    expect(filled(polygons, [1, 2])).toBe(false); // in the hole
    expect(filled(polygons, [0.2, 2])).toBe(true); // the left lobe round the hole
    expect(filled(polygons, [1.8, 2])).toBe(true);
    expect(filled(polygons, [3, 2])).toBe(true); // the right lobe, which has no hole
    expect(filled(polygons, [2, 0.5])).toBe(false); // still outside the outline
  });

  it('takes the hole as it comes, either way round and closed', () => {
    for (const hole of [[...HOLE].reverse(), [...HOLE, HOLE[0] as XY]]) {
      const polygons = fillFacesWithHoles(BOW_TIE, [hole]) ?? [];
      expect(filled(polygons, [1, 2])).toBe(false);
      expect(filled(polygons, [0.2, 2])).toBe(true);
    }
  });

  it('puts each hole in its own face, a hole in each lobe', () => {
    const right: XY[] = HOLE.map(([x, y]): XY => [x + 2, y]);
    const polygons = fillFacesWithHoles(BOW_TIE, [HOLE, right]) ?? [];
    expect(polygons.map((polygon) => polygon.length)).toEqual([2, 2]);
    expect(filled(polygons, [1, 2])).toBe(false);
    expect(filled(polygons, [3, 2])).toBe(false);
    expect(filled(polygons, [0.2, 2])).toBe(true);
    expect(filled(polygons, [3.8, 2])).toBe(true);
  });

  it('leaves out a hole that lies across two faces (it cannot be cut out of one), and a ring of fewer than three points', () => {
    const across: XY[] = [[1.5, 1.5], [2.5, 1.5], [2.5, 2.5], [1.5, 2.5]]; // over the crossing at (2, 2)
    const poking: XY[] = [[0.4, 1.6], [1.2, 1], [1.2, 2]]; // its middle is in the left lobe, one corner is not
    const line: XY[] = [[0.5, 2], [1, 2]]; // two points: no hole
    const polygons = fillFacesWithHoles(BOW_TIE, [across, poking, line]) ?? [];
    expect(polygons.map((polygon) => polygon.length)).toEqual([1, 1]);
  });

  it('keeps the star\'s faces with a hole in its middle', () => {
    const middle: XY[] = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const polygons = fillFacesWithHoles(STAR, [middle]) ?? [];
    expect(polygons).toHaveLength(6);
    expect(filled(polygons, [0, 0])).toBe(false);
    expect(filled(polygons, [0, -60])).toBe(true);
    expect(filled(polygons, [0, -20])).toBe(true); // the pentagon round the hole
  });
});
