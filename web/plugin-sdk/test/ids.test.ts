import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/ids.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('is a lowercase version 7 UUID, as the model requires', () => {
    for (let i = 0; i < 100; i++) expect(uuidv7()).toMatch(UUID);
  });

  it('starts with the millisecond timestamp, so ids sort by time', () => {
    expect(uuidv7(0x0192a5c43b1e).startsWith('0192a5c4-3b1e-7')).toBe(true);
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
  });
});
