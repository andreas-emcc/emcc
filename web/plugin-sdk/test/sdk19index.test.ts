import { describe, expect, it } from 'vitest';
import * as sdk from '../src/index.ts';
import { compatibleShared } from '../src/version.ts';

// SDK 1.9.0 (the CDA's request, 2026-11-17): the shell imports the shared-library rule from the SDK's index.
describe("the SDK's index", () => {
  it('exports compatibleShared', () => {
    expect(sdk.compatibleShared).toBe(compatibleShared);
  });
});
