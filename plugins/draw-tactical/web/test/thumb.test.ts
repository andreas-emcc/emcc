// T-204: the sample points and the paths of a Graphics tile's picture (src/thumb.ts), and the folder groups of
// "All graphics" (src/graphics.ts).
import { describe, expect, it } from 'vitest';
import type { GraphicCatalogEntry, GraphicRendering } from '@emc2/plugin-sdk';
import { FAKE_GRAPHICS } from '@emc2/plugin-sdk/testing';
import { BIG_GROUP, displayNames, folderGroups, keyOf } from '../src/graphics.ts';
import { samplePoints, THUMB_EXTENT, THUMB_HEIGHT, THUMB_WIDTH, thumbModelOf, toPicture } from '../src/thumb.ts';

const [BOUNDARY, PHASE, AXIS, FAN] = FAKE_GRAPHICS as readonly [GraphicCatalogEntry, GraphicCatalogEntry, GraphicCatalogEntry, GraphicCatalogEntry];

describe('the sample points of a tile', () => {
  it('give each kind a count its catalogue entry allows, inside the small view, with latitude and longitude that differ', () => {
    for (const entry of [BOUNDARY, PHASE, AXIS]) {
      const points = samplePoints(entry);
      expect(points, entry.name).not.toBeNull();
      expect(points?.length ?? 0, entry.name).toBeGreaterThanOrEqual(entry.minPoints);
      if (entry.maxPoints !== null) expect(points?.length ?? 0, entry.name).toBeLessThanOrEqual(entry.maxPoints);
      for (const [lon, lat] of points ?? []) {
        expect(Math.abs(lon)).toBeLessThanOrEqual(THUMB_EXTENT[2]);
        expect(Math.abs(lat)).toBeLessThanOrEqual(THUMB_EXTENT[3]);
      }
    }
    // Longitude first: the first point of a line is at the west of the view (a longitude), and its latitude is another number.
    const first = samplePoints(BOUNDARY)?.[0];
    expect(first?.[0]).toBeCloseTo(THUMB_EXTENT[0] * 0.85, 6);
    expect(first?.[0]).not.toBeCloseTo(first?.[1] ?? 0, 4);
  });

  it('draw an arrow as its tip, an axis back to the tail and the width of the head, last', () => {
    const points = samplePoints(AXIS) ?? [];
    expect(points).toHaveLength(3);
    expect(points[0]?.[0]).toBeGreaterThan(points[1]?.[0] ?? 0); // the tip is east of the tail
    expect(points[0]?.[1]).toBe(points[1]?.[1]); // on one axis
    expect(Math.abs(points[2]?.[1] ?? 0)).toBeGreaterThan(0); // the width point is off the axis
  });

  it('draw an area with at least four points, and one point for a graphic of one point', () => {
    const area: GraphicCatalogEntry = { ...BOUNDARY, kind: 'area', geometry: 'Polygon', minPoints: 3, maxPoints: null };
    expect(samplePoints(area)).toHaveLength(4);
    const circle: GraphicCatalogEntry = { ...FAN, requiredModifiers: [] };
    expect(samplePoints(circle)).toHaveLength(1);
  });

  it('are none for a graphic that needs an amplifier: the tile keeps its kind\'s icon', () => {
    expect(samplePoints(FAN)).toBeNull();
  });
});

describe('the paths of a tile', () => {
  const ok = (over: Partial<Extract<GraphicRendering, { readonly ok: true }>>): GraphicRendering => ({ ok: true, lines: [], fills: [], labels: [], ...over });

  it('put the view\'s corners at the picture\'s corners', () => {
    expect(toPicture(THUMB_EXTENT[0], THUMB_EXTENT[3])).toEqual([0, 0]);
    const [x, y] = toPicture(THUMB_EXTENT[2], THUMB_EXTENT[1]);
    expect(x).toBeCloseTo(THUMB_WIDTH);
    expect(y).toBeCloseTo(THUMB_HEIGHT);
  });

  it('turn lines and fills into paths, keep the colours and clamp a width', () => {
    const [west, south, east, north] = THUMB_EXTENT;
    const model = thumbModelOf(
      ok({
        lines: [{ coordinates: Float64Array.of(west, north, east, south), color: '#336699', width: 9, dash: [4, 2], opacity: 0.5 }],
        fills: [{ rings: [Float64Array.of(west, north, east, north, east, south)], color: '#aabbcc', opacity: 0.4, pattern: 'hatch' }],
      }),
    );
    expect(model?.lines).toEqual([{ d: `M0 0 L${String(THUMB_WIDTH)} ${String(THUMB_HEIGHT)}`, color: '#336699', opacity: 0.5, width: 2, dash: '4 2' }]);
    expect(model?.fills[0]).toMatchObject({ color: '#aabbcc', opacity: 0.4, hatch: true });
    expect(model?.fills[0]?.d.endsWith('Z')).toBe(true);
  });

  it('keep the graphic own label small, upright or turned, at its place', () => {
    const [west, south] = THUMB_EXTENT;
    const model = thumbModelOf(
      ok({ labels: [{ position: [west, south], text: ' PL ', angle: 30, font: 'bold 12px sans-serif', color: '#112233', align: 'right' }] }),
    );
    expect(model?.labels).toEqual([{ x: 0, y: THUMB_HEIGHT, text: 'PL', angle: 30, size: 6, color: '#112233', anchor: 'end' }]);
    expect(model?.lines).toEqual([]);
    expect(thumbModelOf(ok({ labels: [{ position: [0, 0], text: '  ', angle: 0, font: '12px serif', color: '#000000', align: 'left' }] }))).toBeNull();
  });

  it('are none for a refusal or an empty drawing, and a bad colour becomes black', () => {
    expect(thumbModelOf({ ok: false, reason: 'no' })).toBeNull();
    expect(thumbModelOf(ok({}))).toBeNull();
    const model = thumbModelOf(ok({ lines: [{ coordinates: Float64Array.of(0, 0, 0.001, 0.001), color: 'red', width: 1 }] }));
    expect(model?.lines[0]?.color).toBe('#000000');
  });
});

describe('the folder groups of "All graphics"', () => {
  it('are the top folders below the shared root, with the graphics under each, and "Other graphics" for the loose ones', () => {
    const names = displayNames(FAKE_GRAPHICS);
    const groups = folderGroups(FAKE_GRAPHICS, names);
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.name)])).toEqual([
      ['Command and Control Lines', ['Boundary']],
      ['Maneuver Lines', ['Phase Line']],
      ['Maneuver Areas', ['Main Attack']],
      ['Fires Areas', ['Weapon/Sensor Range fan, Sector']],
    ]);
    // A big folder (the catalogue's symbol sets) is split into its own folders, named with it; a small one stays whole.
    const many = Array.from({ length: BIG_GROUP + 1 }, (_, i): GraphicCatalogEntry => ({ ...BOUNDARY, entity: `7${String(i).padStart(5, '0')}`, name: `Graphic ${String(i)}`, path: ['Atmospheric', i % 2 === 0 ? 'Fronts' : 'Winds'] }));
    const straight: GraphicCatalogEntry = { ...BOUNDARY, entity: '800000', name: 'Straight', path: ['Atmospheric'] };
    const two = [...FAKE_GRAPHICS, ...many, straight];
    const labels = folderGroups(two, displayNames(two)).map((g) => [g.label, g.entries.length]);
    expect(labels).toEqual([['Control Measure', 4], ['Atmospheric', 1], ['Atmospheric › Fronts', 21], ['Atmospheric › Winds', 20]]);
    const loose: GraphicCatalogEntry = { ...BOUNDARY, entity: '999999', name: 'Loose', path: [] };
    const withLoose = folderGroups([...FAKE_GRAPHICS, loose], displayNames([...FAKE_GRAPHICS, loose]));
    expect(withLoose.at(-1)).toMatchObject({ label: 'Other graphics' });
    expect(withLoose.at(-1)?.entries.map(keyOf)).toEqual([keyOf(loose)]);
  });
});
