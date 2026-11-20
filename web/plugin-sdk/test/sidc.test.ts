import { describe, expect, it } from 'vitest';
import { canonicalSidc } from '../src/index.ts';

describe('canonicalSidc', () => {
  it('writes a 30-digit APP-6E SIDC with ten trailing zeros in its 20-digit form', () => {
    expect(canonicalSidc('APP-6E', '130310000012110000000000000000')).toBe('13031000001211000000');
  });

  it('keeps APP-6E codes that use digits 21-30, and other standards, unchanged', () => {
    expect(canonicalSidc('APP-6E', '130310000012110000000000000752')).toHaveLength(30);
    expect(canonicalSidc('APP-6E', '13031000001211000000')).toBe('13031000001211000000');
    expect(canonicalSidc('APP-6D', '10031000001211000000')).toBe('10031000001211000000');
    expect(canonicalSidc('APP-6B', 'SFGPUCI--------')).toBe('SFGPUCI--------');
  });
});
