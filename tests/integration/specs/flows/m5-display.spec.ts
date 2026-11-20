// Quick run: @plugin-map-view-2d @plugin-symbology @plugin-gmti @settings
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m5-display.spec.ts
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { inverse } from '../../lib/geodesy.mjs';
import { LiveClient, seededLayer } from '../../lib/live.mjs';
import { colourAround, FRIEND, frameSymbol, HIGHLIGHT, HOSTILE, mapCentre, mapPane, pixelsAround, positionAt, userPause, withM0, type Point } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';
import { decodePng } from '../../lib/png.mjs';

// map-view-2d's display settings in the combined system (docs/plugins/briefs/map-view-2d.md,
// function 35, criteria 77 to 83; owner LZ, 2026-11-09; ADR-0046, SDK 1.4.0 part 5): the user's
// choices stored through PUT /api/display reach the page as the live notice `display`, and the map
// follows them at once, without a reload and without a new live-picture subscription (82). What the
// combined system shows: the symbol size (77), the name under a symbol (78), the black speed vector
// that replaces the map view's own direction arrow, for a friend, a hostile and a vessel (79, LB, LC),
// not picked (80), and the relation lines' switch with gmti's pairing (function 34). From SDK 1.5.0
// part 3 (M6): the speed vector in steps of seconds (function 38, criteria 94 and 95; T-164) and
// sensor reports drawn with symbology's symbol (function 39, criteria 98 and 100). The render
// requests' fields, the vector's length within 1 m, the antimeridian (81) and the load (83) are the
// plugin's unit and load tests. Each test has a server of its own; positions are [lon, lat],
// latitude ≠ longitude.

test.describe.configure({ timeout: 180_000 });

/** "Within 1 s" (criterion 82), plus the time a screenshot of the map takes. */
const AT_ONCE_MS = 2_000;

/**
 * Sets gmti's `detectionFade` (its other settings as they are) and returns what it was: turned off
 * (`fade` left out) for a test of the expiry fade. From M7 RC2 the detections fade in steps by it,
 * on by default, in place of their data type's expiry fade (CR-0042 point 3, owner TC A).
 */
async function setDetectionFade(server: { baseUrl: string }, fade?: unknown): Promise<unknown> {
  const url = `${server.baseUrl}/api/settings/plugins/gmti`;
  const values = (await (await fetch(url)).json()).values;
  const detectionFade = fade ?? { ...values.detectionFade, on: false };
  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, detectionFade }) });
  expect(put.status, `gmti's detectionFade: ${await put.clone().text()}`).toBe(200);
  expect((await (await fetch(url)).json()).values.detectionFade, 'detectionFade stored').toEqual(detectionFade);
  return values.detectionFade;
}

async function setDisplay(server: OwnServer, choices: Record<string, unknown>): Promise<number> {
  const response = await fetch(`${server.baseUrl}/api/display`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(choices) });
  expect(response.status, `PUT /api/display: ${await response.clone().text()}`).toBe(204);
  return Date.now();
}

/** Counts the live-picture subscriptions the page opens. */
function watchSubscriptions(page: Page): { count: number } {
  const seen = { count: 0 };
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      try {
        if (JSON.parse(String(frame.payload)).type === 'subscribe') seen.count++;
      } catch {
        // not JSON
      }
    }),
  );
  return seen;
}

async function applied(client: LiveClient, request: { entityType: string; operation: string }): Promise<{ state: Record<string, any> }> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}: ${JSON.stringify(outcome.rejection ?? '')}`).toMatchObject({ outcome: 'applied' });
  return outcome.event;
}

/** A plain frame of an identity at a pixel of the map, with modifiers and a name if given; resolves with its id. */
async function symbolAt(page: Page, live: LiveClient, layerId: string, at: Point, identity: 'friend' | 'hostile', extra: { modifiers?: Record<string, unknown>; name?: string } = {}): Promise<string> {
  const request = frameSymbol(layerId, await positionAt(page, at), identity) as any;
  if (extra.modifiers !== undefined) request.data.symbol.modifiers = extra.modifiers;
  if (extra.name !== undefined) request.data.properties = { name: extra.name };
  await applied(live, request);
  await expect.poll(() => colourAround(page, at, identity === 'friend' ? FRIEND : HOSTILE), { timeout: 10_000, message: 'the symbol is drawn' }).toBeGreaterThan(50);
  return request.entityId;
}

/** Metres per pixel at a point, east-west. */
async function metresPerPixel(page: Page, at: Point): Promise<number> {
  const a = await positionAt(page, at);
  const b = await positionAt(page, { x: at.x + 100, y: at.y });
  return inverse([[a, b]])[0].metres / 100;
}

/** symbology's sensor report colours (plugins/symbology/web/src/sensorReport.ts): orange, the default, and cyan. */
const ORANGE = [255, 128, 0] as const;
const CYAN = [0, 255, 255] as const;

const isBlack = ([r, g, b]: number[]) => r < 70 && g < 70 && b < 70;
const isYellow = ([r, g, b]: number[]) => r > 200 && g > 200 && b < 90;

/** For each column east of a symbol (0 = its anchor, up to `width`), how many of the `rows` above and below its row are black. */
async function blackColumns(page: Page, at: Point, width: number, rows = 6): Promise<number[]> {
  const image = decodePng(await page.screenshot({ clip: { x: at.x, y: at.y - rows, width, height: 2 * rows + 1 } }));
  const out: number[] = [];
  for (let x = 0; x < image.width; x++) {
    let n = 0;
    for (let y = 0; y < image.height; y++) if (isBlack(image.pixel(x, y))) n++;
    out.push(n);
  }
  return out;
}

/** The farthest column (from the anchor) with a black pixel, past `from`; -1 if none. */
function reach(columns: number[], from: number): number {
  let last = -1;
  for (let x = from; x < columns.length; x++) if (columns[x] > 0) last = x;
  return last;
}

/**
 * The map view's own arrow: a 2 px line from the anchor with a head about 10 px wide at its tip, 1.5 × the
 * size from the anchor (atlas.ts); a vector is a 2 px line. Looked for past the frame (a size-30 frame
 * reaches about 23 px east of its anchor, and its border is black too).
 */
function hasArrowHead(columns: number[], size: number): boolean {
  return Math.max(...columns.slice(28, Math.round(size * 1.5) + 6)) >= 5;
}

function properties(page: Page) {
  return page.getByRole('region', { name: 'Symbol properties', exact: true }).last();
}

test('size and name at once (criteria 77, 78 and 82): the symbol size and the name under a symbol follow the user\'s display settings within a second, without a reload and without a new subscription; unticking Direction keeps the map view\'s arrow', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    let subscriptions = { count: 0 };
    const page = await open((p) => {
      subscriptions = watchSubscriptions(p);
    });
    const centre = await mapCentre(page);
    const at = { x: centre.x - 80, y: centre.y - 40 };
    const arrowAt = { x: centre.x + 120, y: centre.y + 60 };
    await symbolAt(page, live, layer, at, 'friend', { name: 'ALPHA ONE' });
    await symbolAt(page, live, layer, arrowAt, 'hostile', { modifiers: { direction: 90 } });
    const opened = subscriptions.count;
    const loads = { count: 0 };
    page.on('load', () => loads.count++);

    // Size (77): the default 30, then 60 and 20; the frame's fill grows and shrinks with the square of the size.
    const area = () => colourAround(page, at, FRIEND, 60);
    const at30 = await area();
    let since = await setDisplay(server, { symbolSize: 60 });
    await expect.poll(area, { timeout: AT_ONCE_MS, message: 'size 60 within a second' }).toBeGreaterThan(at30 * 3);
    testInfo.annotations.push({ type: 'size 60 after', description: `${Date.now() - since} ms (fill ${at30} at 30)` });
    since = await setDisplay(server, { symbolSize: 20 });
    await expect.poll(area, { timeout: AT_ONCE_MS, message: 'size 20 within a second' }).toBeLessThan(at30 * 0.6);
    await setDisplay(server, {});
    await expect.poll(area, { timeout: AT_ONCE_MS, message: '"Use defaults": 30 again' }).toBeGreaterThan(at30 * 0.85);

    // The name (78): drawn under the symbol with the defaults (name among the labels), gone without it.
    const below: Point = { x: at.x, y: at.y + 34 };
    const nameArea = async () => {
      const image = await pixelsAround(page, below, 30);
      let dark = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (isBlack(image.pixel(x, y))) dark++;
      return dark;
    };
    await expect.poll(nameArea, { timeout: 10_000, message: 'the name under the symbol' }).toBeGreaterThan(40);
    const withName = await nameArea();
    await setDisplay(server, { labels: ['uniqueDesignation', 'direction'] });
    await expect.poll(nameArea, { timeout: AT_ONCE_MS, message: 'without name among the labels: no name' }).toBeLessThan(withName / 4);
    await setDisplay(server, { labels: ['name', 'uniqueDesignation'] });
    await expect.poll(nameArea, { timeout: AT_ONCE_MS, message: 'the name back' }).toBeGreaterThan(withName * 0.75);

    // Direction unticked (LC): the hostile keeps the map view's own arrow.
    const half = 80;
    const arrow = async () => hasArrowHead(await blackColumns(page, arrowAt, half), 30);
    expect(await arrow(), 'the arrow with Direction unticked').toBe(true);
    await setDisplay(server, {});
    // Polled: the map redraws for the new choices (once failed read at once under load, 2026-11-11).
    await expect.poll(arrow, { timeout: AT_ONCE_MS, message: 'and with the defaults' }).toBe(true);

    expect(subscriptions.count, 'no new live-picture subscription').toBe(opened);
    expect(loads.count, 'no reload').toBe(0);
  });
});

test('the speed vector (criteria 79, 80 and 82): with 10 minutes, a friend, a hostile and a vessel at 10 m/s heading 90 get a black line about 6 000 m east instead of their arrow; speed 0 keeps the arrow and gets none; a click on the vector selects nothing; 0 minutes brings the arrows back', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    let subscriptions = { count: 0 };
    const page = await open((p) => {
      subscriptions = watchSubscriptions(p);
    });
    const centre = await mapCentre(page);
    // At 10 minutes the vector is 6 000 m: first choose the zoom so that it is 120 to 250 px long.
    let mpp = await metresPerPixel(page, centre);
    for (let i = 0; i < 10 && (6_000 / mpp < 120 || 6_000 / mpp > 250); i++) {
      await mapPane(page).getByTitle(6_000 / mpp < 120 ? 'Zoom in' : 'Zoom out').click();
      await userPause(page);
      mpp = await metresPerPixel(page, centre);
    }
    const rows = [-120, -40, 40, 120].map((dy) => ({ x: centre.x - 200, y: centre.y + dy }));
    const moving = { direction: 90, speed: 10 };
    await symbolAt(page, live, layer, rows[0], 'friend', { modifiers: moving });
    await symbolAt(page, live, layer, rows[1], 'hostile', { modifiers: moving });
    const vessel = frameSymbol(layer, await positionAt(page, rows[2]), 'friend') as any;
    vessel.data.symbol = { standard: 'vessel', sidc: '0471', modifiers: moving };
    await applied(live, vessel);
    await symbolAt(page, live, layer, rows[3], 'friend', { modifiers: { direction: 90, speed: 0 } });
    const position = await positionAt(page, rows[0]);
    expect(Math.abs(position[0] - position[1]), 'latitude ≠ longitude').toBeGreaterThan(1);
    const opened = subscriptions.count;

    mpp = await metresPerPixel(page, rows[0]);
    const length = 6_000 / mpp;
    testInfo.annotations.push({ type: 'vector in pixels', description: `${length.toFixed(1)} px at ${mpp.toFixed(2)} m/px` });
    const half = Math.ceil(length) + 40;
    const columnsAt = (row: Point) => blackColumns(page, row, half);

    // 0 minutes (the default): every symbol has its arrow, no line reaches beyond it.
    for (const [i, row] of rows.entries()) {
      if (i === 2) continue; // the vessel's hull turns with its direction; it has no arrow of the map view (function 33)
      const columns = await columnsAt(row);
      expect(hasArrowHead(columns, 30), `symbol ${i}: its arrow, ${JSON.stringify(columns.slice(0, 60))}`).toBe(true);
      expect(reach(columns, 30), `symbol ${i}: nothing past the arrow`).toBeLessThan(55);
    }

    // 10 minutes: black lines to about 6 000 m east for the moving three, no arrow heads; speed 0: the arrow, no line.
    const since = await setDisplay(server, { speedVectorMinutes: 10 });
    await expect.poll(async () => reach(await columnsAt(rows[0]), 30), { timeout: AT_ONCE_MS, message: 'the vector within a second' }).toBeGreaterThan(length - 8);
    testInfo.annotations.push({ type: 'vector after', description: `${Date.now() - since} ms` });
    for (const [i, row] of rows.slice(0, 3).entries()) {
      const columns = await columnsAt(row);
      const end = reach(columns, 30);
      expect(Math.abs(end - length), `symbol ${i}: ends ${end} px east, ${length.toFixed(1)} px expected`).toBeLessThan(6);
      expect(columns.slice(60, Math.floor(length) - 6).every((n) => n >= 1 && n <= 4), `symbol ${i}: a thin black line all along, ${JSON.stringify(columns.slice(60, Math.floor(length) - 6))}`).toBe(true);
      if (i < 2) expect(hasArrowHead(columns, 30), `symbol ${i}: no arrow where a vector is`).toBe(false);
    }
    const still = await columnsAt(rows[3]);
    expect(hasArrowHead(still, 30), 'speed 0: its arrow').toBe(true);
    expect(reach(still, 30), 'speed 0: no vector').toBeLessThan(55);
    await page.screenshot({ path: testInfo.outputPath('vectors.png') });

    // Not picked (80): a click on the middle of the friend's vector selects nothing.
    await page.mouse.click(rows[0].x + Math.round(length * 0.7), rows[0].y);
    await userPause(page);
    await expect(properties(page)).toContainText('Select a symbol on the map.');

    // Back to 0: the arrows again, no lines.
    await setDisplay(server, { speedVectorMinutes: 0 });
    await expect.poll(async () => reach(await columnsAt(rows[0]), 30), { timeout: AT_ONCE_MS, message: 'the vector goes within a second' }).toBeLessThan(55);
    expect(hasArrowHead(await columnsAt(rows[0]), 30), 'the friend\'s arrow back').toBe(true);
    expect(hasArrowHead(await columnsAt(rows[1]), 30), 'the hostile\'s arrow back').toBe(true);
    expect(subscriptions.count, 'no new live-picture subscription').toBe(opened);
  });
});

test('pairing lines (function 34, criterion 82; from M7 on by default, T-186): gmti\'s pairing between two objects is drawn by default, goes within a second when the user switches it off, is drawn yellow within a second when switched on again, follows the platform when it moves, and goes when switched off, without a new subscription', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    let subscriptions = { count: 0 };
    const page = await open((p) => {
      subscriptions = watchSubscriptions(p);
    });
    const centre = await mapCentre(page);
    const detectionAt = { x: centre.x - 150, y: centre.y + 80 };
    const platformAt = { x: centre.x + 100, y: centre.y - 90 };
    const platformRequest = frameSymbol(layer, await positionAt(page, platformAt), 'friend') as any;
    const created = await applied(live, platformRequest);
    const platform: string = platformRequest.entityId;
    await expect.poll(() => colourAround(page, platformAt, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
    const detection = frameSymbol(layer, await positionAt(page, detectionAt), 'hostile') as any;
    detection.data.relations = [{ kind: 'gmti.pairing', objectId: platform }];
    await applied(live, detection);
    await expect.poll(() => colourAround(page, detectionAt, HOSTILE), { timeout: 10_000 }).toBeGreaterThan(50);
    const opened = subscriptions.count;

    // The yellow pixels on the middle third of the segment between the two.
    const yellow = async (from: Point, to: Point) => {
      const mid = { x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2) };
      const half = Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 6);
      const image = await pixelsAround(page, mid, half);
      let n = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (isYellow(image.pixel(x, y))) n++;
      return n;
    };
    // From M7 gmti.pairing is on by default (T-186; gmti's defaultOn true).
    await expect.poll(() => yellow(detectionAt, platformAt), { timeout: 10_000, message: 'on by default (defaultOn true)' }).toBeGreaterThan(10);
    await setDisplay(server, { relations: { 'gmti.pairing': false } });
    await expect.poll(() => yellow(detectionAt, platformAt), { timeout: AT_ONCE_MS, message: 'switched off within a second' }).toBe(0);
    const since = await setDisplay(server, { relations: { 'gmti.pairing': true } });
    await expect.poll(() => yellow(detectionAt, platformAt), { timeout: AT_ONCE_MS, message: 'the line within a second' }).toBeGreaterThan(10);
    testInfo.annotations.push({ type: 'line after', description: `${Date.now() - since} ms` });

    // The platform moved: the line follows.
    const movedAt = { x: centre.x + 100, y: centre.y + 160 };
    const moved = { ...platformRequest, requestId: crypto.randomUUID(), operation: 'update', baseVersion: created.state.version, data: { ...platformRequest.data, geometry: { type: 'Point', coordinates: await positionAt(page, movedAt) } } };
    await applied(live, moved);
    await expect.poll(() => yellow(detectionAt, movedAt), { timeout: 10_000, message: 'the line follows the platform' }).toBeGreaterThan(10);
    expect(await yellow(detectionAt, platformAt), 'not where the platform was').toBe(0);

    await setDisplay(server, { relations: { 'gmti.pairing': false } });
    await expect.poll(() => yellow(detectionAt, movedAt), { timeout: AT_ONCE_MS, message: 'switched off within a second' }).toBe(0);
    expect(subscriptions.count, 'no new live-picture subscription').toBe(opened);
  });
});


test('the speed vector in steps (criteria 94 and 95, SDK 1.5.0 part 3, T-164): the Display settings window\'s slider goes Off and ten steps from 5 s to 30 min, each kept on release; at 10 min a track at 10 m/s heading 90 gets 6 000 m, at 2 min 1 200 m, within a second and without a new subscription; a value between the steps is refused', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    let subscriptions = { count: 0 };
    const page = await open((p) => {
      subscriptions = watchSubscriptions(p);
    });
    const centre = await mapCentre(page);
    // At 10 minutes the vector is 6 000 m: the zoom that makes it 200 to 400 px, so that 2 minutes are 40 to 80 px.
    let mpp = await metresPerPixel(page, centre);
    for (let i = 0; i < 10 && (6_000 / mpp < 200 || 6_000 / mpp > 400); i++) {
      await mapPane(page).getByTitle(6_000 / mpp < 200 ? 'Zoom in' : 'Zoom out').click();
      await userPause(page);
      mpp = await metresPerPixel(page, centre);
    }
    const row = { x: centre.x - 320, y: centre.y + 40 };
    await symbolAt(page, live, layer, row, 'friend', { modifiers: { direction: 90, speed: 10 } });
    mpp = await metresPerPixel(page, row);
    const tenMinutes = 6_000 / mpp;
    testInfo.annotations.push({ type: '10 min in pixels', description: `${tenMinutes.toFixed(1)} px at ${mpp.toFixed(2)} m/px` });
    const end = async () => reach(await blackColumns(page, row, Math.ceil(tenMinutes) + 40), 30);
    const stored = async () => (await (await fetch(`${server.baseUrl}/api/display`)).json()).choices?.speedVectorSeconds ?? 0;
    const opened = subscriptions.count;

    // The window's slider, step by step with the keyboard (each key let go is a release).
    await mapPane(page).getByRole('button', { name: 'Display settings', exact: true }).click();
    const window = page.getByRole('dialog', { name: 'Display settings', exact: true });
    const slider = window.getByRole('slider', { name: 'Speed vector', exact: true });
    await expect(slider).toHaveAttribute('aria-valuetext', 'Off');
    const steps = ['Off'];
    for (let i = 0; i < 10; i++) {
      // Each step waits for the label to change: read at once it was once stale under load (2026-11-11).
      await slider.press('ArrowRight');
      await expect(slider).not.toHaveAttribute('aria-valuetext', steps.at(-1)!);
      steps.push((await slider.getAttribute('aria-valuetext')) ?? '');
    }
    expect(steps, 'Off and the ten steps').toEqual(['Off', '5 s', '10 s', '15 s', '30 s', '1 min', '2 min', '5 min', '10 min', '20 min', '30 min']);
    await expect.poll(stored, { message: '30 min kept on release' }).toBe(1_800);
    await slider.press('ArrowLeft');
    await slider.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuetext', '10 min');
    await expect.poll(stored, { message: '10 min kept' }).toBe(600);
    await expect.poll(end, { timeout: AT_ONCE_MS, message: 'the vector at 10 min' }).toBeGreaterThan(tenMinutes - 8);
    expect(Math.abs((await end()) - tenMinutes), `10 min: 6 000 m, ${tenMinutes.toFixed(1)} px`).toBeLessThan(6);
    await window.getByRole('button', { name: 'Close display settings', exact: true }).click();

    // Criterion 95: a step set elsewhere (PUT /api/display) changes the vector within a second.
    await setDisplay(server, { speedVectorSeconds: 120 });
    await expect.poll(async () => Math.abs((await end()) - tenMinutes / 5), { timeout: AT_ONCE_MS, message: '2 min: 1 200 m within a second' }).toBeLessThan(6);
    expect(subscriptions.count, 'no new live-picture subscription').toBe(opened);

    const between = await fetch(`${server.baseUrl}/api/display`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ speedVectorSeconds: 45 }) });
    expect(between.status, '45 s is not a step').toBe(400);
    expect(await stored(), 'unchanged').toBe(120);
  });
});

test('sensor reports (map-view-2d criteria 98 and 100, symbology criterion 33, gmti criterion 28; SDK 1.5.0 part 3): a gmti.detection is an orange outlined dot, not its APP-6 symbol, and the gmti.platform keeps its symbol; a click selects the dot; a cyan 20 px square set in symbology\'s settings shows within 2 s, in a light and a dark look', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    const page = await open();
    const centre = await mapCentre(page);
    const detectionAt = { x: centre.x - 200, y: centre.y + 40 };
    const platformAt = { x: centre.x - 60, y: centre.y + 40 };
    const detection = frameSymbol(layer, await positionAt(page, detectionAt), 'hostile') as any;
    detection.data.dataType = 'gmti.detection';
    await applied(live, detection);
    const platform = frameSymbol(layer, await positionAt(page, platformAt), 'friend') as any;
    platform.data.dataType = 'gmti.platform';
    await applied(live, platform);

    // symbology's defaults: an orange 10 px dot with a black outline (about 52 orange pixels).
    await expect.poll(() => colourAround(page, detectionAt, ORANGE, 12), { timeout: 10_000, message: 'the detection as an orange dot' }).toBeGreaterThan(30);
    expect(await colourAround(page, detectionAt, HOSTILE), 'not its hostile APP-6 frame').toBe(0);
    await expect.poll(() => colourAround(page, platformAt, FRIEND), { timeout: 10_000, message: 'the platform keeps its APP-6 symbol' }).toBeGreaterThan(50);

    // Criterion 98: a click on the dot selects it, highlighted round its image.
    await page.mouse.click(detectionAt.x, detectionAt.y);
    await userPause(page);
    await expect(properties(page).getByRole('combobox', { name: 'Data type', exact: true }).locator('option:checked'), 'selected: "Symbol properties" shows it').toHaveText('GMTI detection');
    await expect.poll(() => colourAround(page, detectionAt, HIGHLIGHT, 16), { message: 'highlighted' }).toBeGreaterThan(10);
    await page.keyboard.press('Escape');

    // Symbology criterion 33: a new look in its settings (admin) reaches the map within 2 s (the map asks once a second).
    const url = `${server.baseUrl}/api/settings/plugins/symbology`;
    const values = (await (await fetch(url)).json()).values;
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, sensorReportShape: 'square', sensorReportColor: 'cyan', sensorReportSize: 20 }) });
    expect(response.status, `symbology settings: ${await response.clone().text()}`).toBe(200);
    const since = Date.now();
    // A 20 px square with a 1 px outline: 324 cyan pixels.
    await expect.poll(() => colourAround(page, detectionAt, CYAN, 16), { timeout: 2_000 + AT_ONCE_MS, message: 'the cyan square within 2 s' }).toBeGreaterThan(250);
    testInfo.annotations.push({ type: 'new look after', description: `${Date.now() - since} ms` });
    expect(await colourAround(page, detectionAt, ORANGE, 16), 'no orange dot left').toBe(0);
    expect(await colourAround(page, platformAt, FRIEND), 'the platform unchanged').toBeGreaterThan(50);

    // A dark look (a dark computer, no look chosen): the same square.
    const dark = await open(undefined, { context: { colorScheme: 'dark' } });
    await expect.poll(() => colourAround(dark, detectionAt, CYAN, 16), { timeout: 10_000, message: 'the cyan square in a dark look' }).toBeGreaterThan(250);
  });
});

/** How many pixels of a square round a point differ from `before` (the same square earlier) by more than 40 in some channel. */
async function changedFrom(page: Page, at: Point, half: number, before: Awaited<ReturnType<typeof pixelsAround>>): Promise<number> {
  const now = await pixelsAround(page, at, half);
  let n = 0;
  for (let y = 0; y < now.height; y++) {
    for (let x = 0; x < now.width; x++) {
      const a = now.pixel(x, y);
      const b = before.pixel(x, y);
      if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) > 40) n++;
    }
  }
  return n;
}

test('a sensor report keeps its pairing line and fades by its data type (criterion 98): with gmti.detection expiring 4 s after its observation, the orange dot and its yellow line to the platform are drawn, and after the expiry the dot is faded, not gone, and the line stays', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const behaviour = await fetch(`${server.baseUrl}/api/settings/data-types/gmti.detection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fadeWhenExpired: true, expiresAfterSeconds: 4, removeAfterExpirySeconds: 120 }),
    });
    expect(behaviour.status, `gmti.detection's behaviour: ${await behaviour.clone().text()}`).toBe(200);
    // The expiry fade is tested here: gmti's stepped detection fade off, restored at the end.
    const detectionFade = await setDetectionFade(server);
    await setDisplay(server, { relations: { 'gmti.pairing': true } });
    const layer = seededLayer(snapshot);
    const page = await open();
    const centre = await mapCentre(page);
    const detectionAt = { x: centre.x - 200, y: centre.y + 60 };
    const platformAt = { x: centre.x + 40, y: centre.y - 60 };
    const middle = { x: Math.round((detectionAt.x + platformAt.x) / 2), y: Math.round((detectionAt.y + platformAt.y) / 2) };
    const platform = frameSymbol(layer, await positionAt(page, platformAt), 'friend') as any;
    platform.data.dataType = 'gmti.platform';
    await applied(live, platform);
    await expect.poll(() => colourAround(page, platformAt, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
    // The ground before the detection: the dot's square and the middle of the line.
    await page.mouse.move(centre.x + 300, centre.y + 200);
    const dotGround = await pixelsAround(page, detectionAt, 12);
    const lineGround = await pixelsAround(page, middle, 20);

    const detection = frameSymbol(layer, await positionAt(page, detectionAt), 'hostile') as any;
    Object.assign(detection.data, { dataType: 'gmti.detection', time: { observed: new Date().toISOString() }, relations: [{ kind: 'gmti.pairing', objectId: platform.entityId }] });
    await applied(live, detection);
    await page.mouse.move(centre.x + 300, centre.y + 200);
    await expect.poll(() => colourAround(page, detectionAt, ORANGE, 12), { timeout: 10_000, message: 'the orange dot' }).toBeGreaterThan(30);
    const yellowLine = async () => {
      const image = await pixelsAround(page, middle, 20);
      let n = 0;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (isYellow(image.pixel(x, y))) n++;
      return n;
    };
    await expect.poll(yellowLine, { timeout: AT_ONCE_MS, message: 'its pairing line, yellow' }).toBeGreaterThan(10);
    const lineDrawn = await changedFrom(page, middle, 20, lineGround);

    // Expired: faded (no full orange left), still drawn, still stored, and its line still there.
    await expect.poll(() => colourAround(page, detectionAt, ORANGE, 12), { timeout: 15_000, message: 'no longer in full colour after its expiry' }).toBe(0);
    expect(await changedFrom(page, detectionAt, 12, dotGround), 'faded, not gone').toBeGreaterThan(20);
    expect((await live.getObjects([detection.entityId])).found, 'not removed yet').toHaveLength(1);
    expect(await changedFrom(page, middle, 20, lineGround), 'the pairing line stays').toBeGreaterThan(lineDrawn / 3);
    testInfo.annotations.push({ type: 'line pixels', description: `${lineDrawn} drawn, ${await changedFrom(page, middle, 20, lineGround)} after the fade` });
    await setDetectionFade(server, detectionFade);
  });
});

test('a moving track shows the 5 s and the 30 min vectors (criterion 100): a track at 100 m/s heading 90, moved twice, gets a 500 m line at 5 s and a 180 km line at 30 min (its end a few pixels north: a geodesic) from where it is now, and none where it was', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    const page = await open();
    const centre = await mapCentre(page);
    const SPEED = 100;
    const zoomTo = async (metres: number) => {
      let mpp = await metresPerPixel(page, centre);
      for (let i = 0; i < 20 && (metres / mpp < 150 || metres / mpp > 400); i++) {
        await mapPane(page).getByTitle(metres / mpp < 150 ? 'Zoom in' : 'Zoom out').click();
        await userPause(page);
        mpp = await metresPerPixel(page, centre);
      }
    };
    let state: Record<string, any> | undefined;
    /** The track at a pixel: created the first time, then moved there (an update, as a feed moves it). */
    const trackAt = async (at: Point) => {
      const coordinates = await positionAt(page, at);
      if (state === undefined) {
        const request = frameSymbol(layer, coordinates, 'friend') as any;
        request.data.symbol.modifiers = { direction: 90, speed: SPEED };
        state = (await applied(live, request)).state;
      } else {
        const { id, version, meta: _meta, ...data } = state;
        state = (await applied(live, { requestId: randomUUID(), entityType: 'object', operation: 'update', entityId: id, baseVersion: version, data: { ...data, geometry: { type: 'Point', coordinates } }, source: { plugin: 'ita-test' } } as any)).state;
      }
      await page.mouse.move(centre.x, centre.y + 250);
      await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000, message: 'the track drawn where it is' }).toBeGreaterThan(50);
    };
    const vectorFrom = async (at: Point, expected: number) => {
      const end = async () => reach(await blackColumns(page, at, Math.ceil(expected) + 40, 12), 30);
      await expect.poll(async () => Math.abs((await end()) - expected), { timeout: AT_ONCE_MS + 2_000, message: `${expected.toFixed(1)} px from the track` }).toBeLessThan(6);
    };

    for (const { seconds, label } of [{ seconds: 5, label: '5 s' }, { seconds: 1_800, label: '30 min' }]) {
      const metres = SPEED * seconds;
      await setDisplay(server, { speedVectorSeconds: seconds });
      await zoomTo(metres);
      const first = { x: centre.x - 360, y: centre.y + 40 };
      const second = { x: centre.x - 300, y: centre.y - 60 };
      await trackAt(first);
      const length = metres / (await metresPerPixel(page, first));
      testInfo.annotations.push({ type: `${label} in pixels`, description: length.toFixed(1) });
      await vectorFrom(first, length);
      await trackAt(second);
      await expect.poll(() => colourAround(page, first, FRIEND), { message: `${label}: moved away` }).toBe(0);
      await vectorFrom(second, metres / (await metresPerPixel(page, second)));
      expect(reach(await blackColumns(page, first, Math.ceil(length) + 40, 12), 30), `${label}: no vector left where it was`).toBe(-1);
    }
  });
});
