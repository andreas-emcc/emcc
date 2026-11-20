import { describe, expect, it, vi } from 'vitest';
import { ESTIMATED_EM_PER_CHARACTER, MEASURE_CACHE_LIMIT, TextMeter, type MeasuringContext } from '../../src/engine/textMeter.ts';

/** A context that measures 10 pixels a character, and tells which font it was asked in. */
function context() {
  const asked: string[] = [];
  const ctx: MeasuringContext = {
    font: '',
    measureText(text: string) {
      asked.push(`${this.font}|${text}`);
      return { width: Array.from(text).length * 10 };
    },
  };
  return { ctx, asked };
}

describe('text meter (SN A: a text is measured, not guessed)', () => {
  it('gives the width the context measures in the font given, of the widest line', () => {
    const { ctx, asked } = context();
    const meter = new TextMeter(() => ctx);
    expect(meter.width('abc', '600 20px sans-serif', 20)).toBe(30);
    expect(meter.width('ab\nabcdef\nabc', '600 20px sans-serif', 20)).toBe(60);
    expect(asked[0]).toBe('600 20px sans-serif|abc');
  });

  it('keeps a measured line per font: it asks once for the same line and font, again for another font or line', () => {
    const { ctx, asked } = context();
    const meter = new TextMeter(() => ctx);
    for (let i = 0; i < 5; i++) meter.width('abc', 'A', 20);
    expect(asked).toHaveLength(1);
    meter.width('abc', 'B', 20);
    meter.width('abcd', 'A', 20);
    expect(asked).toHaveLength(3);
    meter.clear();
    meter.width('abc', 'A', 20);
    expect(asked).toHaveLength(4);
  });

  it('starts the cache over when it is full, and still answers right', () => {
    const { ctx, asked } = context();
    const meter = new TextMeter(() => ctx);
    for (let i = 0; i < MEASURE_CACHE_LIMIT + 5; i++) expect(meter.width(`t${String(i)}`, 'A', 20)).toBe(10 * `t${String(i)}`.length);
    const before = asked.length;
    meter.width('t0', 'A', 20); // forgotten when the cache was full
    expect(asked.length).toBe(before + 1);
  });

  it('measures non-ASCII text as the context says', () => {
    const { ctx } = context();
    expect(new TextMeter(() => ctx).width('日本語', 'A', 20)).toBe(30);
  });

  it('guesses 0.6 em a character where the browser has no 2D canvas, a character being a code point', () => {
    const create = vi.fn(() => null);
    const meter = new TextMeter(create);
    expect(meter.width('abcde', 'A', 20)).toBeCloseTo(5 * 20 * ESTIMATED_EM_PER_CHARACTER, 9);
    expect(meter.width('😀😀', 'A', 10)).toBeCloseTo(2 * 10 * ESTIMATED_EM_PER_CHARACTER, 9);
    expect(create).toHaveBeenCalledTimes(1); // it asks for the context once
  });

  it('guesses where the context throws or answers a width that is not a number', () => {
    expect(new TextMeter(() => { throw new Error('no canvas'); }).width('ab', 'A', 10)).toBeCloseTo(12, 9);
    const nan: MeasuringContext = { font: '', measureText: () => ({ width: Number.NaN }) };
    expect(new TextMeter(() => nan).width('ab', 'A', 10)).toBeCloseTo(12, 9);
  });
});
