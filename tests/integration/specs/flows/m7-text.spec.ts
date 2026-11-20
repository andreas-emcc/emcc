// Quick run: @plugin-map-view-2d @live
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { seededLayer } from '../../lib/live.mjs';
import { mapCentre, pixelsAround, withM0, type LonLat, type Point } from '../../lib/m0';

// Text objects in the browser (core.text; data model 1.6.0, "Changes in 1.6.0"; map-view-2d
// function 45 and criterion 106; T-173, ADR-0055 point 4): a core.text is drawn as its text at its
// point, centred, in its style's strokeColor and text.size pixels; turned by text.rotation
// (clockwise from north); always drawn, also zoomed out past the label threshold; picked on its
// text's box and selected by a click. Created through the live picture API (no tool draws one in
// M7; nvg imports them). The map is placed with the ITA's probe. Positions [lon, lat], lat ≠ lon.

test.describe.configure({ timeout: 180_000 });

const MAGENTA = [255, 0, 255] as const;
const AT: LonLat = [15.2, 58.4];

type ProbeView = { goTo(c: LonLat, r: number): void; pick(p: [number, number], t?: number): readonly string[]; selection: { value: readonly string[] }; viewport: { resolution: number } };
type Probe = { __itaProbe: { mapView: ProbeView } };

async function goTo(page: Page, center: LonLat, resolution: number): Promise<void> {
  await page.evaluate(([c, r]) => (window as unknown as Probe).__itaProbe.mapView.goTo(c, r), [center, resolution] as const);
  await expect.poll(() => page.evaluate(() => (window as unknown as Probe).__itaProbe.mapView.viewport.resolution), { message: `the map at ${resolution} m per pixel` })
    .toBeCloseTo(resolution, 0);
}

/** The probe's pick at a page point, in Map Pane pixels. */
async function pickAt(page: Page, at: Point, tolerance = 2): Promise<readonly string[]> {
  const pane = (await page.getByRole('main', { name: 'Map Pane' }).boundingBox())!;
  return page.evaluate(([x, y, t]) => (window as unknown as Probe).__itaProbe.mapView.pick([x, y], t), [at.x - pane.x, at.y - pane.y, tolerance] as const);
}

/** The box of the magenta pixels round a point (page pixels), or null when there are none. */
async function magentaBox(page: Page, at: Point, half = 90): Promise<{ count: number; width: number; height: number; cx: number; cy: number } | null> {
  const image = await pixelsAround(page, at, half);
  let count = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = image.pixel(x, y);
      if (Math.abs(r - MAGENTA[0]) <= 40 && g <= 60 && Math.abs(b - MAGENTA[2]) <= 40) {
        count++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  if (count === 0) return null;
  return { count, width: maxX - minX + 1, height: maxY - minY + 1, cx: at.x - half + (minX + maxX + 1) / 2, cy: at.y - half + (minY + maxY + 1) / 2 };
}

function textRequest(layerId: string, text: { value: string; rotation: number; size: number }, operation: 'create' | 'update' = 'create', entityId: string = randomUUID(), baseVersion?: number) {
  return {
    requestId: randomUUID(),
    entityType: 'object',
    operation,
    entityId,
    ...(baseVersion === undefined ? {} : { baseVersion }),
    data: {
      type: 'core.text',
      dataType: 'core.general',
      dataSource: 'manual',
      layerId,
      geometry: { type: 'Point', coordinates: AT },
      properties: { name: 'ITA text' },
      label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
      text,
      style: { strokeColor: '#FF00FF' },
    },
    source: { plugin: 'ita-test' },
  };
}

test('a core.text (map-view-2d function 45, criterion 106): drawn as its text centred on its point in its colour and size, turned by its rotation, always drawn when zoomed far out, picked on its box and selected by a click', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    const page = await open();
    await goTo(page, AT, 100);
    const centre = await mapCentre(page);

    // Upright (rotation 0), 24 px: wider than tall, centred on its point.
    const created = await live.change(textRequest(layer, { value: 'ALPHA BRAVO', rotation: 0, size: 24 }));
    expect(created.outcome, JSON.stringify(created)).toBe('applied');
    const id = created.event.entityId as string;
    expect(created.event.state, 'the text as stored').toMatchObject({ type: 'core.text', text: { value: 'ALPHA BRAVO', rotation: 0, size: 24 }, geometry: { coordinates: AT } });
    await expect.poll(async () => (await magentaBox(page, centre))?.count ?? 0, { timeout: 10_000, message: 'the text drawn in its colour' }).toBeGreaterThan(80);
    const upright = (await magentaBox(page, centre))!;
    testInfo.annotations.push({ type: 'rotation 0', description: JSON.stringify(upright) });
    expect(upright.width, 'upright: wide').toBeGreaterThan(2 * upright.height);
    expect(upright.height, 'about its 24 px size (capitals)').toBeGreaterThanOrEqual(12);
    expect(upright.height).toBeLessThanOrEqual(30);
    expect(Math.abs(upright.cx - centre.x), 'centred on its point (x)').toBeLessThanOrEqual(4);
    expect(Math.abs(upright.cy - centre.y), 'centred on its point (y)').toBeLessThanOrEqual(4);
    await page.screenshot({ path: testInfo.outputPath('text-0.png') });

    // Picked on its text's box: at the point and near the end of the text, not well outside it.
    expect(await pickAt(page, centre), 'picked at its point').toContain(id);
    expect(await pickAt(page, { x: centre.x + 45, y: centre.y }), 'picked 45 px along its text').toContain(id);
    // Near its end, 74 px from the point for this text: on its box too (function 45).
    expect.soft(await pickAt(page, { x: Math.round(upright.cx + upright.width / 2 - 4), y: centre.y }), 'picked near its end, on its box').toContain(id);
    expect(await pickAt(page, { x: centre.x, y: centre.y + 60 }), 'not 60 px below an upright text').not.toContain(id);

    // Turned by 90° (clockwise from north): now taller than wide, still centred.
    const turned = await live.change(textRequest(layer, { value: 'ALPHA BRAVO', rotation: 90, size: 24 }, 'update', id, created.event.state.version));
    expect(turned.outcome, JSON.stringify(turned)).toBe('applied');
    await expect.poll(async () => {
      const box = await magentaBox(page, centre);
      return box !== null && box.height > 2 * box.width;
    }, { timeout: 10_000, message: 'turned upright to vertical' }).toBe(true);
    const vertical = (await magentaBox(page, centre))!;
    testInfo.annotations.push({ type: 'rotation 90', description: JSON.stringify(vertical) });
    expect(Math.abs(vertical.height - upright.width), 'the same text, turned').toBeLessThanOrEqual(6);
    expect(Math.abs(vertical.cx - centre.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(vertical.cy - centre.y)).toBeLessThanOrEqual(4);
    expect(await pickAt(page, { x: centre.x, y: centre.y + 40 }), 'the box turns too: picked 40 px below its point').toContain(id);
    expect(await pickAt(page, { x: centre.x + 40, y: centre.y }), 'and no longer 40 px right of it').not.toContain(id);
    await page.screenshot({ path: testInfo.outputPath('text-90.png') });

    // 30° (criterion 106): between the two, the box neither as wide nor as narrow.
    const thirty = await live.change(textRequest(layer, { value: 'ALPHA BRAVO', rotation: 30, size: 24 }, 'update', id, turned.event.state.version));
    expect(thirty.outcome).toBe('applied');
    await expect.poll(async () => {
      const box = await magentaBox(page, centre);
      return box !== null && box.height < vertical.height - 10 && box.width < upright.width - 10 && box.height > upright.height + 10;
    }, { timeout: 10_000, message: 'turned 30°' }).toBe(true);
    // Clockwise: the text's end (its right in the upright text) goes down to the right, so the magenta
    // right of the point lies below it.
    const right = (await magentaBox(page, { x: centre.x + 40, y: centre.y }, 25))!;
    expect(right, 'magenta 40 px right of the point').not.toBeNull();
    expect(right.cy, 'clockwise: below the point on the right').toBeGreaterThan(centre.y + 5);

    // Always drawn: far out, where a label would be hidden.
    await goTo(page, AT, 20_000);
    await expect.poll(async () => (await magentaBox(page, centre))?.count ?? 0, { timeout: 10_000, message: 'still drawn zoomed far out' }).toBeGreaterThan(80);

    // A click on its text selects it.
    await goTo(page, AT, 100);
    await expect.poll(async () => (await magentaBox(page, centre))?.count ?? 0, { timeout: 10_000 }).toBeGreaterThan(80);
    await page.mouse.click(centre.x, centre.y);
    await expect.poll(() => page.evaluate(() => (window as unknown as Probe).__itaProbe.mapView.selection.value), { message: 'selected by a click' }).toEqual([id]);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (window as unknown as Probe).__itaProbe.mapView.selection.value)).toEqual([]);

    // Deleted: gone from the map.
    const removed = await live.change({ requestId: randomUUID(), entityType: 'object', operation: 'delete', entityId: id, source: { plugin: 'ita-test' } });
    expect(removed.outcome).toBe('applied');
    await expect.poll(async () => (await magentaBox(page, centre))?.count ?? 0, { timeout: 10_000, message: 'gone after its delete' }).toBe(0);
  }, { probe: true });
});
