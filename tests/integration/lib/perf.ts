import { type Browser, type CDPSession, type Page, type TestInfo, type WebSocket } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, release, totalmem, type as osType } from 'node:os';
import { join } from 'node:path';
import { mapPane, type Point } from './m0';

// Measuring in the browser for the performance suite (T-031), through Chromium's DevTools protocol
// (Playwright's CDP session; nothing installed). Every number is recorded, none is a pass or fail.

type ProbeWindow = Window & {
  __itaProbe?: {
    mapView: {
      pick(pixel: [number, number], tolerance?: number): readonly string[];
      readonly renderingMode: string;
      readonly renderer: string | null;
      readonly viewport: { center: [number, number]; resolution: number; projection: string; visibleArea: [number, number][] };
      readonly selection: { set(ids: readonly string[]): void };
      dragObject(id: string): Promise<[number, number] | null>;
    };
  };
  __itaFrames?: number[];
  __itaFramesOn?: boolean;
  __itaLongTasks?: number[];
  __itaLongObserver?: PerformanceObserver;
  __itaInMapView?: Promise<number>;
  __itaDrag?: Promise<[number, number] | null>;
};

export async function cdpOf(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  return cdp;
}

/** The JavaScript heap after a full garbage collection, in MiB. */
export async function heap(cdp: CDPSession) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize, totalSize } = await cdp.send('Runtime.getHeapUsage');
  return { usedMiB: round(usedSize / 2 ** 20), totalMiB: round(totalSize / 2 ** 20) };
}

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

/**
 * The share of wall time the page's main thread was busy while `action` ran (criterion 9: "blocked
 * less than 30 % of the time"): Chromium's TaskDuration, ScriptDuration, LayoutDuration and
 * RecalcStyleDuration, with the long tasks (over 50 ms) seen meanwhile.
 */
export async function mainThreadDuring<T>(page: Page, cdp: CDPSession, action: () => Promise<T>) {
  await page.evaluate(() => {
    const w = window as ProbeWindow;
    w.__itaLongTasks = [];
    w.__itaLongObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__itaLongTasks!.push(entry.duration);
    });
    w.__itaLongObserver.observe({ type: 'longtask' });
  });
  const before = await metrics(cdp);
  const result = await action();
  const after = await metrics(cdp);
  const longTasks = await page.evaluate(() => {
    const w = window as ProbeWindow;
    for (const entry of w.__itaLongObserver?.takeRecords() ?? []) w.__itaLongTasks!.push(entry.duration);
    w.__itaLongObserver?.disconnect();
    return w.__itaLongTasks ?? [];
  });
  const wall = after.Timestamp - before.Timestamp;
  const share = (name: string) => round((after[name] - before[name]) / wall, 3);
  return {
    result,
    mainThread: {
      wallSeconds: round(wall),
      busyShare: share('TaskDuration'),
      scriptShare: share('ScriptDuration'),
      layoutShare: share('LayoutDuration'),
      styleShare: share('RecalcStyleDuration'),
      longTasks: { count: longTasks.length, totalMs: round(sum(longTasks)), maxMs: round(Math.max(0, ...longTasks)) },
    },
  };
}

/**
 * Frames while `action` runs, from requestAnimationFrame timestamps: frames per second, and the gaps
 * between frames (criterion 8 without a GPU: "no frame gap above 0.5 s").
 */
export async function framesDuring(page: Page, action: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as ProbeWindow;
    w.__itaFrames = [];
    w.__itaFramesOn = true;
    const tick = (t: number) => {
      if (!w.__itaFramesOn) return;
      w.__itaFrames!.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await action();
  const times = await page.evaluate(() => {
    const w = window as ProbeWindow;
    w.__itaFramesOn = false;
    return w.__itaFrames ?? [];
  });
  return frameStats(times);
}

export function frameStats(times: number[]) {
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const seconds = times.length > 1 ? (times.at(-1)! - times[0]) / 1000 : 0;
  return {
    frames: times.length,
    seconds: round(seconds),
    fps: seconds > 0 ? round((times.length - 1) / seconds, 1) : null,
    gapMs: { p50: round(at(gaps, 50)), p95: round(at(gaps, 95)), max: round(gaps.at(-1) ?? 0) },
    gapsOver500ms: gaps.filter((g) => g > 500).length,
  };
}

type ProfileNode = { id: number; callFrame: { functionName: string; url: string; lineNumber: number } };

/**
 * A CPU profile of the page for `ms`: where the main thread spent its time, by function (self
 * time) and by script. For remark N7 (the map view's cost with 100 000 objects). Only the top
 * functions are kept: one that is missing is "not among the top", not "not seen".
 */
export async function cpuProfile(cdp: CDPSession, ms: number, during?: () => Promise<void>) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const started = Date.now();
  await during?.();
  const left = ms - (Date.now() - started);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable');
  return summarizeProfile(profile as { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] });
}

export function summarizeProfile(profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }, top = 20) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const byFunction = new Map<string, number>();
  const byScript = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    // timeDeltas[i + 1] is the time from sample i to the next one: sample i's share.
    const us = profile.timeDeltas[i + 1] ?? 0;
    const frame = nodes.get(profile.samples[i])!.callFrame;
    total += us;
    const script = scriptOf(frame.url, frame.functionName);
    const name = `${frame.functionName || '(anonymous)'} ${script}${frame.url ? `:${frame.lineNumber + 1}` : ''}`;
    byFunction.set(name, (byFunction.get(name) ?? 0) + us);
    byScript.set(script, (byScript.get(script) ?? 0) + us);
  }
  const rank = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, us]) => ({ name, ms: round(us / 1000), share: round(us / total, 3) }));
  return { sampledMs: round(total / 1000), byScript: rank(byScript, 12), byFunction: rank(byFunction, top) };
}

/** A short name for a script: the plugin's id, the shell, or the bundle file. */
function scriptOf(url: string, functionName: string): string {
  if (!url) return functionName.startsWith('(') ? functionName : '(native)';
  const path = new URL(url, 'http://x').pathname;
  const plugin = /\/plugins\/([^/]+)\//.exec(path);
  if (plugin) return plugin[1];
  return path.split('/').at(-1) ?? path;
}

type TraceEvent = { name: string; ph: string; ts: number; dur?: number; pid: number; tid: number; args?: { name?: string } };

/**
 * A Chromium trace while `during` runs: the time on the page's main thread (CrRendererMain) by
 * trace event, for what the JavaScript profiler shows only as "(program)" (native work: drawing,
 * WebGL, compositing). `topLevel` counts each task once; `inclusive` counts an event with what it
 * contains, so nested names add up to more than the wall time.
 */
export async function traceMainThread(cdp: CDPSession, during: () => Promise<void>) {
  const categories = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'v8', 'toplevel', 'webgl'].join(',');
  await cdp.send('Tracing.start', { categories, transferMode: 'ReturnAsStream' });
  const started = Date.now();
  await during();
  const wallMs = Date.now() - started;
  const complete = new Promise<{ stream: string; dataLoss: boolean }>((resolve) =>
    cdp.once('Tracing.tracingComplete', (e) => resolve({ stream: e.stream!, dataLoss: e.dataLossOccurred })),
  );
  await cdp.send('Tracing.end');
  const { stream: handle, dataLoss } = await complete;
  let text = '';
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle });
    text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
    if (chunk.eof) break;
  }
  await cdp.send('IO.close', { handle });
  const parsed = JSON.parse(text) as { traceEvents: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const main = events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  // The page's renderer is the one with the most work on its main thread (other renderers idle).
  const work = (pid: number, tid: number) => events.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X').reduce((a, e) => a + (e.dur ?? 0), 0);
  const thread = main.sort((a, b) => work(b.pid, b.tid) - work(a.pid, a.tid))[0];
  const own = events.filter((e) => thread && e.pid === thread.pid && e.tid === thread.tid && e.ph === 'X' && e.dur !== undefined).sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0)); // a parent before its child at the same time
  const inclusive = new Map<string, number>();
  const topLevel = new Map<string, number>();
  let openUntil = -Infinity;
  for (const e of own) {
    inclusive.set(e.name, (inclusive.get(e.name) ?? 0) + e.dur!);
    if (e.ts >= openUntil) {
      topLevel.set(e.name, (topLevel.get(e.name) ?? 0) + e.dur!);
      openUntil = e.ts + e.dur!;
    }
  }
  const rank = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, us]) => ({ name, ms: round(us / 1000), share: round(us / 1000 / wallMs, 3) }));
  // Chromium reports when its trace buffer overflowed: then the shares are too low.
  return { wallMs, dataLoss, topLevel: rank(topLevel, 8), inclusive: rank(inclusive, 25) };
}

/** The machine, the browser and how the map view draws: recorded with every result. */
export async function machine(browser: Browser, page: Page, testInfo: TestInfo) {
  const map = await page.evaluate(() => {
    const view = (window as ProbeWindow).__itaProbe!.mapView;
    return { renderingMode: view.renderingMode, renderer: view.renderer };
  });
  return {
    cpu: cpus()[0]?.model.trim() ?? 'unknown',
    cores: availableParallelism(),
    memoryGiB: round(totalmem() / 2 ** 30, 1),
    os: `${osType()} ${release()}`,
    browser: `Chromium ${browser.version()}`,
    headless: testInfo.project.use.headless ?? true,
    viewport: page.viewportSize(),
    ...map,
  };
}

/** A page pixel as the map view's pixel (MapView.pick and the viewport count from the Map Pane's corner). */
export async function mapPixel(page: Page, point: Point): Promise<[number, number]> {
  const box = (await mapPane(page).boundingBox())!;
  return [point.x - box.x, point.y - box.y];
}

/** The ids MapView.pick finds at a page pixel; none while the probe has not started yet (page load). */
export async function pickAt(page: Page, point: Point, tolerance = 2): Promise<readonly string[]> {
  const pixel = await mapPixel(page, point);
  return page.evaluate(([p, t]) => (window as ProbeWindow).__itaProbe?.mapView.pick(p, t) ?? [], [pixel, tolerance] as const);
}

/** The map view's viewport (lon/lat corners of the visible area, resolution, projection). */
export async function viewport(page: Page) {
  return page.evaluate(() => (window as ProbeWindow).__itaProbe!.mapView.viewport);
}

export type Sentinel = { id: string; pixel: [number, number] };

/**
 * Before the app loads: watches until MapView.pick finds every sentinel object at its pixel. They
 * are created last, so then the whole load has reached the map view. `window.__itaInMapView`
 * resolves with that time in ms since navigation start. This is not the time the pixels show:
 * pick works on the map view's data, and drawing can take a frame longer.
 */
export async function watchInMapView(page: Page, sentinels: Sentinel[]) {
  await page.addInitScript((list: Sentinel[]) => {
    const w = window as ProbeWindow;
    w.__itaInMapView = new Promise((resolve) => {
      const check = () => {
        const view = w.__itaProbe?.mapView;
        if (view !== undefined && list.every((s) => view.pick(s.pixel, 2).includes(s.id))) resolve(performance.now());
        else setTimeout(check, 20);
      };
      check();
    });
  }, sentinels);
}

export async function inMapViewTime(page: Page) {
  return page.evaluate(() => (window as ProbeWindow).__itaInMapView!);
}

/**
 * Before the app loads: records when the page's live picture WebSocket closes. A browser that does
 * not keep up is disconnected by the server (1013, server/README.md), and the shell reconnects.
 */
export function watchLiveSocket(page: Page) {
  const closes: string[] = [];
  page.on('websocket', (socket: WebSocket) => {
    if (!socket.url().endsWith('/api/live')) return;
    socket.on('close', () => closes.push(new Date().toISOString()));
  });
  return closes;
}

export async function select(page: Page, ids: readonly string[]) {
  await page.evaluate((list) => (window as ProbeWindow).__itaProbe!.mapView.selection.set(list), ids);
}

/** Starts MapView.dragObject for an object; `dropped` resolves with what the drag returned. */
export async function startDrag(page: Page, id: string) {
  await page.evaluate((objectId) => {
    const w = window as ProbeWindow;
    w.__itaDrag = w.__itaProbe!.mapView.dragObject(objectId);
  }, id);
  return { dropped: () => page.evaluate(() => (window as ProbeWindow).__itaDrag!) };
}

/** Writes a result as JSON into the run's output folder and attaches it to the test. */
export async function saveResult(testInfo: TestInfo, name: string, data: unknown) {
  const folder = join(process.env.EMC2_OUT ?? 'out/manual', 'performance');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${name}-${testInfo.repeatEachIndex + 1}.json`);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  await testInfo.attach(name, { path: file, contentType: 'application/json' });
}

function at(sorted: number[], p: number) {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

function round(value: number, digits = 1) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
