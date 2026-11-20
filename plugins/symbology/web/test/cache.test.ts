import { describe, expect, it } from 'vitest';
import { AppearanceCache, type AppearanceKey } from '../src/cache.ts';

const key = (sidc: string, size = 30, modifiers = ''): AppearanceKey => ({ standard: 'APP-6D', sidc, size, modifiers });

describe('AC2: the appearance cache', () => {
  it('finds a value only by its whole key', () => {
    const cache = new AppearanceCache<string>(10);
    cache.set(key('a'), 'A');
    expect(cache.get('APP-6D', 'a', 30, '')).toBe('A');
    expect(cache.get('APP-6E', 'a', 30, '')).toBeUndefined();
    expect(cache.get('APP-6D', 'b', 30, '')).toBeUndefined();
    expect(cache.get('APP-6D', 'a', 31, '')).toBeUndefined();
    expect(cache.get('APP-6D', 'a', 30, '45')).toBeUndefined();
  });

  it('never holds more than its capacity and drops the least recently used entry', () => {
    const cache = new AppearanceCache<string>(3);
    for (const sidc of ['a', 'b', 'c']) cache.set(key(sidc), sidc);
    cache.get('APP-6D', 'a', 30, ''); // order of use: b, c, a
    cache.set(key('d'), 'd'); // drops b
    expect(cache.size).toBe(3);
    expect(cache.get('APP-6D', 'b', 30, '')).toBeUndefined();
    for (const sidc of ['a', 'c', 'd']) expect(cache.get('APP-6D', sidc, 30, '')).toBe(sidc);
    for (let i = 0; i < 100; i++) cache.set(key(`x${String(i)}`), 'x');
    expect(cache.size).toBe(3);
  });

  it('replaces the value of an existing key without growing', () => {
    const cache = new AppearanceCache<string>(3);
    cache.set(key('a'), 'old');
    cache.set(key('a'), 'new');
    expect(cache.size).toBe(1);
    expect(cache.get('APP-6D', 'a', 30, '')).toBe('new');
  });

  it('keeps entries that share part of their key when another one is dropped', () => {
    const cache = new AppearanceCache<string>(2);
    cache.set(key('a', 30), '30');
    cache.set(key('a', 40), '40');
    cache.set(key('b', 30), 'b'); // drops a/30, keeps a/40
    expect(cache.get('APP-6D', 'a', 30, '')).toBeUndefined();
    expect(cache.get('APP-6D', 'a', 40, '')).toBe('40');
  });

  it('keeps the sum of the weights within its budget, dropping the least recently used entries', () => {
    const cache = new AppearanceCache<number>(100, 10, (value) => value);
    cache.set(key('a'), 4);
    cache.set(key('b'), 4);
    cache.get('APP-6D', 'a', 30, ''); // order of use: b, a
    cache.set(key('c'), 4); // 12 > 10: drops b
    expect(cache.weight).toBe(8);
    expect(cache.get('APP-6D', 'b', 30, '')).toBeUndefined();
    cache.set(key('a'), 1); // replacing an entry replaces its weight
    expect(cache.weight).toBe(5);
  });

  it('keeps an entry heavier than the whole budget alone, and drops it for the next one', () => {
    const cache = new AppearanceCache<number>(100, 10, (value) => value);
    cache.set(key('a'), 3);
    cache.set(key('huge'), 50);
    expect(cache.size).toBe(1);
    expect(cache.get('APP-6D', 'huge', 30, '')).toBe(50);
    cache.set(key('b'), 3);
    expect(cache.size).toBe(1);
    expect(cache.weight).toBe(3);
  });

  it('drops the least recently used entries at once when it is made smaller, and keeps more when made larger', () => {
    const cache = new AppearanceCache<string>(3);
    for (const sidc of ['a', 'b', 'c']) cache.set(key(sidc), sidc);
    cache.get('APP-6D', 'a', 30, ''); // order of use: b, c, a
    cache.resize(2); // drops b
    expect(cache.capacity).toBe(2);
    expect(cache.size).toBe(2);
    expect(cache.get('APP-6D', 'b', 30, '')).toBeUndefined();
    cache.resize(4);
    for (const sidc of ['d', 'e']) cache.set(key(sidc), sidc);
    expect(cache.size).toBe(4);
    expect(() => {
      cache.resize(0);
    }).toThrow(RangeError);
    expect(cache.capacity).toBe(4);
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses capacity %s', (capacity) => {
    expect(() => new AppearanceCache(capacity)).toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN])('refuses maxWeight %s', (maxWeight) => {
    expect(() => new AppearanceCache(1, maxWeight)).toThrow(RangeError);
  });
});
