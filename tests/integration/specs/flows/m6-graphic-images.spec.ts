// Quick run: @plugin-map-view-2d @plugin-symbology @plugin-draw-tactical
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createLayer, type LiveClient } from '../../lib/live.mjs';
import { mapCentre, positionAt, switchProjection, visibleMap, withM0, type LonLat, type OpenAppOptions, type Point } from '../../lib/m0';
import { decodePng } from '../../lib/png.mjs';
import { viewport } from '../../lib/perf';
import { fitScreen, projections } from '../../lib/projections.mjs';

// Images inside tactical graphics (M6, SDK 1.5.0 part 2, CR-0039; owner HW): map-view-2d function
// 37 and criterion 93, draw-tactical function 14 and criterion 18 (docs/plugins/briefs). An APP-6D
// mined area and an APP-6E chemical contaminated area show their icons on the map, in a light and a
// dark look, in EPSG:3857 and EPSG:3413 and after a zoom.
// - Where an icon goes is the symbology service's own answer (the probe's `renderGraphic`, asked as
//   the map view asks it).
// - What is the icon: a second page shows the same view with every SVG image refused (its source
//   replaced before it loads), so its map view draws the same graphics without their icons
//   (GraphicImageCache: failed). Inside the areas the two pages differ at the icons and nowhere else.
// - The run's guard fails the test on any request beyond the emc2 server (withM0), as the criterion asks.
// Without a GPU here: software mode.

test.describe.configure({ timeout: 180_000 });

type Graphic = { what: string; standard: 'APP-6D' | 'APP-6E'; sidc: string };
const GRAPHICS: Graphic[] = [
  // APP-6D, symbol set 25, entity 270800: Mined Area.
  { what: 'the APP-6D mined area', standard: 'APP-6D', sidc: '10032500002708000000' },
  // APP-6E, symbol set 25, entity 271800: Chemical Contaminated Area (hatched).
  { what: 'the APP-6E chemical contaminated area', standard: 'APP-6E', sidc: '13032500002718000000' },
];
/** Each area's corners as offsets from the Map Pane's centre: left of the Control Pane, clear of the map's controls. */
const SIDE = 150;
const CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: SIDE, y: 0 },
  { x: SIDE, y: SIDE },
  { x: 0, y: SIDE },
];
const ORIGINS: Point[] = [
  { x: -340, y: -60 },
  { x: -160, y: -60 },
];

type Image = { position: LonLat; width: number; height: number };
type Probe = {
  symbols: { renderGraphic(request: unknown): Promise<{ ok: boolean; reason?: string; images?: Image[] }> };
  mapView: { goTo(center: LonLat, resolution?: number): void };
};
type Placed = { graphic: Graphic; ring: LonLat[] };

/** Runs before the app loads: an SVG image's source is replaced by one that cannot decode. */
function refuseSvgImages(page: Page) {
  return page.addInitScript(() => {
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...src,
      set(value: string) {
        src.set!.call(this, String(value).startsWith('data:image/svg+xml') ? 'data:image/svg+xml;base64,AA==' : value);
      },
    });
  });
}

async function goTo(page: Page, center: LonLat, resolution: number) {
  await page.evaluate(([c, r]) => (window as unknown as { __itaProbe: Probe }).__itaProbe.mapView.goTo(c, r), [center, resolution] as const);
  await expect.poll(async () => (await viewport(page)).resolution / resolution, { message: 'the view moved' }).toBeCloseTo(1, 2);
}

/** Lon/lat to page pixels in the current view: fitted to two of the map's pixels and the cursor display's readings. */
async function screenOf(page: Page) {
  const { projection } = await viewport(page);
  const c = await mapCentre(page);
  const s1 = { x: c.x - 300, y: c.y - 120 };
  const s2 = { x: c.x + 40, y: c.y + 160 };
  return fitScreen(projections[projection as keyof typeof projections], [await positionAt(page, s1), s1], [await positionAt(page, s2), s2]);
}

/** The images the symbology service puts in the graphic in the current view (its points: the ring without its closing position). */
async function imagesOf(page: Page, graphic: Graphic, points: LonLat[]): Promise<Image[]> {
  const view = await viewport(page);
  const lons = view.visibleArea.map((p) => p[0]);
  const lats = view.visibleArea.map((p) => p[1]);
  const request = { standard: graphic.standard, sidc: graphic.sidc, points, resolution: view.resolution, extent: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] };
  const rendering = await page.evaluate(async (r) => {
    const result = await (window as unknown as { __itaProbe: Probe }).__itaProbe.symbols.renderGraphic(r);
    return { ok: result.ok, reason: result.reason, images: (result.images ?? []).map((i) => ({ position: [i.position[0], i.position[1]] as LonLat, width: i.width, height: i.height })) };
  }, request);
  expect(rendering.ok, `${graphic.what} draws: ${rendering.reason ?? ''}`).toBe(true);
  return rendering.images;
}

async function shot(page: Page) {
  const box = await visibleMap(page);
  return { box, image: decodePng(await page.screenshot({ clip: box })) };
}
type Shot = Awaited<ReturnType<typeof shot>>;

/** How many pixels of a box round a page point differ clearly between two shots. */
function differing(a: Shot, b: Shot, at: Point, width: number, height: number): number {
  let count = 0;
  for (let y = Math.round(at.y - height / 2); y < Math.round(at.y + height / 2); y++) {
    for (let x = Math.round(at.x - width / 2); x < Math.round(at.x + width / 2); x++) {
      const px = x - Math.round(a.box.x);
      const py = y - Math.round(a.box.y);
      if (px < 0 || py < 0 || px >= a.image.width || py >= a.image.height) continue;
      const [r1, g1, b1] = a.image.pixel(px, py);
      const [r2, g2, b2] = b.image.pixel(px, py);
      if (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > 90) count++;
    }
  }
  return count;
}

/**
 * The icons show: the page and the reference page without images get the same view; at each image
 * the service gives, the page differs from the reference, and inside each area away from the icons
 * (a box a quarter of the way from the topmost corner to the middle) they are the same.
 */
async function iconsShown(page: Page, reference: Page, placed: Placed[], where: string): Promise<void> {
  const view = await viewport(page);
  if ((await viewport(reference)).projection !== view.projection) await switchProjection(reference, view.projection);
  await goTo(reference, view.center as LonLat, view.resolution);
  await goTo(page, view.center as LonLat, view.resolution);
  expect(await visibleMap(reference), 'the two maps are the same size and place').toEqual(await visibleMap(page));
  const fit = await screenOf(page);
  const expected = [];
  for (const p of placed) {
    const images = await imagesOf(page, p.graphic, p.ring);
    expect(images.length, `${where}: ${p.graphic.what} has images`).toBeGreaterThan(0);
    const corners = p.ring.map((q) => fit.predict(q));
    const middle = { x: corners.reduce((s, q) => s + q.x, 0) / corners.length, y: corners.reduce((s, q) => s + q.y, 0) / corners.length };
    // Towards the topmost corner: clear of the cursor display at the map's bottom left, which differs between the pages.
    const top = corners.reduce((a, b) => (b.y < a.y ? b : a));
    const quiet = { x: top.x + (middle.x - top.x) / 4, y: top.y + (middle.y - top.y) / 4 };
    expected.push({ p, images: images.map((i) => ({ ...i, at: fit.predict(i.position) })), quiet });
  }
  let last = '';
  await expect(async () => {
    const [mine, theirs] = [await shot(page), await shot(reference)];
    const counts = expected.map((e) => ({
      what: e.p.graphic.what,
      icons: e.images.map((i) => differing(mine, theirs, i.at, i.width, i.height)),
      sizes: e.images.map((i) => `${Math.round(i.width)}x${Math.round(i.height)}`),
      quiet: differing(mine, theirs, e.quiet, 16, 16),
    }));
    last = JSON.stringify(counts);
    expect(counts.every((c) => c.icons.every((n) => n >= 30) && c.quiet <= 4), `${where}: the icons drawn, the rest of the area the same: ${last}`).toBe(true);
  }).toPass({ timeout: 20_000, intervals: [500] });
  test.info().annotations.push({ type: where, description: last });
  await test.info().attach(`${where}.png`, { body: await page.screenshot({ clip: await visibleMap(page) }), contentType: 'image/png' });
}

async function placeGraphics(page: Page, live: LiveClient): Promise<Placed[]> {
  const layer = createLayer('ITA images');
  expect((await live.change(layer)).outcome).toBe('applied');
  const centre = await mapCentre(page);
  const placed: Placed[] = [];
  for (const [n, graphic] of GRAPHICS.entries()) {
    const ring: LonLat[] = [];
    for (const corner of CORNERS) ring.push(await positionAt(page, { x: centre.x + ORIGINS[n].x + corner.x, y: centre.y + ORIGINS[n].y + corner.y }));
    const request = {
      requestId: randomUUID(),
      entityType: 'object',
      operation: 'create',
      entityId: randomUUID(),
      data: {
        type: 'core.multipoint',
        dataType: 'core.general',
        dataSource: 'manual',
        layerId: layer.entityId,
        geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
        symbol: { standard: graphic.standard, sidc: graphic.sidc },
        properties: { name: `ITA ${graphic.what}` },
        label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
      },
      source: { plugin: 'ita-test' },
    };
    const outcome = await live.change(request);
    expect(outcome.outcome, JSON.stringify(outcome.rejection ?? '')).toBe('applied');
    placed.push({ graphic, ring });
  }
  return placed;
}

test('criterion 93 (map-view-2d) and 18 (draw-tactical): an APP-6D mined area and an APP-6E chemical contaminated area show their icons, in EPSG:3857, after a zoom, in EPSG:3413 and in a dark look', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, open }) => {
      const page = await open();
      const placed = await placeGraphics(page, live);
      const start = await viewport(page);
      const withoutImages = (options?: OpenAppOptions) => open(refuseSvgImages, options);
      const reference = await withoutImages();
      await iconsShown(page, reference, placed, 'EPSG:3857, light');

      // A zoom out: the icons keep their screen size, the areas get smaller round the map's centre.
      await goTo(page, start.center as LonLat, start.resolution * 1.5);
      await iconsShown(page, reference, placed, 'EPSG:3857, zoomed out');

      // Zoomed out as well: EPSG:3413 turns the areas round the map's centre (its central meridian is
      // 45° W), and so they stay clear of the map's edges and the cursor display.
      await switchProjection(page, 'EPSG:3413');
      await goTo(page, start.center as LonLat, start.resolution * 1.5);
      await iconsShown(page, reference, placed, 'EPSG:3413');

      // A dark computer with no look chosen: the app's dark look (m2-looks). The projection chosen
      // above is the user's (the setup), so these pages start in EPSG:3413.
      const dark = await open(undefined, { context: { colorScheme: 'dark' } });
      const darkReference = await withoutImages({ context: { colorScheme: 'dark' } });
      await switchProjection(dark, 'EPSG:3857');
      await goTo(dark, start.center as LonLat, start.resolution);
      await iconsShown(dark, darkReference, placed, 'EPSG:3857, dark');
    },
    { probe: true },
  );
});
