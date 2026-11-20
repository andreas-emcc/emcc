/** Clusters (brief function 12): the marker's size and label, and which one a click hits. */
import { describe, expect, it } from 'vitest';
import type { Pixel, Position } from '@emc2/plugin-sdk';
import { clusterAt, clusterLabel, clusterRadius, type ClusterItem } from '../../src/core/clusters.ts';

const item = (cell: string, position: [number, number], count: number): ClusterItem => ({
  cell, position, count, identity: { friend: count, hostile: 0, neutral: 0, unknown: 0 },
});

describe('clusters', () => {
  it('labels the count in whole numbers, then in thousands', () => {
    expect([1, 999, 1000, 1290, 9999, 10_000, 123_456].map(clusterLabel)).toEqual(['1', '999', '1.0k', '1.2k', '9.9k', '10k', '123k']);
  });

  it('grows the marker slowly with the count, within bounds', () => {
    expect(clusterRadius(1)).toBe(12);
    expect(clusterRadius(1000)).toBeGreaterThan(clusterRadius(10));
    expect(clusterRadius(1e12)).toBe(30);
  });

  it('finds the nearest cluster whose marker contains the pixel, and none beside them', () => {
    const toPixel = (position: Position): Pixel => [position[0], position[1]];
    const items = [item('a', [100, 100], 10), item('b', [110, 100], 10)];
    expect(clusterAt(items, [107, 100], toPixel)?.cell).toBe('b');
    expect(clusterAt(items, [102, 100], toPixel)?.cell).toBe('a');
    expect(clusterAt(items, [100, 140], toPixel)).toBeNull();
    expect(clusterAt(items, [100, 100], () => null)).toBeNull();
  });
});
