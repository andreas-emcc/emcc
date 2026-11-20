import { describe, expect, it } from 'vitest';
import { mapStatus } from '../../src/core/status.ts';

const base = { symbols: 'ready', problems: 0, softwareBudget: 10000 } as const;

describe('plugin status (criterion 13: the rendering result is reported)', () => {
  it('is OK with a GPU and names the renderer', () => {
    expect(mapStatus({ ...base, rendering: { mode: 'hardware', renderer: 'Apple M2' } })).toEqual({ state: 'OK', detail: 'drawn with a GPU (Apple M2)' });
  });

  it('is DEGRADED in software mode', () => {
    expect(mapStatus({ ...base, rendering: { mode: 'software', renderer: null } })).toEqual({
      state: 'DEGRADED', detail: 'drawn without a GPU: up to about 10000 objects one by one, clusters beyond',
    });
  });

  it('is FAILED without WebGL', () => {
    expect(mapStatus({ ...base, rendering: { mode: 'none', renderer: null } }).state).toBe('FAILED');
  });

  it('is DEGRADED without symbology or with unusable settings, and says why', () => {
    const status = mapStatus({ ...base, symbols: 'missing', problems: 1, rendering: { mode: 'hardware', renderer: null } });
    expect(status.state).toBe('DEGRADED');
    expect(status.detail).toBe('drawn with a GPU; symbology is not available: symbols are drawn as markers; 1 setting is not usable (see the log)');
  });

  it('does not count symbology as missing while it may still come', () => {
    expect(mapStatus({ ...base, symbols: 'waiting', rendering: { mode: 'hardware', renderer: null } }).state).toBe('OK');
  });
});
