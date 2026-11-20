import { describe, expect, it } from 'vitest';
import type { MilSymbol, Position } from '@emc2/plugin-sdk';
import { toDrawItem, type DrawItem } from '../../src/core/drawData.ts';
import { destination, distance } from '../../src/core/geodesic.ts';
import { speedVectorItem, speedVectorSecondsOf, VECTOR_COLOUR } from '../../src/core/vectors.ts';
import { INFANTRY, layer, symbolObject, uuid } from '../fixtures.ts';

const L = layer(1);

function symbolItem(modifiers: MilSymbol['modifiers'], at: Position = [15.2, 58.41], symbol: MilSymbol = INFANTRY): Extract<DrawItem, { kind: 'symbol' }> {
  const item = toDrawItem(symbolObject(10, L.id, at[0], at[1], { ...symbol, ...(modifiers === undefined ? {} : { modifiers }) }));
  if (item?.kind !== 'symbol') throw new Error('no symbol item');
  return item;
}

describe('the speed vector (brief functions 35 and 38, criteria 79, 81 and 94)', () => {
  it('criterion 79: ends speed x seconds m (10 minutes: 600 s) along the direction, geodesic, within 1 m (latitude differs from longitude)', () => {
    const item = symbolItem({ speed: 10, direction: 90 });
    const vector = speedVectorItem(item, 600);
    expect(vector?.kind).toBe('line');
    if (vector?.kind !== 'line') return;
    const end = vector.positions[vector.positions.length - 1] as Position;
    expect(distance([15.2, 58.41], end)).toBeCloseTo(6000, 0);
    const expected = destination([15.2, 58.41], 90, 6000);
    expect(distance(end, expected)).toBeLessThan(1);
    expect(vector.positions[0]).toEqual([15.2, 58.41]);
    expect(vector.id).toBe(`${uuid(10)}#vector`);
    expect(vector.aux).toBe(true);
  });

  it('criterion 94: its length is speed x seconds, whatever the step (5 s, 30 s, 1 min, 30 min)', () => {
    const lengthOf = (seconds: number) => {
      const vector = speedVectorItem(symbolItem({ speed: 10, direction: 90 }), seconds);
      if (vector?.kind !== 'line') throw new Error('no vector');
      const end = vector.positions[vector.positions.length - 1] as Position;
      expect(distance(end, destination([15.2, 58.41], 90, 10 * seconds))).toBeLessThan(1); // 10 m/s due east, geodesic
      return distance([15.2, 58.41], end);
    };
    expect(lengthOf(5)).toBeCloseTo(50, 0);
    expect(lengthOf(30)).toBeCloseTo(300, 0);
    expect(lengthOf(60)).toBeCloseTo(600, 0);
    expect(lengthOf(1800)).toBeCloseTo(18000, 0);
    expect(speedVectorItem(symbolItem({ speed: 10, direction: 90 }), 0)).toBeNull();
  });

  it('criterion 94: the length is the seconds of the display, as the shell gives them, whatever its minutes say', () => {
    const base = { symbolSize: 30, labels: [], labelPlaces: { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null, below: null }, directionArrow: false, relations: {}, classes: { 'dwell-area': true, 'sensor-coverage': true } } as const;
    expect(speedVectorSecondsOf({ ...base, speedVectorMinutes: 1 / 12, speedVectorSeconds: 5 })).toBe(5); // nothing is rounded to minutes
    expect(speedVectorSecondsOf({ ...base, speedVectorMinutes: 10, speedVectorSeconds: 0 })).toBe(0);
    expect(speedVectorSecondsOf({ ...base, speedVectorMinutes: 30, speedVectorSeconds: 1800 })).toBe(1800);
  });

  it('draws none with 0 seconds, without a direction, with a speed of 0 or none', () => {
    expect(speedVectorItem(symbolItem({ speed: 10, direction: 90 }), 0)).toBeNull();
    expect(speedVectorItem(symbolItem({ speed: 10 }), 600)).toBeNull();
    expect(speedVectorItem(symbolItem({ speed: 0, direction: 90 }), 600)).toBeNull();
    expect(speedVectorItem(symbolItem({ direction: 90 }), 600)).toBeNull();
    expect(speedVectorItem(symbolItem({ speed: -3, direction: 90 }), 600)).toBeNull();
    expect(speedVectorItem(symbolItem({ speed: Number.NaN, direction: 90 }), 600)).toBeNull();
  });

  it('criterion 81: continues past 180 degrees as one short line, never across the world', () => {
    const vector = speedVectorItem(symbolItem({ speed: 100, direction: 90 }, [179.9, 10]), 600); // 60 km east
    if (vector?.kind !== 'line') throw new Error('no vector');
    const lons = vector.positions.map((p) => p[0]);
    expect(Math.max(...lons)).toBeGreaterThan(180); // continuous: 180.4, not -179.6
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(1);
  });

  it('has the opacity of its object\'s step (brief function 46)', () => {
    expect(speedVectorItem({ ...symbolItem({ speed: 10, direction: 0 }), opacity: 0.45 }, 300)?.opacity).toBe(0.45);
    expect(speedVectorItem(symbolItem({ speed: 10, direction: 0 }), 300)?.opacity).toBeUndefined();
  });

  it('is faded with its object', () => {
    const vector = speedVectorItem({ ...symbolItem({ speed: 10, direction: 0 }), faded: true }, 300);
    expect(vector?.faded).toBe(true);
    expect(speedVectorItem(symbolItem({ speed: 10, direction: 0 }), 300)?.faded).toBeUndefined();
  });

  it('is black for every identity and standard (owner, LB, 2026-11-08)', () => {
    const vectorColour = (symbol: MilSymbol) => {
      const vector = speedVectorItem(symbolItem({ speed: 10, direction: 0 }, [15, 58], symbol), 300);
      return vector?.kind === 'line' ? vector.style?.strokeColor : undefined;
    };
    expect(VECTOR_COLOUR).toBe('#000000');
    for (const symbol of [
      { standard: 'APP-6D', sidc: '10031000001211000000' }, // friend
      { standard: 'APP-6D', sidc: '10061000001211000000' }, // hostile
      { standard: 'APP-6E', sidc: '13041000001211000000' }, // neutral
      { standard: 'APP-6D', sidc: '10011000001211000000' }, // unknown
      { standard: 'APP-6B', sidc: 'SHGPUCI----D---' },
      { standard: 'vessel', sidc: '0670' },
      { standard: 'vessel', sidc: '0370' },
    ] as const) expect(vectorColour(symbol), symbol.sidc).toBe('#000000');
  });
});

describe('the name and the speed on a symbol item', () => {
  it('keeps a name with text, and a speed above 0, and nothing else', () => {
    const named = toDrawItem({ ...symbolObject(10, L.id, 15, 58, { ...INFANTRY, modifiers: { speed: 4 } }), properties: { name: 'Alpha' } });
    expect(named).toMatchObject({ kind: 'symbol', name: 'Alpha', speed: 4 });
    const blank = toDrawItem({ ...symbolObject(11, L.id, 15, 58), properties: { name: '  ' } });
    expect(blank).not.toHaveProperty('name');
    expect(blank).not.toHaveProperty('speed');
  });
});
