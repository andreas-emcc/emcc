import { describe, expect, it } from 'vitest';
import { distanceMetres, formatDecimalDegrees, wrapLongitude } from '../src/geo.ts';

describe('geo helpers', () => {
  it('wraps a longitude into -180 to 180', () => {
    expect(wrapLongitude(15.25)).toBe(15.25);
    expect(wrapLongitude(195.5)).toBe(-164.5);
    expect(wrapLongitude(-195.5)).toBe(164.5);
    expect(wrapLongitude(540)).toBe(-180);
  });

  it('measures the distance between two positions, latitude first or last giving different answers', () => {
    // one degree of latitude is about 111.2 km; one degree of longitude at 60° N is about half of that
    expect(distanceMetres([10, 60], [10, 61])).toBeCloseTo(111_195, -2);
    expect(distanceMetres([10, 60], [11, 60])).toBeCloseTo(55_597, -2);
    expect(distanceMetres([15.25, 62.5], [62.5, 15.25])).toBeGreaterThan(distanceMetres([15.25, 62.5], [15.25, 63.5]));
    expect(distanceMetres([5, 5], [5, 5])).toBe(0);
  });

  it('formats decimal degrees with hemispheres, latitude first', () => {
    expect(formatDecimalDegrees([15.25, 62.5])).toBe('62.5000°N 15.2500°E');
    expect(formatDecimalDegrees([-45.5, -78.25])).toBe('78.2500°S 45.5000°W');
  });
});
