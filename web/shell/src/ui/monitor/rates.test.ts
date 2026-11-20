import { describe, expect, it } from 'vitest';
import { channel, plugin, snapshot, task, worker } from '../../testing/monitor.ts';
import {
  allocationHistory, allocationRate, bytes, channelAttention, channelRates, channelStateText, duration, pluginAttention, rates, taskAttention, taskRates, workerAttention,
} from './rates.ts';

describe('the monitor\'s rates', () => {
  it("give the allocation over the span, with ECore's share of the samples applied to the exact total (T-148)", () => {
    const MiB = 1024 * 1024;
    const a = snapshot(0, [], [], { totalBytes: 100 * MiB, sampledBytes: 50 * MiB, ecoreBytes: 5 * MiB });
    const b = snapshot(10_000, [], [], { totalBytes: 200 * MiB, sampledBytes: 150 * MiB, ecoreBytes: 15 * MiB });

    expect(allocationRate([a])).toBeNull();
    expect(allocationRate([a, b])).toEqual({ total: 10 * MiB, ecoreShare: 0.1, sampling: true, seconds: 10 });
    expect(allocationRate([a, snapshot(10_000, [], [], { totalBytes: 200 * MiB, sampledBytes: 50 * MiB, ecoreBytes: 5 * MiB })]))
      .toMatchObject({ total: 10 * MiB, ecoreShare: null });
    const off = (at: number, total: number) => snapshot(at, [], [], { totalBytes: total, sampling: false });
    expect(allocationRate([off(0, 0), off(2_000, 2 * MiB)])).toEqual({ total: MiB, ecoreShare: null, sampling: false, seconds: 2 });
    expect(allocationRate([off(0, -1), off(2_000, -1)])?.total, 'a JVM that does not count').toBeNull();
  });

  it('count the allocation since a restart only, and over the last 10 s', () => {
    const at = (s: number, total: number) => snapshot(s * 1000, [], [], { totalBytes: total });
    expect(allocationRate([at(0, 900), at(2, 10), at(4, 30)])).toMatchObject({ total: 10, seconds: 2 });
    expect(allocationHistory([at(0, 0), at(2, 0), at(4, 0)], at(12, 0)).map((s) => s.atMillis)).toEqual([2_000, 4_000, 12_000]);
  });

  it('come from two snapshots: calls per second and the average call in between', () => {
    const before = snapshot(10_000, [plugin('cot', { workers: [worker('streams', { processed: 100, totalHandlerMicros: 50_000 })] })]);
    const after = snapshot(12_000, [plugin('cot', { workers: [worker('streams', { processed: 300, totalHandlerMicros: 150_000 })] })]);

    expect(rates(before, after).get('cot/streams')).toEqual({ perSecond: 100, averageMs: 0.5 });
    expect(rates(null, after).get('cot/streams')).toEqual({ perSecond: null, averageMs: null });
  });

  it('start again after a restart, and have no average without calls', () => {
    const before = snapshot(0, [], [worker('store', { owner: 'core-store', processed: 500 })]);
    expect(rates(before, snapshot(2_000, [], [worker('store', { owner: 'core-store', processed: 10 })])).get('core-store/store'))
      .toEqual({ perSecond: null, averageMs: null });
    expect(rates(before, snapshot(2_000, [], [worker('store', { owner: 'core-store', processed: 500 })])).get('core-store/store'))
      .toEqual({ perSecond: 0, averageMs: null });
  });

  it('mark what needs attention', () => {
    expect(workerAttention(worker('a'))).toBe('ok');
    expect(workerAttention(worker('a', { dropped: 1 }))).toBe('warn');
    expect(workerAttention(worker('a', { hung: 1 }))).toBe('warn');
    expect(workerAttention(worker('a', { state: 'HUNG' }))).toBe('bad');
    expect(pluginAttention(plugin('p'))).toBe('ok');
    expect(pluginAttention(plugin('p', { state: 'DEGRADED' }))).toBe('warn');
    expect(pluginAttention(plugin('p', { caps: { ...plugin('p').caps, refusedTimers: 3 } }))).toBe('warn');
    expect(pluginAttention(plugin('p', { listeners: [{ plugin: 'p', name: 'l', host: 'h', port: 1, connected: false, bytesRead: 0, bytesWritten: 0, reconnects: 2 }] })))
      .toBe('warn');
    expect(pluginAttention(plugin('p', { workers: [worker('w', { state: 'FAILED' })] }))).toBe('bad');
    expect(pluginAttention(plugin('p', { active: false, state: 'FAILED' }))).toBe('bad');
  });

  it('write times and sizes for people', () => {
    expect(duration(7)).toBe('7 s');
    expect(duration(306)).toBe('5 min 6 s');
    expect(duration(3_725)).toBe('1 h 2 min');
    expect(duration(93_600)).toBe('1 d 2 h');
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1536)).toBe('1.5 KiB');
    expect(bytes(256 * 1024 * 1024)).toBe('256 MiB');
  });
});

describe('connection tasks', () => {
  it('works out each counter\'s rate from two answers, and none for a counter that went down', () => {
    const at = (millis: number, received: number, id = 7) =>
      snapshot(millis, [plugin('cot', { tasks: [task('cot', 'tak', { id, counters: { received } })] })], []);

    expect(taskRates(null, at(10_000, 5)).get('cot/tak#7/received')).toBeNull();
    expect(taskRates(at(10_000, 5), at(12_000, 45)).get('cot/tak#7/received')).toBe(20);
    expect(taskRates(at(10_000, 45), at(12_000, 3)).get('cot/tak#7/received'), 'it went down').toBeNull();
    expect(taskRates(at(10_000, 1000), at(12_000, 5000, 8)).get('cot/tak#8/received'), 'a new task of the name, already past the old total')
      .toBeNull();
  });

  it('marks a failed task as a problem, and one that restarts, does not end, waits or lost items as needing a look', () => {
    expect(taskAttention(task('cot', 'a'))).toBe('ok');
    expect(taskAttention(task('cot', 'a', { state: 'FAILED', reason: 'x' }))).toBe('bad');
    expect(taskAttention(task('cot', 'a', { state: 'RESTARTING' }))).toBe('warn');
    expect(taskAttention(task('cot', 'a', { state: 'STOPPING', notEnding: true }))).toBe('warn');
    expect(taskAttention(task('cot', 'a', { state: 'STOPPED', reason: 'stopped; waiting for an earlier run of its name to end' }))).toBe('warn');
    expect(taskAttention(task('cot', 'a', { lost: 1 }))).toBe('warn');
    expect(pluginAttention(plugin('cot', { tasks: [task('cot', 'a', { state: 'FAILED', reason: 'x' })] }))).toBe('bad');
  });
});

describe('output channels', () => {
  it('work out what was sent and handled per second, and nothing for a channel offered again', () => {
    const at = (millis: number, sent: number, delivered: number) =>
      snapshot(millis, [plugin('cot', { channels: [channel('cot', 'tak-north', { sent, delivered })] })], []);

    expect(channelRates(null, at(10_000, 5, 5)).get('cot/tak-north')).toEqual({ sent: null, delivered: null });
    expect(channelRates(at(10_000, 5, 5), at(12_000, 65, 25)).get('cot/tak-north')).toEqual({ sent: 30, delivered: 10 });
    expect(channelRates(at(10_000, 65, 25), at(12_000, 3, 3)).get('cot/tak-north'), 'its totals went down').toEqual({ sent: null, delivered: null });
  });

  it('mark a channel that dropped items, and its plugin, as needing a look', () => {
    expect(channelAttention(channel('cot', 'a', { replaced: 40 }))).toBe('ok');
    expect(channelAttention(channel('cot', 'a', { dropped: 1 }))).toBe('warn');
    expect(pluginAttention(plugin('cot', { channels: [channel('cot', 'a', { dropped: 1 })] }))).toBe('warn');
    expect(pluginAttention(plugin('cot', { channels: [channel('cot', 'a')] }))).toBe('ok');
    // SDK 1.9.0 (CR-0050 point 2): a channel that is not sending, or degraded, needs a look, with its detail in words
    const off = channel('cot', 'a', { state: 'NOT_SENDING', stateDetail: 'No destination' });
    expect(channelAttention(off)).toBe('warn');
    expect(channelStateText(off)).toBe('Not sending: No destination');
    expect(channelStateText(channel('cot', 'a', { state: 'DEGRADED' }))).toBe('Degraded');
    expect(channelStateText(channel('cot', 'a'))).toBe('');
  });
});
