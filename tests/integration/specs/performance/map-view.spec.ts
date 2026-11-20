import { expect, test, type Page } from '@playwright/test';
import { seededLayer } from '../../lib/live.mjs';
import { grid, LoadClient, symbolData } from '../../lib/load.mjs';
import { positionAt, visibleMap, withM0, type LonLat, type Point } from '../../lib/m0';
import {
  cdpOf,
  cpuProfile,
  framesDuring,
  heap,
  inMapViewTime,
  machine,
  mainThreadDuring,
  mapPixel,
  pickAt,
  saveResult,
  startDrag,
  traceMainThread,
  viewport,
  watchInMapView,
  watchLiveSocket,
  type Sentinel,
} from '../../lib/perf';

// The map view under load (T-031; docs/plugins/briefs/map-view-2d.md criteria 8 and 9, review
// remark N7 and the hover pick during a drag). Measured, not gated: a test fails only when
// something does not work (an object missing, a console error, a refused change, a lost
// connection), never because of a number. Run with: node tests/integration/run.mjs --performance
// Every number goes to <run>/performance/*.json; docs/test-reports/ has the report.

test.describe.configure({ timeout: 30 * 60_000 });
// Playwright's trace takes a snapshot of the page, the map's canvas included, at every mouse action:
// that alone made each pan step cost hundreds of milliseconds here. Measure without it.
test.use({ trace: 'off', screenshot: 'off' });

const STREAM_RATE = 1_000;
const STREAM_SECONDS = 60;
const PROFILE_MS = 10_000;
/** Long enough to hold several whole frames even when one takes seconds (100 000 in view). */
const TRACE_MS = 30_000;

/** Where the sentinels go, as fractions of the visible map (left of the Control Pane). */
const SENTINEL_SPOTS = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.5, 0.5],
  [0.25, 0.75],
  [0.75, 0.75],
] as const;

type Box = [number, number, number, number];

function bounds(area: readonly LonLat[]): Box {
  const lons = area.map((p) => p[0]);
  const lats = area.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/**
 * Where the objects go. "in view": all over the visible area, the worst case for drawing without a
 * GPU (every symbol drawn, overlapping). "spread": over an area 4 times as wide and 3 times as high
 * around it, so only part is in view at the start.
 */
function layoutBox([west, south, east, north]: Box, layout: 'in view' | 'spread'): Box {
  if (layout === 'in view') return [west, south, east, north];
  const [lon, lat] = [(west + east) / 2, (south + north) / 2];
  const [w, h] = [(east - west) * 2, (north - south) * 1.5];
  return [Math.max(-179, lon - w), Math.max(-80, lat - h), Math.min(179, lon + w), Math.min(80, lat + h)];
}

function inBox([lon, lat]: LonLat, [west, south, east, north]: Box) {
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

async function visibleCentre(page: Page): Promise<Point> {
  const box = await visibleMap(page);
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** A pan as a user does it: press, move steadily (50 ms per step), rest, release. */
async function pan(page: Page, from: Point, dx: number, dy: number, steps = 30) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/** Three wheel steps in, then three out, 700 ms apart (OpenLayers animates each for 250 ms). */
async function zoomInAndOut(page: Page, at: Point) {
  await page.mouse.move(at.x, at.y);
  for (const deltaY of [-100, -100, -100, 100, 100, 100]) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(700);
  }
}

async function panAndZoom(page: Page) {
  const centre = await visibleCentre(page);
  await pan(page, centre, 240, 140);
  await pan(page, { x: centre.x + 240, y: centre.y + 140 }, -240, -140);
  await zoomInAndOut(page, centre);
}

/**
 * Puts the view back (MapView.goTo) and waits until the map view reports it: the centre within
 * 10⁻⁴ degrees and the resolution within 1 %. A resolution beyond the map's limits is clamped:
 * then it waits until the view stops changing.
 */
async function restoreView(page: Page, view: { center: LonLat; resolution: number }) {
  await page.evaluate(({ center, resolution }) => {
    (window as unknown as { __itaProbe: { mapView: { goTo(c: LonLat, r: number): void } } }).__itaProbe.mapView.goTo(center, resolution);
  }, view);
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await viewport(page);
        const there =
          Math.abs(now.center[0] - view.center[0]) < 1e-4 && Math.abs(now.center[1] - view.center[1]) < 1e-4 && Math.abs(now.resolution / view.resolution - 1) < 0.01;
        const key = `${now.center[0]},${now.center[1]},${now.resolution}`;
        const still = key === last;
        last = key;
        return there || still;
      },
      { timeout: 120_000, intervals: [250] },
    )
    .toBe(true);
}

/** Drags a symbol with MapView.dragObject, as draw-symbols does: the hover pick runs on every move. */
async function dragSymbol(page: Page, id: string, from: Point, steps = 30) {
  const drag = await startDrag(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (120 * i) / steps, from.y + (60 * i) / steps);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(250);
  await page.mouse.up();
  const dropped = await drag.dropped();
  expect(dropped, 'the drag ends with a drop position').not.toBeNull();
}

// The baseline has only the sentinels: what the same gestures cost on an almost empty map.
const CASES = [
  { name: 'baseline', count: SENTINEL_SPOTS.length, layout: 'in view' },
  { name: '10k-in-view', count: 10_000, layout: 'in view' },
  { name: '10k-spread', count: 10_000, layout: 'spread' },
  { name: '100k-in-view', count: 100_000, layout: 'in view' },
  { name: '100k-spread', count: 100_000, layout: 'spread' },
] as const;

for (const { name, count, layout } of CASES) {
  const streams = count === 100_000;
  test(`${count.toLocaleString('en')} objects ${layout}: load, pan and zoom, drag${streams ? `, ${STREAM_RATE} changes per second` : ''}`, async ({
    browser,
  }, testInfo) => {
    await withM0(
      testInfo,
      browser,
      async ({ server, live, snapshot, open }) => {
        const layer = seededLayer(snapshot);
        // The shared Node client's subscription would keep every event of the load in this process.
        await live.close();
        // From T-039 the map view gets its area with clusters above its object budget (10 000
        // without a GPU). To measure individual drawing as criteria 8 and 9 describe, the budget is
        // raised to 100 000 (owner, 2026-10-12, option a). "spread" now sends the map view only the
        // objects in its area.
        const settingsUrl = `${server.baseUrl}/api/settings/plugins/map-view-2d`;
        const values = (await (await fetch(settingsUrl)).json()).values;
        const raised = await fetch(settingsUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, softwareBudget: 100_000, hardwareBudget: 100_000 }),
        });
        expect(raised.status, 'the map view budget raised').toBe(200);
        const load = await LoadClient.open(server.baseUrl);
        const result: Record<string, unknown> = { objects: count, layout };

        // 1. An empty map gives the visible area and, through the cursor display, the positions
        //    of the sentinels at known pixels.
        const empty = await open();
        const initial = await viewport(empty);
        const box = await visibleMap(empty);
        const points = SENTINEL_SPOTS.map(([fx, fy]) => ({ x: Math.round(box.x + fx * box.width), y: Math.round(box.y + fy * box.height) }));
        const positions: LonLat[] = [];
        const pixels: [number, number][] = [];
        for (const point of points) {
          positions.push(await positionAt(empty, point));
          pixels.push(await mapPixel(empty, point));
        }
        result.machine = await machine(browser, empty, testInfo);
        result.view = { projection: initial.projection, resolution: initial.resolution, visibleAreaPoints: initial.visibleArea.length, bounds: bounds(initial.visibleArea) };
        await empty.context().close();

        // 2. The load: objects on a grid over the visible area, then the sentinels, last.
        const bulk = grid(layoutBox(bounds(initial.visibleArea), layout), count - points.length);
        result.inViewAtStart = bulk.filter((p) => inBox(p, bounds(initial.visibleArea))).length + points.length;
        const datas = bulk.map((p, i) => symbolData(layer, i, p));
        const created = await load.create(datas);
        const sentinelIds = (await load.create(positions.map((p, i) => symbolData(layer, count - points.length + i, p)))).ids;
        expect(load.summary(), 'every object created').toMatchObject({ applied: count, rejected: 0, unknown: 0, errors: 0 });
        result.create = { ms: created.ms, perSecond: Math.round((count / created.ms) * 1000) };

        // 3. The app opens on the full live picture: time until all of it has reached the map
        //    view (the sentinels are found by pick). When the pixels show is not measured.
        const sentinels: Sentinel[] = sentinelIds.map((id, i) => ({ id, pixel: pixels[i] }));
        let liveCloses: string[] = [];
        const page = await open(async (p) => {
          liveCloses = watchLiveSocket(p);
          await watchInMapView(p, sentinels);
        });
        const inMapView = await inMapViewTime(page);
        const cdp = await cdpOf(page);
        result.load = { inMapViewMs: Math.round(inMapView), heap: await heap(cdp) };

        // 4. Pan and zoom: frames (criterion 8). Then a shorter pan under the JavaScript profiler
        //    (N7), and one in a Chromium trace: what the main thread does outside JavaScript.
        result.panAndZoom = await framesDuring(page, () => panAndZoom(page));
        await restoreView(page, initial);
        const centre = await visibleCentre(page);
        result.panProfile = await cpuProfile(cdp, 0, () => pan(page, centre, 240, 140, 10));
        await restoreView(page, initial);
        result.panTrace = await traceMainThread(cdp, () => pan(page, centre, 240, 140, 10));
        await restoreView(page, initial);

        // 5. The widest zoom: the visible area's size (the map view's handover, N7 follow-up).
        await restoreView(page, { center: initial.center, resolution: 1e6 });
        const widest = await viewport(page);
        result.widestZoom = { resolution: widest.resolution, visibleAreaPoints: widest.visibleArea.length };
        await restoreView(page, initial);

        // 6. Dragging a symbol: frames while the hover pick runs on every pointer move.
        const middle = points[2];
        expect(await pickAt(page, middle), 'the middle sentinel under the pointer').toContain(sentinelIds[2]);
        result.drag = await framesDuring(page, () => dragSymbol(page, sentinelIds[2], middle));
        result.dragProfile = await cpuProfile(cdp, 0, () => dragSymbol(page, sentinelIds[2], middle, 10));
        await restoreView(page, initial);

        // 7. The stream (criterion 9): position changes over all objects at the default cadence.
        if (streams) {
          const objects = created.ids.map((id, i) => ({ id, data: datas[i] }));
          let sent: unknown;
          const { result: frames, mainThread } = await mainThreadDuring(page, cdp, () =>
            framesDuring(page, async () => {
              sent = await load.stream(objects, { rate: STREAM_RATE, seconds: STREAM_SECONDS });
            }),
          );
          result.stream = { sent, mainThread, frames, heap: await heap(cdp) };
          let profiled: unknown;
          result.streamProfile = await cpuProfile(cdp, 0, async () => {
            profiled = await load.stream(objects, { rate: STREAM_RATE, seconds: PROFILE_MS / 1000 });
          });
          result.streamProfileSent = profiled;
          result.streamTrace = await traceMainThread(cdp, async () => {
            await load.stream(objects, { rate: STREAM_RATE, seconds: TRACE_MS / 1000 });
          });
        }
        // The browser kept its live picture connection (the server closes one that does not keep up).
        result.liveSocketCloses = liveCloses;
        expect(liveCloses, "the browser's live picture connection stayed open").toEqual([]);
        result.outcomes = load.summary();
        expect(load.summary(), 'no change refused or lost').toMatchObject({ rejected: 0, unknown: 0, errors: 0, closeCode: null });
        await load.close();
        await saveResult(testInfo, `map-view-${name}`, result);
      },
      { probe: true },
    );
  });
}
