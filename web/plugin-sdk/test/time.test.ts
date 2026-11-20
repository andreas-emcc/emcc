// SDK 1.4.0 part 4 (CR-0030 part 4; ADR-0044, ADR-0045): the user's time, capabilities, and the
// test kit's temporal helpers.
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, capabilityMismatch, definePlugin, NOW, userTimeProblem, type UserTime } from '../src/index.ts';
import { activatePlugin, createFakeContext, createTemporalTestPlugin } from '../src/testing/index.ts';

const AT: UserTime = { time: '2026-11-06T08:00:00.000Z' };
const SPAN: UserTime = { interval: { from: '2026-11-06T08:00:00Z', to: '2026-11-06T09:30:00Z' } };
const BOTH: UserTime = { time: '2026-11-06T12:00:00Z', interval: { from: '2026-11-06T08:00:00Z', to: '2026-11-06T09:30:00Z' } };
const BACKWARDS = { interval: { from: '2026-11-06T09:30:00Z', to: '2026-11-06T08:00:00Z' } };

describe('the user time (ADR-0045, CR-0032)', () => {
  it('has a set time and an interval, independent, each left out at its default, in UTC', () => {
    expect(NOW).toEqual({});
    expect(userTimeProblem(NOW)).toBeNull();
    expect(userTimeProblem(AT)).toBeNull();
    expect(userTimeProblem(SPAN)).toBeNull();
    expect(userTimeProblem(BOTH)).toBeNull(); // the set time may lie outside the interval
    expect(userTimeProblem({ interval: { from: '2026-11-06T08:00:00Z', to: '2026-11-06T08:00:00Z' } })).toBeNull();
    expect(userTimeProblem(BACKWARDS)).toContain('start is after its end');
    expect(userTimeProblem({ time: '2026-11-06T08:00:00+01:00' })).toContain('UTC');
    expect(userTimeProblem({ interval: { from: '2026-11-06T08:00:00Z', to: '9:30' } })).toContain('UTC');
  });

  it('refuses null, a null part and unknown members (the ACA R3 on CR-0032)', () => {
    expect(userTimeProblem(null)).toContain('not null');
    expect(userTimeProblem({ time: null } as unknown as UserTime)).toContain('never null');
    expect(userTimeProblem({ interval: null } as unknown as UserTime)).toContain('never null');
    expect(userTimeProblem({ time: undefined } as unknown as UserTime)).toContain('never null');
    expect(userTimeProblem({ interval: { from: '2026-11-06T08:00:00Z' } } as unknown as UserTime)).toContain('from and to');
    expect(userTimeProblem({ kind: 'now' } as unknown as UserTime)).toContain('unknown member of a user time: kind');
  });
});

describe('capabilities (ADR-0044; owner, Q11)', () => {
  const temporal = definePlugin({ activate() {}, capabilities: { temporal: { timeChanged() {} } } });
  const plain = definePlugin({ activate() {} });

  it('are what the module implements', () => {
    expect(capabilitiesOf(temporal)).toEqual(['temporal']);
    expect(capabilitiesOf(plain)).toEqual([]);
  });

  it('match when each declared one is in at least one part, and a part implements only declared ones', () => {
    expect(capabilityMismatch(temporal, ['temporal'], false)).toBeNull();
    expect(capabilityMismatch(plain, [], false)).toBeNull();
    expect(capabilityMismatch(plain, ['temporal'], true)).toBeNull(); // the server part may implement it
    expect(capabilityMismatch(plain, ['temporal'], false)).toContain('declared but not implemented');
    expect(capabilityMismatch(temporal, [], true)).toContain('implemented but not declared');
    expect(capabilityMismatch(plain, ['history'], true)).toBe('unknown capability history');
  });
});

describe('the test kit: time on a fake context (R4: no ctx.time)', () => {
  it('tells a temporal module the time after activate and at each change', async () => {
    const ctx = createFakeContext({ time: AT });
    const module = createTemporalTestPlugin();
    const stop = await activatePlugin(module, ctx);
    expect(module.times).toEqual([AT]);
    ctx.setTime(SPAN);
    ctx.setTime(BOTH);
    ctx.setTime(NOW);
    expect(module.times).toEqual([AT, SPAN, BOTH, NOW]); // one call per change of either part
    expect(ctx.currentTime).toEqual(NOW);
    stop();
    ctx.setTime(AT);
    expect(module.times).toHaveLength(4);
    expect('time' in ctx).toBe(false);
  });

  it('refuses a time the shell would refuse, and starts at now', async () => {
    const ctx = createFakeContext();
    expect(ctx.currentTime).toEqual(NOW);
    expect(() => ctx.setTime(BACKWARDS)).toThrow('start is after');
    expect(() => ctx.setTime({ time: null } as unknown as UserTime)).toThrow('never null');
    const plain = definePlugin({ activate() {} });
    await expect(activatePlugin(plain, ctx)).resolves.toBeTypeOf('function');
  });
});
