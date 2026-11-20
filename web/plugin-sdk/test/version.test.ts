import { describe, expect, it } from 'vitest';
import shared from '../../../model/examples/sdk-version-matching.json';
import pkg from '../package.json';
import { SDK_VERSION, SHARED_LIBRARIES, satisfies } from '../src/version.ts';

describe('sdkVersion matching', () => {
  it.each(shared.cases)('$range against $sdk is $compatible (shared case)', ({ range, sdk, compatible }) => {
    expect(satisfies(range, sdk)).toBe(compatible);
  });

  it('the SDK is compatible with ^1.0.0, and refuses plugins built for ^0.1.0 (CR-0010)', () => {
    expect(satisfies('^1.0.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^1.1.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^1.2.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^1.3.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^1.4.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^1.5.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^1.6.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^1.7.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^1.8.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^1.9.0', SDK_VERSION)).toBe(true);
    expect(satisfies('^0.1.0', SDK_VERSION)).toBe(false);
    expect(SHARED_LIBRARIES['@emc2/plugin-sdk']).toBe(SDK_VERSION);
  });

  it('is the package version (one SDK version everywhere, CR-0005)', () => {
    expect(pkg.version).toBe(SDK_VERSION);
  });

  it('rejects malformed versions', () => {
    expect(() => satisfies('^0.1', '0.1.0')).toThrow();
  });
});
