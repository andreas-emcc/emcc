import { expect, type Browser, type BrowserContextOptions, type Locator, type Page, type TestInfo } from '@playwright/test';
import { startFakeTiles } from './fake-tiles.mjs';
import { installOfflineGuard } from '../fixtures';
import { createSymbol, LiveClient } from './live.mjs';
import { stopOwnServer, withOwnServers, type OwnServer } from './own-server';
import { countColour, decodePng } from './png.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembled, installFixture, installPlugins } from './plugins.mjs';
import { installTestPlugin } from './test-plugins.mjs';
import { expandWhenCollapsed, settled } from './collapsed';

export { expandWhenCollapsed, keepCollapsed } from './collapsed';

// Helpers for the M0 flows in the browser, with the real plugins (build/plugins/).

/** Colours on the map: milsymbol's light fills and map-view-2d's highlight (styles.ts). */
export const FRIEND = [128, 224, 255] as const;
export const HOSTILE = [255, 128, 128] as const;
export const HIGHLIGHT = [255, 212, 0] as const;

export type Point = { x: number; y: number };
export type LonLat = [number, number];

export type M0Options = {
  /** Install the ITA's test probe plugin (window.__itaProbe in the page). */
  probe?: boolean;
  /**
   * basemap-osm's upstream: the fake tile server (default), or the fake tile server resetting
   * every connection (as without internet).
   */
  upstream?: 'fake' | 'unreachable';
  /** Console errors this test expects (each must match); all others still fail the test. */
  allowConsoleErrors?: RegExp;
  /** The ITA's test plugins with a server part to install as well (fixtures/plugins, lib/test-plugins.mjs). */
  testPlugins?: string[];
  /** Further server arguments, e.g. `--emc2.conversions.ffmpeg=<path>` (T-211); also on `restart`. */
  serverArgs?: string[];
};

export type M0 = {
  server: OwnServer;
  /** The fake tile server basemap-osm fetches from. */
  tiles: Awaited<ReturnType<typeof startFakeTiles>>;
  /** A Node client subscribed to the live picture: the truth the browser is checked against. */
  live: LiveClient;
  /** The live picture when the test started (layers with their drawOrder, objects). */
  snapshot: Awaited<ReturnType<LiveClient['subscribe']>>;
  /**
   * Opens the app in a new browser context, guarded like the shared fixture (offline, no console
   * errors). `beforeLoad` runs on the page before the app loads (e.g. to listen to its WebSocket);
   * `options` go to openApp.
   */
  open: (beforeLoad?: (page: Page) => void | Promise<void>, options?: OpenAppOptions) => Promise<Page>;
  /**
   * Stops the server cleanly and starts it again on the same data and plugin folders. Its address
   * may change: pages opened before keep the old one, `open` uses the new one. Resolves with the new
   * server and a new live client (the ones passed to the body are closed).
   */
  restart: () => Promise<{ server: OwnServer; live: LiveClient }>;
};

/**
 * Runs `body` against a server of the test's own with every assembled plugin installed and
 * basemap-osm fetching from a local fake tile server. Every page opened through `open` fails the
 * test if it requests anything but this server or logs a console error; these checks run also when
 * the body fails (the body's error is the one reported). When a page was opened, the server must
 * have asked the fake tile server for tiles (served, or refused when it is unreachable): that
 * proves basemap-osm used the run's manifest copy and not OpenStreetMap.
 */
export async function withM0(
  testInfo: TestInfo,
  browser: Browser,
  body: (m0: M0) => Promise<void>,
  options: M0Options = {},
): Promise<void> {
  const tiles = await startFakeTiles();
  if (options.upstream === 'unreachable') tiles.refuseConnections();
  try {
    await withOwnServers(testInfo, async (folders, start) => {
      installPlugins(folders.pluginsDir, { tileTemplate: tiles.template });
      // The run's copy of basemap-osm points at the fake tile server, never at OpenStreetMap; its
      // internet declaration is the plugin's own, unchanged (a declaration, ADR-0030).
      const manifest = JSON.parse(readFileSync(join(folders.pluginsDir, 'basemap-osm', 'plugin.json'), 'utf8'));
      expect(manifest.settings.properties.upstreamUrl.default, 'basemap-osm upstream').toBe(tiles.template);
      const own = JSON.parse(readFileSync(join(assembled, 'basemap-osm', 'plugin.json'), 'utf8'));
      expect(manifest.internet, 'basemap-osm internet declaration').toEqual(own.internet);
      if (options.probe) installFixture(folders.pluginsDir, 'ita-probe');
      for (const id of options.testPlugins ?? []) installTestPlugin(folders.pluginsDir, id);
      let server = await start(options.serverArgs);
      let live = await LiveClient.open(server.baseUrl);
      const snapshot = await live.subscribe();
      const restart = async () => {
        await live.close();
        await stopOwnServer(server);
        server = await start(options.serverArgs);
        live = await LiveClient.open(server.baseUrl);
        await live.subscribe();
        return { server, live };
      };
      const finishers: Array<() => Promise<void>> = [];
      const open = async (beforeLoad?: (page: Page) => void | Promise<void>, openOptions?: OpenAppOptions) => {
        const context = await browser.newContext({ ...openOptions?.context, baseURL: server.baseUrl, serviceWorkers: 'block' });
        const blocked = await installOfflineGuard(context, server.baseUrl);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          if (options.allowConsoleErrors?.test(message.text())) return;
          errors.push(`console.error: ${message.text()}`);
        });
        page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
        finishers.push(async () => {
          await context.close();
          expect(blocked, 'requests to anything but the emc2 server (ADR-0014)').toEqual([]);
          expect(errors, 'browser console errors').toEqual([]);
        });
        await beforeLoad?.(page);
        await openApp(page, openOptions);
        return page;
      };
      let failure: unknown;
      try {
        await body({ server, tiles, live, snapshot, open, restart });
      } catch (error) {
        failure = error;
      } finally {
        await live.close();
      }
      for (const finish of finishers) {
        try {
          await finish();
        } catch (error) {
          if (failure === undefined) failure = error;
          else testInfo.annotations.push({ type: 'also failed', description: String(error) });
        }
      }
      if (failure !== undefined) throw failure;
      if (finishers.length > 0) {
        expect(tiles.requests.length + tiles.refused.count, 'tile requests from the server to the fake tile server').toBeGreaterThan(0);
      }
      await stopOwnServer(server);
    });
  } finally {
    await tiles.close();
  }
}

export type OpenAppOptions = {
  /**
   * Pick DD in the coordinates panel (default), as a user does; the cursor display then stays DD.
   * Without a pick, the panel follows the plugin's setting defaultFormat.
   */
  pickFormat?: boolean;
  /** Settings of the new browser context, e.g. `timezoneId` (withM0's `open` only). */
  context?: BrowserContextOptions;
};

/**
 * How long `openApp` waits for each step of the app's start, instead of expect's 5 s: a server
 * under load starts the app more slowly (q19: criterion 22's 200 000 objects, the Symbols panel
 * later than 5 s while the collapse handler was expanding panels). Within the test's own timeout.
 */
const STARTING = 30_000;

/** Loads the app and waits until the plugins' panels are there; DD as the coordinate format unless told otherwise. */
export async function openApp(page: Page, { pickFormat = true }: OpenAppOptions = {}): Promise<void> {
  await expandWhenCollapsed(page);
  await page.goto('/');
  // In the Status panel, collapsed until expanded (T-153).
  await expect(page.getByRole('status', { name: 'Live picture', includeHidden: true })).toHaveText('Live picture: connected', { timeout: STARTING });
  for (const panel of ['Symbols', 'Symbol properties']) {
    await expect(page.getByRole('region', { name: panel })).toBeVisible({ timeout: STARTING });
  }
  await expect(mapPane(page).getByRole('button', { name: 'Coordinates', exact: true })).toBeVisible({ timeout: STARTING });
  // The collapse handler (lib/collapsed) has expanded what showed collapsed, before the spec goes on.
  await settled(page, STARTING);
  // The bottom pane shows one panel at a time (M4, T-108): Layers, as the specs expect it.
  await bottomPanel(page, 'Layers');
  // Without a GPU, map-view-2d shows a notice over the map (ADR-0017); it is dismissed so that it
  // covers nothing. Wait until the map view has reported how it draws, so the notice is either
  // there or never comes.
  const mapView = page.getByRole('complementary', { name: 'Control Pane' }).getByRole('listitem', { includeHidden: true }).filter({ hasText: '2D map view' });
  await expect(mapView).toContainText(/web (OK|DEGRADED)/, { timeout: STARTING });
  if (/drawn without a GPU/.test((await mapView.textContent()) ?? '')) {
    await mapPane(page).getByRole('button', { name: 'Dismiss' }).click();
  }
  if (pickFormat) {
    await (await coordinates(page)).getByRole('combobox').selectOption('dd');
    await closeCoordinates(page);
  }
}

/**
 * The coordinates plugin's dialog (M4, T-104: an icon over the map, not a panel), opened if it is
 * closed. It covers the map's top right; close it before pointing there.
 */
export async function coordinates(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Coordinates', exact: true });
  if (!(await dialog.isVisible())) await mapPane(page).getByRole('button', { name: 'Coordinates', exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Closes the coordinates dialog if it is open. */
export async function closeCoordinates(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Coordinates', exact: true });
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close coordinates' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * A panel of the bottom pane (M4, T-108: Layers and Objects), its tab chosen if another one is
 * shown. The pane shows one panel at a time, a tabpanel named by its tab.
 */
export async function bottomPanel(page: Page, title: string): Promise<Locator> {
  const pane = page.getByRole('complementary', { name: 'Bottom pane' });
  const tab = pane.getByRole('tab', { name: title, exact: true });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const panel = pane.getByRole('tabpanel', { name: title, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

export function mapPane(page: Page) {
  return page.getByRole('main', { name: 'Map Pane' });
}

/** The centre of the Map Pane, in page pixels. */
export async function mapCentre(page: Page): Promise<Point> {
  const box = (await mapPane(page).boundingBox())!;
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** Parses the coordinates plugin's DD text, e.g. "60.123456° N 15.654321° E", into [lon, lat]. */
export function parseDd(text: string): LonLat {
  const match = /(-?[\d.]+)° ([NS]) (-?[\d.]+)° ([EW])/.exec(text);
  if (!match) throw new Error(`not a DD position: ${text}`);
  const lat = Number(match[1]) * (match[2] === 'S' ? -1 : 1);
  const lon = Number(match[3]) * (match[4] === 'W' ? -1 : 1);
  return [lon, lat];
}

const lastPointer = new WeakMap<Page, Point>();

/**
 * Moves the pointer to the point and reads the position the cursor display shows there. The
 * pointer first goes one pixel aside (to the side where it is not already), and the display is
 * read only after it has changed twice: to the detour, then to the point. A single mouse move gives
 * one pointer event, so the text then belongs to the point and not to an earlier position.
 */
export async function positionAt(page: Page, point: Point): Promise<LonLat> {
  const display = page.locator('[aria-label="Pointer position"]');
  const before = (await display.textContent()) ?? '';
  const last = lastPointer.get(page);
  const side = last && last.x === point.x + 1 && last.y === point.y ? -1 : 1;
  // After a workspace switch the cursor display is mounted again and shows "–" until a pointer
  // event reaches it (T-104); a move made before then is lost, so the detour is moved again, one
  // pixel up or down each time, until the display shows a position.
  let tries = 0;
  await expect(async () => {
    await page.mouse.move(point.x + side, point.y + (tries++ % 2));
    await expect(display).not.toHaveText(before, { timeout: 1_000 });
    await expect(display).toHaveText(/°/, { timeout: 1_000 });
  }).toPass({ timeout: 5_000 });
  const aside = (await display.textContent()) ?? '';
  await page.mouse.move(point.x, point.y);
  lastPointer.set(page, point);
  await expect(display).not.toHaveText(aside);
  return parseDd((await display.textContent()) ?? '');
}

/** The map's pixels in a square around a point. */
export async function pixelsAround(page: Page, point: Point, half = 24) {
  return decodePng(await page.screenshot({ clip: { x: point.x - half, y: point.y - half, width: 2 * half, height: 2 * half } }));
}

/** How many pixels of a colour the map shows around a point. */
export async function colourAround(page: Page, point: Point, colour: readonly number[], half = 24): Promise<number> {
  return countColour(await pixelsAround(page, point, half), colour);
}

/**
 * Where a colour is drawn around a point: the centre of its pixels, in page pixels, or null if
 * there are none.
 */
export async function colourCentre(page: Page, point: Point, colour: readonly number[], half = 60): Promise<Point | null> {
  const image = await pixelsAround(page, point, half);
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = image.pixel(x, y);
      if (Math.abs(r - colour[0]) <= 24 && Math.abs(g - colour[1]) <= 24 && Math.abs(b - colour[2]) <= 24) {
        count++;
        sx += x;
        sy += y;
      }
    }
  }
  // Pixel index i covers [i, i + 1): its centre is i + 0.5 in page coordinates.
  return count === 0 ? null : { x: point.x - half + sx / count + 0.5, y: point.y - half + sy / count + 0.5 };
}

/**
 * A user's pace between two clicks on the map. Two clicks within OpenLayers' double-click time
 * zoom the map (reported to the owner, 2026-10-09). Part of the gesture, not a wait for a result.
 */
export async function userPause(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

/**
 * Chooses a catalog symbol in "Symbols", places it at each point at a user's pace, and stops
 * placing. It ends with a user's pause, so a next click (e.g. to select) is a click of its own.
 */
export async function placeSymbols(page: Page, symbol: string, points: Point[]): Promise<void> {
  const panel = page.getByRole('region', { name: 'Symbols' });
  await panel.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: symbol, exact: true }).click();
  await panel.getByRole('button', { name: 'Place on map' }).click();
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    await userPause(page);
  }
  await page.keyboard.press('Escape');
}

/**
 * Drags with the mouse in small steps, as a user would. The mouse rests at the end for a moment
 * before it is released, as a user's does: OpenLayers would otherwise continue a pan with kinetic
 * movement after the release, and the map would end somewhere else.
 */
export async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.waitForTimeout(250); // part of the gesture (resting), not a wait for a result
  await page.mouse.up();
}

/**
 * Proves that no other change is on its way: creates a probe object far away from the map's view
 * and waits for its event. Change events arrive in order, so every earlier change has arrived too.
 * Returns the events that arrived before the probe.
 */
export async function settle(live: LiveClient, layerId: string): Promise<Event[]> {
  const probe = createSymbol(layerId, 0, { name: 'probe' });
  probe.data.geometry.coordinates = [-120.5, -45.25];
  const outcome = await live.change(probe);
  expect(outcome.outcome, 'probe applied').toBe('applied');
  await live.waitForSequence(outcome.event.sequenceNo);
  return live.events.filter((e: Event) => e.sequenceNo < outcome.event.sequenceNo);
}

type Event = { sequenceNo: number; entityType: string; operation: string; entityId: string; state?: any };

/** Waits for a change event of the live picture that matches, and returns it. */
export async function nextEvent(live: LiveClient, matches: (e: Event) => boolean, timeoutMs = 10_000): Promise<Event> {
  let found: Event | undefined;
  await expect
    .poll(
      async () => {
        found = live.events.find(matches);
        if (!found) await live.next((m: { type: string }) => m.type === 'changes', 500).catch(() => undefined);
        return found !== undefined;
      },
      { timeout: timeoutMs, intervals: [0] },
    )
    .toBe(true);
  return found!;
}

/** Positions equal within `degrees` (the cursor display shows 6 decimals). */
export function expectNear(actual: number[], expected: LonLat, degrees = 2e-6): void {
  expect(Math.abs(actual[0] - expected[0]), `longitude ${actual[0]} vs ${expected[0]}`).toBeLessThanOrEqual(degrees);
  expect(Math.abs(actual[1] - expected[1]), `latitude ${actual[1]} vs ${expected[1]}`).toBeLessThanOrEqual(degrees);
}

export { stopOwnServer };

/** Standard identities with the fill colour milsymbol gives their frames. */
export const IDENTITY = {
  friend: { code: '3', colour: FRIEND },
  hostile: { code: '6', colour: HOSTILE },
  neutral: { code: '4', colour: [170, 255, 170] as const },
  unknown: { code: '1', colour: [255, 255, 128] as const },
} as const;

/**
 * A create request for a plain frame of the identity (land unit, no icon), so the fill is
 * symmetric and the centre of its colour is the symbol's anchor.
 */
export function frameSymbol(layerId: string, position: LonLat, identity: keyof typeof IDENTITY) {
  const request = createSymbol(layerId, 0);
  request.data.geometry.coordinates = position;
  request.data.symbol = { standard: 'APP-6D', sidc: `100${IDENTITY[identity].code}1000000000000000` };
  return request;
}

/** A layer change request (create, or update with the full content and baseVersion). */
export function layerRequest(operation: 'create' | 'update', layer: { id: string; name: string; drawOrder: number; version?: number }) {
  return {
    requestId: crypto.randomUUID(),
    entityType: 'layer',
    operation,
    entityId: layer.id,
    ...(operation === 'update' ? { baseVersion: layer.version } : {}),
    data: { name: layer.name, drawOrder: layer.drawOrder, visible: true, label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' } },
    source: { plugin: 'ita-test' },
  };
}

/** The visible map: the Map Pane left of the Control Pane, which lies over it. */
export async function visibleMap(page: Page) {
  const map = (await mapPane(page).boundingBox())!;
  const control = (await page.getByRole('complementary', { name: 'Control Pane' }).boundingBox())!;
  return { x: map.x, y: map.y, width: Math.min(map.x + map.width, control.x) - map.x, height: map.height };
}

/**
 * Where a colour is drawn in the visible map, or null: the centre of the largest connected patch of
 * that colour. A symbol is one compact patch; stray pixels of a similar colour elsewhere (the map's
 * controls) are smaller patches and do not count.
 */
export async function colourCentreInMap(page: Page, colour: readonly number[]): Promise<Point | null> {
  const box = await visibleMap(page);
  const image = decodePng(await page.screenshot({ clip: box }));
  const { width, height } = image;
  const match = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = image.pixel(x, y);
      if (Math.abs(r - colour[0]) <= 24 && Math.abs(g - colour[1]) <= 24 && Math.abs(b - colour[2]) <= 24) match[y * width + x] = 1;
    }
  }
  let best = { count: 0, sx: 0, sy: 0 };
  const stack: number[] = [];
  for (let i = 0; i < match.length; i++) {
    if (match[i] !== 1) continue;
    const patch = { count: 0, sx: 0, sy: 0 };
    match[i] = 2;
    stack.push(i);
    while (stack.length > 0) {
      const j = stack.pop()!;
      const x = j % width;
      const y = (j - x) / width;
      patch.count++;
      patch.sx += x;
      patch.sy += y;
      for (const k of [x > 0 ? j - 1 : -1, x < width - 1 ? j + 1 : -1, y > 0 ? j - width : -1, y < height - 1 ? j + width : -1]) {
        if (k >= 0 && match[k] === 1) {
          match[k] = 2;
          stack.push(k);
        }
      }
    }
    if (patch.count > best.count) best = patch;
  }
  // Pixel index i covers [i, i + 1): its centre is i + 0.5 in page coordinates.
  return best.count < 50 ? null : { x: box.x + best.sx / best.count + 0.5, y: box.y + best.sy / best.count + 0.5 };
}

/**
 * Shows the Map Pane's controls (projection, background, dim). From map-view-2d's part F2 they start
 * collapsed into one "Map controls" button in every new browser (open or closed is kept per browser);
 * before it they are always shown. Opens them only when that button is there, and says whether it did.
 */
export async function openMapControls(page: Page): Promise<boolean> {
  const toggle = mapPane(page).getByRole('button', { name: /^Map controls/ });
  const lists = mapPane(page).getByRole('combobox');
  await expect(toggle.or(lists.first()), 'the map controls or their button').toBeVisible();
  const collapsed = (await toggle.count()) > 0;
  if (collapsed) await toggle.click();
  await expect(lists.first()).toBeVisible();
  return collapsed;
}

/**
 * Switches the map to a configured projection with the Map Pane's control. Controls it had to open
 * are collapsed again: open, the box covers part of the map's top right.
 */
export async function switchProjection(page: Page, code: string): Promise<void> {
  const opened = await openMapControls(page);
  await mapPane(page).getByRole('combobox').first().selectOption(code);
  await expect(mapPane(page).getByRole('combobox').first()).toHaveValue(code);
  if (opened) {
    await mapPane(page).getByRole('button', { name: 'Close map controls' }).click();
    await expect(mapPane(page).getByRole('button', { name: /^Map controls/ })).toBeVisible();
  }
}
