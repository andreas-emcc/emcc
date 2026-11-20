// Turns the performance suite's results (<run>/performance/*.json) into Markdown tables for
// docs/test-reports/: the median of the repetitions, with the range when there are several.
//
// Usage: node tests/integration/performance-report.mjs <run folder> [<run folder> ...]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const folders = process.argv.slice(2);
if (folders.length === 0) {
  console.error('Usage: node tests/integration/performance-report.mjs <run folder> [<run folder> ...]');
  process.exitCode = 2;
} else {
  report(folders);
}

function report(runFolders) {
  /** case name → results of its repetitions */
  const cases = new Map();
  for (const folder of runFolders) {
    const dir = join(folder, 'performance');
    // Only the map view's results; other cases (e.g. cot-load) have reports of their own.
    for (const file of readdirSync(dir).filter((f) => f.startsWith('map-view-') && f.endsWith('.json')).sort()) {
      const name = file.replace(/^map-view-/, '').replace(/-\d+\.json$/, '');
      const list = cases.get(name) ?? [];
      list.push(JSON.parse(readFileSync(join(dir, file), 'utf8')));
      cases.set(name, list);
    }
  }
  if (cases.size === 0) {
    console.log('No map view results (map-view-*.json) in these runs.');
    return;
  }
  const order = ['baseline', '10k-in-view', '10k-spread', '100k-in-view', '100k-spread'];
  const names = [...cases.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const first = cases.get(names[0])[0];
  console.log('## Machine\n');
  for (const [key, value] of Object.entries(first.machine)) console.log(`- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  console.log(`- repetitions per case: ${names.map((n) => `${n} ${cases.get(n).length}`).join(', ')}`);

  table('Load (criterion 8)', names, cases, [
    ['objects', (r) => r.objects],
    ['in view at start', (r) => r.inViewAtStart],
    ['created per s', (r) => r.create.perSecond],
    ['in the map view (found by pick), s', (r) => r.load.inMapViewMs / 1000],
    ['heap, MiB', (r) => r.load.heap.usedMiB],
  ]);
  table('Pan and zoom (criterion 8)', names, cases, [
    ['fps', (r) => r.panAndZoom.fps],
    ['gap p50, ms', (r) => r.panAndZoom.gapMs.p50],
    ['gap p95, ms', (r) => r.panAndZoom.gapMs.p95],
    ['gap max, ms', (r) => r.panAndZoom.gapMs.max],
    ['gaps > 0.5 s', (r) => r.panAndZoom.gapsOver500ms],
    ['gestures took, s', (r) => r.panAndZoom.seconds],
  ]);
  table('Dragging a symbol (hover pick on every move)', names, cases, [
    ['fps', (r) => r.drag.fps],
    ['gap p95, ms', (r) => r.drag.gapMs.p95],
    ['gap max, ms', (r) => r.drag.gapMs.max],
    ['gaps > 0.5 s', (r) => r.drag.gapsOver500ms],
    ['drag took, s', (r) => r.drag.seconds],
  ]);
  table('Visible area', names, cases, [
    ['points at start', (r) => r.view.visibleAreaPoints],
    ['points at the widest zoom', (r) => r.widestZoom.visibleAreaPoints],
  ]);
  const streaming = names.filter((n) => cases.get(n)[0].stream);
  if (streaming.length > 0) {
    table('Stream of position changes (criterion 9)', streaming, cases, [
      ['changes per s sent', (r) => r.stream.sent.ratePerSecond],
      ['changes skipped (window full)', (r) => r.stream.sent.skipped],
      ['round trip p50, ms', (r) => r.stream.sent.roundTripMs.p50],
      ['round trip p95, ms', (r) => r.stream.sent.roundTripMs.p95],
      ['main thread busy, %', (r) => r.stream.mainThread.busyShare * 100],
      ['of it JavaScript, %', (r) => r.stream.mainThread.scriptShare * 100],
      ['long tasks', (r) => r.stream.mainThread.longTasks.count],
      ['longest task, ms', (r) => r.stream.mainThread.longTasks.maxMs],
      ['frame gap p95, ms', (r) => r.stream.frames.gapMs.p95],
      ['frame gap max, ms', (r) => r.stream.frames.gapMs.max],
      ['heap after, MiB', (r) => r.stream.heap.usedMiB],
      ['live connection closes', (r) => r.liveSocketCloses?.length],
    ]);
  }
  for (const name of names) {
    const r = cases.get(name)[0];
    console.log(`\n## Where the time goes: ${name} (first repetition)\n`);
    profile('JavaScript during one pan (self time)', r.panProfile);
    trace('Main thread during one pan (Chromium trace, inclusive)', r.panTrace);
    profile('JavaScript during a drag (self time)', r.dragProfile);
    if (r.streamProfile) profile('JavaScript during the stream (self time)', r.streamProfile);
    if (r.streamTrace) trace('Main thread during the stream (Chromium trace, inclusive)', r.streamTrace);
  }
}

function table(title, names, cases, rows) {
  console.log(`\n## ${title}\n`);
  console.log(`| | ${names.join(' | ')} |`);
  console.log(`|---|${names.map(() => '---:').join('|')}|`);
  for (const [label, pick] of rows) {
    const cells = names.map((n) => cell(cases.get(n).map((r) => {
      try {
        return pick(r);
      } catch {
        return null;
      }
    })));
    console.log(`| ${label} | ${cells.join(' | ')} |`);
  }
}

function cell(values) {
  const numbers = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (numbers.length === 0) return '–';
  const median = numbers[Math.floor((numbers.length - 1) / 2)];
  const fmt = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en') : String(Math.round(v * 10) / 10));
  return numbers.length > 1 && numbers[0] !== numbers.at(-1) ? `${fmt(median)} (${fmt(numbers[0])}–${fmt(numbers.at(-1))})` : fmt(median);
}

function profile(title, p) {
  if (!p) return;
  console.log(`\n${title}, ${Math.round(p.sampledMs).toLocaleString('en')} ms sampled:\n`);
  console.log('| Function | ms | share |\n|---|---:|---:|');
  for (const f of p.byFunction.slice(0, 10)) console.log(`| \`${f.name}\` | ${f.ms} | ${Math.round(f.share * 1000) / 10} % |`);
}

function trace(title, t) {
  if (!t) return;
  console.log(`\n${title}, ${Math.round(t.wallMs).toLocaleString('en')} ms wall${t.dataLoss ? ' (Chromium lost trace data: the shares are too low)' : ''}:\n`);
  console.log('| Event | ms | share of wall time |\n|---|---:|---:|');
  for (const e of t.inclusive.slice(0, 10)) console.log(`| \`${e.name}\` | ${e.ms} | ${Math.round(e.share * 1000) / 10} % |`);
}
