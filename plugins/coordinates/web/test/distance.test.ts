import { describe, expect, it } from 'vitest';
import { distanceMetres } from '../src/distance.ts';

describe('distanceMetres (the 1 m tolerance of "go to")', () => {
  it('measures a known distance: one degree of latitude is about 111.2 km on the sphere', () => {
    expect(distanceMetres([15.5, 60], [15.5, 61])).toBeCloseTo(111_195, -1);
  });

  it('measures across the antimeridian the short way', () => {
    expect(distanceMetres([179.9999, -16.5], [-179.9999, -16.5])).toBeCloseTo(21.3, 0);
  });

  it('treats every longitude at a pole as the same point', () => {
    expect(distanceMetres([0, 90], [135.5, 90])).toBeLessThan(1e-6);
    expect(distanceMetres([-45, -90], [120, -90])).toBeLessThan(1e-6);
  });

  it('tells half a metre from five metres', () => {
    const metre = 1 / 111_195; // degrees of latitude per metre
    expect(distanceMetres([18.25, 60.5], [18.25, 60.5 + 0.5 * metre])).toBeLessThan(1);
    expect(distanceMetres([18.25, 60.5], [18.25, 60.5 + 5 * metre])).toBeGreaterThan(1);
  });
});
