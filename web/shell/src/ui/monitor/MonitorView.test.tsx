import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginEntry, settingsServices } from '../../testing/fakes.ts';
import { ShellStore } from '../store.ts';
import type { MonitorConversion, MonitorSnapshot, MonitorStream } from './api.ts';
import { MonitorView } from './MonitorView.tsx';
import { POLL_MS } from './rates.ts';
import { channel, computeTask, plugin, snapshot, task, worker } from '../../testing/monitor.ts';

const listener = { plugin: 'cot', name: 'tak-north', host: 'tak.example', port: 8089, connected: false, bytesRead: 2048, bytesWritten: 10, reconnects: 3 };

/** The server answers these, one per request, then the last one again. */
function show(...answers: (MonitorSnapshot | Response)[]) {
  const doFetch = vi.fn<typeof fetch>(() => {
    const next = answers.length > 1 ? answers.shift() : answers[0];
    return Promise.resolve(next instanceof Response ? next : Response.json(next));
  });
  const store = new ShellStore();
  store.setPlugins([pluginEntry('cot', { name: 'Cursor on Target', web: null }), pluginEntry('coordinates', { name: 'Coordinates' })]);
  store.setLoad('coordinates', 'active');
  const view = render(<MonitorView services={settingsServices(doFetch)} plugins={store.getView().plugins} />);
  return { doFetch, view };
}

const tick = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
};

const first = snapshot(10_000, [
  plugin('cot', { name: 'Cursor on Target', state: 'DEGRADED', detail: 'tak-north unreachable', listeners: [listener],
    internet: { hosts: ['tak.example.org', 'feeds.example.org'], reason: 'Fetches the feeds. Demos only.' },
    notSavedUpdates: 1200,
    workers: [worker('streams', { processed: 100, totalHandlerMicros: 20_000 }), worker('parser', { state: 'HUNG', hung: 1 })],
    caps: { outstandingAsks: 2, maxAsks: 10_000, refusedAsks: 0, activeTimers: 1, maxTimers: 1000, refusedTimers: 4 } }),
  plugin('coordinates', { name: 'Coordinates' }),
], [worker('object-store', { owner: 'core-store', processed: 50 })]);
const second = { ...first, atMillis: 12_000, plugins: first.plugins.map((p) => (p.id !== 'cot' ? p : {
  ...p, workers: [worker('streams', { processed: 300, totalHandlerMicros: 120_000 }), worker('parser', { state: 'HUNG', hung: 1 })],
})) };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the Monitor tab', () => {
  it('lists the TLS credentials with each certificate\'s expiry, and one that cannot be read', async () => { // ADR-0062 point 4, M9 C3
    const day = Date.UTC(2026, 10, 17);
    const cert = (subject: string, state: 'valid' | 'soon' | 'expired', notAfterMillis: number) => ({ subject, issuer: 'CN=Test CA', notAfterMillis, state });
    show({ ...first, plugins: [], core: { ...first.core, tls: [
      { name: 'broken', setting: 'emc2.tls.broken', error: 'emc2.tls.broken.trust-store cannot be read: the password is wrong', identity: [], trusted: [] },
      { name: 'tak-north', setting: 'emc2.tls.tak-north', error: null, identity: [cert('CN=emcc', 'soon', day), cert('CN=Test CA', 'valid', day)],
        trusted: [cert('CN=Old CA', 'expired', day), cert('CN=Test CA', 'valid', day)] },
    ] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const rows = within(screen.getByRole('table', { name: 'TLS credentials' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent))).toEqual([
      ['broken', 'Cannot be used: emc2.tls.broken.trust-store cannot be read: the password is wrong Problem'],
      ['tak-north', 'Client', 'CN=emcc', 'CN=Test CA', '2026-11-17 Check'],
      ['tak-north', 'Trusted', 'CN=Old CA', 'CN=Test CA', 'expired 2026-11-17 Problem'],
      ['tak-north', 'Trusted', 'CN=Test CA', 'CN=Test CA', '2026-11-17'],
    ]);
    expect(rows[1]?.className).toBe('attention-warn');
    expect(rows[2]?.className).toBe('attention-bad');
  });

  it('shows the server\'s HTTPS certificate as a tile in Core, or Off over plain HTTP', async () => { // ADR-0061 point 6, M9 C2
    show({ ...first, https: { subject: 'CN=localhost,O=emc2-test', issuer: 'CN=emc2 Test CA,O=emc2-test', notAfterMillis: Date.UTC(2026, 11, 6), state: 'soon' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const core = within(screen.getByRole('region', { name: 'Core' }));
    const tile = core.getByRole('group', { name: 'HTTPS' });
    expect([...tile.children].map((c) => c.textContent))
      .toEqual(['HTTPS', 'until 2026-12-06', 'expires soon', 'CN=localhost,O=emc2-test, issued by CN=emc2 Test CA,O=emc2-test']);
    expect(tile.querySelector('.emc2-chip-warning')).not.toBeNull();
    cleanup();

    show(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect([...within(screen.getByRole('region', { name: 'Core' })).getByRole('group', { name: 'HTTPS' }).children].map((c) => c.textContent))
      .toEqual(['HTTPS', 'Off', 'plain HTTP: no certificate is set (ADR-0061)']);
  });

  it('shows no TLS section without credentials', async () => {
    show(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByRole('region', { name: 'TLS credentials' })).toBeNull();
  });

  it('shows the core, and a row per plugin with its server and web status, refusals and listeners', async () => {
    show(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const core = within(screen.getByRole('region', { name: 'Core' }));
    // T-203 (findings L3): the core's numbers as tiles, each a label, a value, a chip or meter and a note
    const tile = (name: string) => [...core.getByRole('group', { name }).children].map((c) => c.textContent);
    expect(tile('ECore')).toEqual(['ECore', 'Running', 'up 1 h 2 min']);
    expect(core.getByRole('group', { name: 'ECore' }).querySelector('.emc2-chip-ok'), 'a chip: an icon and a word').not.toBeNull();
    expect(tile('Live picture')).toEqual(['Live picture', '1234 objects', '3 layers · change 5678']);
    expect(tile('Java heap')).toEqual(['Java heap', '256 MiB', '', 'of 1024 MiB (25 %)']);
    expect(core.getByRole('meter', { name: 'Java heap used' }).getAttribute('value')).toBe(String(256 * 1024 * 1024));
    expect(tile('Allocation')[1], 'the allocation line needs two answers').toBe('Measuring…');
    expect(core.getByText(/Allocation is not shown per plugin/)).toBeTruthy();

    const rows = within(screen.getByRole('table', { name: 'Plugins' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent))).toEqual([
      ['Cursor on Target Problem', 'Degradedtak-north unreachable', '–', '2, 1 not running', '–', '0', '4', '0 of 1 running', 'declared'],
      ['Coordinates', 'OK', 'OK', '0', '0.0', '0', '0', '–', '–'],
    ]);
    expect(rows[0]?.querySelector('td .emc2-chip-warning'), "the server's state as a chip").not.toBeNull();
    expect(rows[1]?.querySelectorAll('td .emc2-chip-ok'), 'server and web part').toHaveLength(2);

    // The filter (T-203): All and Problems, with their counts, and a search by name or id
    const filter = within(screen.getByRole('tablist', { name: 'Show plugins' }));
    expect(filter.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All 2', 'Problems 1']);
    fireEvent.click(filter.getByRole('tab', { name: 'Problems 1' }));
    const names = () => within(screen.getByRole('table', { name: 'Plugins' })).getAllByRole('row').slice(1).map((r) => r.querySelector('th, td')?.textContent);
    expect(names()).toEqual(['Cursor on Target Problem']);
    fireEvent.click(filter.getByRole('tab', { name: 'All 2' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a plugin' }), { target: { value: 'COORD' } });
    expect(names()).toEqual(['Coordinates']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a plugin' }), { target: { value: 'nothing' } });
    expect(names()).toEqual(['No plugin matches.']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a plugin' }), { target: { value: '' } });
    expect(rows[0]?.className).toBe('attention-bad');
    expect(rows[0]?.querySelector('.attention-mark')?.textContent, 'a visible mark, not colour alone').toBe('Problem');
    expect(rows[1]?.querySelector('.attention-mark')).toBeNull();
    expect(within(screen.getByRole('table', { name: 'Core workers' })).getByText('core-store / object-store')).toBeTruthy();
  });

  it('works out messages per second and the average call from two answers', async () => {
    show(first, second);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole('button', { name: 'Cursor on Target' }));
    const streams = () => within(screen.getByRole('table', { name: 'Cursor on Target: workers' })).getByRole('row', { name: /^streams/ });
    expect([...streams().querySelectorAll('td')].map((c) => c.textContent).slice(2, 4)).toEqual(['–', '–']);

    await tick();

    expect([...streams().querySelectorAll('td')].map((c) => c.textContent).slice(2, 4)).toEqual(['100.0', '0.50']);
  });

  it("shows the JVM's allocation and ECore's share over the last 10 s (T-148)", async () => {
    const MiB = 1024 * 1024;
    // 10 MiB/s in total; ECore has a tenth of the samples, then a quarter for the last 2 s.
    const at = (s: number, ecore = s * MiB) => snapshot(s * 1000, [], [], { totalBytes: s * 10 * MiB, sampledBytes: s * 10 * MiB, ecoreBytes: ecore });
    show(at(0), at(2), at(4), at(6), at(8), at(10), at(12, 10 * MiB + 5 * MiB));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // The value is the total; ECore's share and the span are the note (the UXA, T-203)
    const line = () => [...within(screen.getByRole('region', { name: 'Core' })).getByRole('group', { name: 'Allocation' }).children].slice(1).map((c) => c.textContent);
    expect(line()).toEqual(['Measuring…']);

    await tick();
    expect(line()).toEqual(['10.0 MiB/s', 'ECore ≈ 1.0 MiB/s (10 %), over 2 s']);
    for (let i = 0; i < 4; i++) await tick();
    expect(line()).toEqual(['10.0 MiB/s', 'ECore ≈ 1.0 MiB/s (10 %), over 10 s']);

    await tick();
    // The window moved on: 2 s to 12 s, 100 MiB sampled, of which ECore's 15 - 2 = 13 MiB.
    expect(line()).toEqual(['10.0 MiB/s', 'ECore ≈ 1.3 MiB/s (13 %), over 10 s']);
  });

  it("says when ECore's share is off (emc2.monitor.allocation=false)", async () => {
    const off = (s: number) => snapshot(s * 1000, [], [], { totalBytes: s * 1024 * 1024, sampling: false });
    show(off(0), off(2));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await tick();

    const tile = within(screen.getByRole('region', { name: 'Core' })).getByRole('group', { name: 'Allocation' });
    expect([...tile.children].map((c) => c.textContent)).toEqual(['Allocation', '1.0 MiB/s', "over 2 s; ECore's share: off"]);
  });

  it("lists a plugin's capabilities and marks a fault a browser reported, naming the capability (SDK 1.4.0, ADR-0044)", async () => {
    show(snapshot(10_000, [
      plugin('grib', { name: 'GRIB', capabilities: ['temporal'],
        capabilityFault: { problem: 'capability temporal declared but implemented by neither part (ADR-0044 point 4)', atMillis: Date.parse('2026-11-06T09:15:00Z') } }),
      plugin('cot', { name: 'Cursor on Target' }),
    ]));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const grib = screen.getByRole('button', { name: 'GRIB' });
    fireEvent.click(grib);
    fireEvent.click(screen.getByRole('button', { name: 'Cursor on Target' }));

    const details = document.getElementById(grib.getAttribute('aria-controls') ?? '')?.textContent ?? '';
    expect(details).toContain('Capabilities: temporal (ADR-0044)');
    expect(details).toContain('A browser found at 09:15 UTC: capability temporal declared but implemented by neither part (ADR-0044 point 4).');
    expect(grib.closest('tr')?.className, 'it needs a look').toBe('attention-warn');
    const cot = screen.getByRole('button', { name: 'Cursor on Target' });
    expect(document.getElementById(cot.getAttribute('aria-controls') ?? '')?.textContent).toContain('Capabilities: none');
  });

  it('opens a plugin\'s workers, caps, listeners, declared internet use and updates not saved', async () => {
    show(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const toggle = screen.getByRole('button', { name: 'Cursor on Target' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.textContent)
      .toContain('Asks waiting 2 of at most 10000 (0 refused) · timers 1 of at most 1000 (4 refused)');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.textContent).toContain(
      'Reaches outside hosts: Fetches the feeds. Demos only. With its default settings: tak.example.org, feeds.example.org. '
      + 'Its settings may name other hosts (ADR-0030).',
    );
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.textContent)
      .toContain("Updates not saved since the start: 1200 (a running simulation's moves; ADR-0041).");
    const coordinates = screen.getByRole('button', { name: 'Coordinates' });
    fireEvent.click(coordinates);
    expect(document.getElementById(coordinates.getAttribute('aria-controls') ?? '')?.textContent).not.toContain('Reaches outside hosts');
    expect(document.getElementById(coordinates.getAttribute('aria-controls') ?? '')?.textContent).not.toContain('not saved');
    const parser = within(screen.getByRole('table', { name: 'Cursor on Target: workers' })).getByRole('row', { name: /^parser/ });
    expect(parser.className).toBe('attention-bad');
    const tak = within(screen.getByRole('table', { name: 'Cursor on Target: listeners' })).getByRole('row', { name: /^tak-north/ });
    expect([...tak.querySelectorAll('td')].map((c) => c.textContent)).toEqual(['tak.example:8089', 'no', '2.0 KiB', '10 B', '3']);
    expect(tak.querySelector('th')?.textContent).toBe('tak-north Check');
  });

  it('shows a plugin\'s connection tasks and declared connections, with what needs a look and the counters\' rates', async () => {
    const tasks = (received: number) => [
      task('cot', 'tak-north', { id: 1, peer: '10.0.0.5:8089 (tak.example)', counters: { received, sent: 40 }, details: { protocol: 'CoT 2.0' },
        lastActivityMillis: 9_000, queued: 3, coalesced: 7 }),
      task('cot', 'tak-south', { state: 'RESTARTING', restarts: 2, nextMillis: 11_000, reason: 'java.net.ConnectException: refused' }),
      task('cot', 'udp-in', { state: 'FAILED', reason: 'java.net.BindException: in use' }),
      task('cot', 'udp-out', { state: 'STOPPED', reason: 'stopped; waiting for an earlier run of its name to end' }),
    ];
    const cot = (atMillis: number, received: number) => snapshot(atMillis, [plugin('cot', {
      name: 'Cursor on Target', listeners: [{ ...listener, connected: true }], tasks: tasks(received),
      connections: [{ kinds: ['tcp-client', 'udp'], direction: 'both', settings: '/links', reason: 'CoT to and from TAK Servers.' }],
    })], []);
    show(cot(10_000, 100), cot(12_000, 140));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const row = within(screen.getByRole('table', { name: 'Plugins' })).getAllByRole('row')[1];
    expect(row?.querySelectorAll('td')[6]?.textContent, 'tasks and listeners together').toBe('2 of 5 running');
    expect(row?.className, 'a failed task is a problem').toBe('attention-bad');
    const toggle = screen.getByRole('button', { name: 'Cursor on Target' });
    fireEvent.click(toggle);
    await tick();

    const details = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(details?.textContent).toContain('Declares connections (ADR-0036): tcp-client, udp; receives and sends, configured at /links in its '
      + 'settings. CoT to and from TAK Servers.');
    const table = within(screen.getByRole('table', { name: 'Cursor on Target: connection tasks' }));
    const cells = (name: RegExp) => [...table.getByRole('row', { name }).querySelectorAll('td')].map((c) => c.textContent);
    expect(cells(/^tak-north/)).toEqual(['running', '7 s', '0', '–', '10.0.0.5:8089 (tak.example)', 'received 140 (20.0/s) · sent 40 (0.0/s) · protocol: CoT 2.0',
      '3 queued, 7 replaced', '3 s ago']);
    expect(cells(/^tak-south/)[0]).toMatch(/^restarting at .+ \(java\.net\.ConnectException: refused\)$/);
    expect(cells(/^udp-in/)[0]).toBe('failed: java.net.BindException: in use');
    expect(cells(/^udp-out/)[0]).toBe('stopped; waiting for an earlier run of its name to end');
    expect(table.getByRole('row', { name: /^tak-north/ }).className).toBe('');
    expect(table.getByRole('row', { name: /^tak-south/ }).querySelector('.attention-mark')?.textContent).toBe('Check');
    expect(table.getByRole('row', { name: /^udp-in/ }).querySelector('.attention-mark')?.textContent).toBe('Problem');
    expect(table.getByRole('row', { name: /^udp-out/ }).querySelector('.attention-mark')?.textContent, 'the pile-up shows').toBe('Check');
  });

  it('shows the output channels a plugin offers, what was sent to each and how its plugin keeps up', async () => {
    const cot = (atMillis: number, sent: number, delivered: number) => snapshot(atMillis, [plugin('cot', {
      name: 'Cursor on Target', channels: [
        channel('cot', 'tak-north', { name: 'TAK North (out)', canDelete: true, sent, delivered, replaced: 12, pending: 4, inFlight: 2 }),
        channel('cot', 'tak-south', { name: 'TAK South (out)', sent: 900, delivered: 300, dropped: 600, pending: 10_000 }),
        channel('cot', 'poses', { name: 'Poses (in)', outputType: 'pose', declaredKinds: ['cot.camera-pose'] }), // SDK 1.9.0
      ],
    })], []);
    show(cot(10_000, 100, 90), cot(12_000, 140, 120));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const row = within(screen.getByRole('table', { name: 'Plugins' })).getAllByRole('row')[1];
    expect(row?.className, 'a channel that dropped items').toBe('attention-warn');
    fireEvent.click(screen.getByRole('button', { name: 'Cursor on Target' }));
    await tick();

    const table = within(screen.getByRole('table', { name: 'Cursor on Target: output channels' }));
    const cells = (name: RegExp) => [...table.getByRole('row', { name }).querySelectorAll('td')].map((c) => c.textContent);
    expect(cells(/^TAK North/)).toEqual(['cot, with deletes', '140 (20.0/s)', '120 (15.0/s)', '12', '0', '4 pending, 2 handed over']);
    expect(cells(/^TAK South/)).toEqual(['cot', '900 (0.0/s)', '300 (0.0/s)', '0', '600', '10000 pending']);
    expect(cells(/^Poses/)[0], 'SDK 1.9.0: the declared kinds it takes').toBe('pose; takes cot.camera-pose');
    expect(table.getByRole('row', { name: /^TAK North/ }).querySelector('th')?.textContent).toBe('TAK North (out) (cot/tak-north)');
    expect(table.getByRole('row', { name: /^TAK South/ }).querySelector('.attention-mark')?.textContent).toBe('Check');
  });

  it("shows a plugin's compute threads against the server's cap, each task's busy share and CPU time (SDK 1.9.0)", async () => {
    const fmv = (atMillis: number, runMillis: number, waitMillis: number, held: number) => {
      const s = snapshot(atMillis, [plugin('fmv', {
        name: 'Full motion video', compute: {
          declared: 4, reason: 'Renders one simulated camera per thread.', allowed: 2, running: 2, refusals: { PLUGIN_LIMIT: 3 },
          tasks: [
            computeTask('camera-north', { id: 11, runMillis, waitMillis, cpuMillis: 1_500, counters: { rendered: 250 }, details: { size: '1280x720' } }),
            computeTask('camera-south', { id: 12, hung: true, state: 'STOPPING' }),
          ],
        },
      })], []);
      return { ...s, core: { ...s.core, compute: { cap: 7, held } } };
    };
    show(fmv(10_000, 4_000, 3_000, 2), fmv(12_000, 6_000, 3_500, 3));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    fireEvent.click(screen.getByRole('button', { name: 'Full motion video' }));
    await tick();
    expect(screen.getByText('3 of 7'), 'the second answer').toBeTruthy();
    expect(screen.getByText(/Compute threads: 2 running of 2 allowed \(declares 4: Renders one simulated camera per thread\.\) · refused starts: 3 at the plugin's number/))
      .toBeTruthy();
    const table = within(screen.getByRole('table', { name: 'Full motion video: compute tasks' }));
    const cells = (name: RegExp) => [...table.getByRole('row', { name }).querySelectorAll('td')].map((c) => c.textContent);
    expect(cells(/^camera-north/)).toEqual(['running', '7 s', '0', '75 %', '1.5 s', 'rendered 250 · size: 1280x720', '0 queued']);
    expect(cells(/^camera-south/)[0]).toBe('did not end after its stop');
    expect(table.getByRole('row', { name: /^camera-south/ }).className).toBe('attention-bad');
  });

  it("shows a plugin's streams to its web part, its viewers, bytes and losses, and marks one that lost data (SDK 1.8.0)", async () => {
    const stream = (name: string, change: Partial<MonitorStream> = {}): MonitorStream => ({
      plugin: 'fmv', name, mediaType: 'video/mp2t', viewers: 0, bytesIn: 0, bytesOut: 0, dropped: 0, losses: 0, startBufferBytes: 0, ...change,
    });
    show(snapshot(10_000, [plugin('fmv', {
      name: 'FMV', streams: [
        stream('link-1', { viewers: 2, bytesIn: 3 * 1024 * 1024, bytesOut: 6 * 1024 * 1024, startBufferBytes: 512 * 1024 }),
        stream('link-2', { losses: 3 }),
      ],
    })], []));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const row = within(screen.getByRole('table', { name: 'Plugins' })).getAllByRole('row')[1];
    expect(row?.className, 'a stream whose viewers lost data').toBe('attention-warn');
    fireEvent.click(screen.getByRole('button', { name: 'FMV' }));
    await tick();

    const table = within(screen.getByRole('table', { name: 'FMV: streams' }));
    const cells = (name: RegExp) => [...table.getByRole('row', { name }).querySelectorAll('td')].map((c) => c.textContent);
    expect(cells(/^link-1/)).toEqual(['2', '3.0 MiB', '6.0 MiB', '0', '0', '512 KiB']);
    expect(cells(/^link-2/)).toEqual(['0', '0 B', '0 B', '0', '3', '0 B']);
    expect(table.getByRole('row', { name: /^link-1/ }).querySelector('th')?.textContent).toBe('link-1 (video/mp2t)');
    expect(table.getByRole('row', { name: /^link-2/ }).querySelector('.attention-mark')?.textContent).toBe('Check');
  });

  it("shows a plugin's conversions with their state, bytes, CPU and why one failed, and marks a failed one (T-211)", async () => {
    const conversion = (stream: string, change: Partial<MonitorConversion> = {}): MonitorConversion => ({
      plugin: 'fmv', stream, kind: 'conversion', state: 'RUNNING', bytesIn: 0, bytesOut: 0, dropped: 0, lostOutputs: 0, cpuMillis: -1, detail: '', ...change,
    });
    show(snapshot(10_000, [plugin('fmv', {
      name: 'FMV', conversions: [
        conversion('link-1', { bytesIn: 2 * 1024 * 1024, bytesOut: 1024 * 1024, cpuMillis: 75_000 }),
        conversion('link-2', { state: 'FAILED', detail: 'START: no output 10 s after its first input' }),
        conversion('camera-1', { kind: 'encoder', bytesIn: 3 * 1024 * 1024, bytesOut: 64 * 1024, dropped: 2, lostOutputs: 1 }), // SDK 1.9.0
      ],
    })], []));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const row = within(screen.getByRole('table', { name: 'Plugins' })).getAllByRole('row')[1];
    expect(row?.className, 'a failed conversion').toBe('attention-warn');
    fireEvent.click(screen.getByRole('button', { name: 'FMV' }));
    await tick();

    const table = within(screen.getByRole('table', { name: 'FMV: conversions' }));
    const cells = (name: RegExp) => [...table.getByRole('row', { name }).querySelectorAll('td')].map((c) => c.textContent);
    expect(cells(/^link-1/)).toEqual(['Running', '2.0 MiB', '1.0 MiB', '0', '1 min 15 s', '']);
    expect(cells(/^link-2/)).toEqual(['Failed', '0 B', '0 B', '0', '–', 'START: no output 10 s after its first input']);
    expect(table.getByRole('row', { name: /^camera-1/ }).querySelector('th')?.textContent).toBe('camera-1 (encoder) Check');
    expect(cells(/^camera-1/)).toEqual(['Running', '3.0 MiB', '64.0 KiB', '2 pictures, 1 lost out', '–', '']);
  });

  it('says where the hosts come from when a plugin declares internet use without default hosts (CR-0022)', async () => {
    show(snapshot(10_000, [plugin('cot', {
      name: 'Cursor on Target', internet: { hosts: [], reason: 'Connects to the TAK servers its links name.' },
    })], []));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const toggle = screen.getByRole('button', { name: 'Cursor on Target' });
    fireEvent.click(toggle);

    const details = document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.textContent;
    expect(details).toContain('Reaches outside hosts: Connects to the TAK servers its links name. The hosts come from its settings (ADR-0030).');
    expect(details).not.toContain('With its default settings');
  });

  it('shows each local folder with its path and whether ECore can read it, and marks one it cannot (ADR-0049 point 4)', async () => {
    const folder = { plugin: 'terrain', reason: 'Height data.', setting: '/heightDataFolder' };
    show(snapshot(10_000, [plugin('terrain', { name: 'Terrain', folders: [
      { ...folder, id: 'heights', path: 'D:\\dted', state: 'READABLE' },
      { ...folder, id: 'tiffs', path: null, state: 'NOT_SET' },
      { ...folder, id: 'old', path: '/data/gone', state: 'MISSING' },
      { ...folder, id: 'local', path: '%emcc%/settings/terrain', resolved: 'C:\\emcc\\settings\\terrain', state: 'READABLE' }, // SDK 1.6.0
    ] })], []));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const toggle = screen.getByRole('button', { name: 'Terrain' });
    expect(toggle.closest('tr')?.querySelector('.attention-mark')?.textContent, 'a folder that cannot be read').toBe('Check');
    fireEvent.click(toggle);
    const table = within(screen.getByRole('table', { name: 'Terrain: local folders' }));
    const cells = (name: RegExp) => within(table.getByRole('row', { name })).getAllByRole('cell').map((c) => c.textContent);
    expect(cells(/^heights/)).toEqual(['readable', 'D:\\dted (setting /heightDataFolder)', 'Height data.']);
    expect(cells(/^tiffs/)).toEqual(['not set', '– (setting /heightDataFolder)', 'Height data.']);
    expect(cells(/^old/)[0]).toBe('cannot be read');
    expect(cells(/^local/)[1], 'as typed, then the folder it resolves to').toBe('%emcc%/settings/terrain (setting /heightDataFolder) → C:\\emcc\\settings\\terrain');
    expect(table.getByRole('row', { name: /^old/ }).querySelector('.attention-mark')?.textContent).toBe('Check');
    expect(table.getByRole('row', { name: /^tiffs/ }).querySelector('.attention-mark'), 'not set yet is no fault').toBeNull();
  });

  it('says why it shows nothing, and keeps the last answer when a later one fails', async () => {
    show(new Response('', { status: 403 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('alert').textContent).toBe('This needs the settings.admin permission.');
    cleanup();

    show(first, new Response('', { status: 503 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await tick();
    expect(screen.getByRole('alert').textContent).toBe('The server answered HTTP 503. Showing the last answer.');
    expect(screen.getByRole('table', { name: 'Plugins' })).toBeTruthy();
  });

  it('asks again on the next tick after a request that threw', async () => {
    const services = settingsServices();
    const snapshotOf = vi.spyOn(services.monitor, 'snapshot')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: true, value: first });
    render(<MonitorView services={services} plugins={[]} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('alert').textContent).toBe('The monitor failed: Error: boom');

    await tick();

    expect(snapshotOf).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('table', { name: 'Plugins' })).toBeTruthy();
  });

  it('asks every 2 s only while the page is visible, and stops when the tab closes', async () => {
    const { doFetch, view } = show(first);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(doFetch).toHaveBeenCalledTimes(1);
    await tick();
    expect(doFetch).toHaveBeenCalledTimes(2);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await tick();
    await tick();
    expect(doFetch).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(doFetch).toHaveBeenCalledTimes(3);
    visibility.mockRestore();

    view.unmount();
    await tick();
    expect(doFetch).toHaveBeenCalledTimes(3);
    expect(doFetch.mock.calls[0]?.[0]).toBe('/api/monitor');
  });
});
