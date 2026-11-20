// Quick run: @plugin-draw-symbols @plugin-map-view-2d
import { expect, test, type Page } from '@playwright/test';
import {
  colourAround,
  colourCentre,
  drag,
  expectNear,
  FRIEND,
  HIGHLIGHT,
  HOSTILE,
  mapCentre,
  nextEvent,
  placeSymbols,
  positionAt,
  settle,
  withM0,
  type M0,
  type Point,
} from '../../lib/m0';

// M0 flows "select", "drag" and "delete" with the real plugins: draw-symbols drives the
// interactions, map-view-2d picks, highlights, drags and pans.

test.describe.configure({ timeout: 120_000 });

const offset = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

/** Places one friendly infantry symbol at the map centre; returns its point, id and stored position. */
async function placeOne({ live }: M0, page: Page) {
  const at = await mapCentre(page);
  const position = await positionAt(page, at);
  await placeSymbols(page, 'Infantry', [at]);
  const created = await nextEvent(live, (e) => e.entityType === 'object' && e.operation === 'create');
  await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
  return { at, id: created.entityId, layerId: created.state.layerId as string, position };
}

function properties(page: Page) {
  return page.getByRole('region', { name: 'Symbol properties' });
}

test('select: the highlight appears, Symbol properties shows the symbol, and a new identity reaches the map', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async (m0) => {
    const page = await m0.open();
    const symbol = await placeOne(m0, page);
    expect(await colourAround(page, symbol.at, HIGHLIGHT)).toBe(0);

    await page.mouse.click(symbol.at.x, symbol.at.y);
    await expect.poll(() => colourAround(page, symbol.at, HIGHLIGHT, 32), { timeout: 10_000 }).toBeGreaterThan(20);
    await expect(properties(page).getByRole('img', { name: 'Selected symbol' })).toBeVisible();
    await expect(properties(page).getByLabel('Identity')).toHaveValue('3');

    await properties(page).getByLabel('Identity').selectOption('6'); // Hostile
    const updated = await nextEvent(m0.live, (e) => e.entityId === symbol.id && e.operation === 'update');
    expect(updated.state.symbol.sidc[3], 'standard identity hostile').toBe('6');
    expectNear(updated.state.geometry.coordinates, symbol.position);
    await expect.poll(() => colourAround(page, symbol.at, HOSTILE), { timeout: 10_000 }).toBeGreaterThan(50);
    expect(await colourAround(page, symbol.at, FRIEND)).toBe(0);
  });
});

test('drag: the selected symbol can be dragged twice in a row, and each drop is stored where the pointer was', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async (m0) => {
    const page = await m0.open();
    const symbol = await placeOne(m0, page);
    const first = offset(symbol.at, 120, 60);
    const second = offset(symbol.at, -100, 90);
    const firstPosition = await positionAt(page, first);
    const secondPosition = await positionAt(page, second);

    await page.mouse.click(symbol.at.x, symbol.at.y);
    await expect.poll(() => colourAround(page, symbol.at, HIGHLIGHT, 32), { timeout: 10_000 }).toBeGreaterThan(20);

    await drag(page, symbol.at, first);
    const moved = await nextEvent(m0.live, (e) => e.entityId === symbol.id && e.operation === 'update');
    expectNear(moved.state.geometry.coordinates, firstPosition);
    await expect.poll(() => colourAround(page, first, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);

    // The same symbol a second time (map-view-2d criterion 7: a drag can start again after a drop).
    await drag(page, first, second);
    // The second drop is the update after the first one, whatever the version numbers are.
    const movedAgain = await nextEvent(m0.live, (e) => e.entityId === symbol.id && e.operation === 'update' && e.sequenceNo > moved.sequenceNo);
    expectNear(movedAgain.state.geometry.coordinates, secondPosition);
    await expect.poll(() => colourAround(page, second, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
    expect(await colourAround(page, symbol.at, FRIEND)).toBe(0);
    expect(await colourAround(page, first, FRIEND)).toBe(0);
  });
});

test('pan: with a symbol selected, dragging on empty map pans the map and does not move the symbol (B1 regression)', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async (m0) => {
    const page = await m0.open();
    const symbol = await placeOne(m0, page);
    await page.mouse.click(symbol.at.x, symbol.at.y);
    await expect.poll(() => colourAround(page, symbol.at, HIGHLIGHT, 32), { timeout: 10_000 }).toBeGreaterThan(20);

    // Up and to the left of the symbol: the map view's own box (projection, background, dim) is at
    // the top right, and a drag that starts on it selects its text instead of panning.
    const empty = offset(symbol.at, -200, -150);
    expect(await colourAround(page, empty, FRIEND)).toBe(0);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, empty), 'the drag starts on the map, not on a control over it').toBe('CANVAS');
    await drag(page, empty, offset(empty, -90, 70));

    // The map moved with the pointer: the symbol is now drawn about 90 px left and 70 px down
    // (OpenLayers may add a little), with its highlight, and still at its own position.
    const shifted = offset(symbol.at, -90, 70);
    await expect.poll(() => colourAround(page, shifted, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
    expect(await colourAround(page, symbol.at, FRIEND)).toBe(0);
    const drawnAt = (await colourCentre(page, shifted, FRIEND))!;
    test.info().annotations.push({ type: 'pan', description: `symbol moved by ${(drawnAt.x - symbol.at.x).toFixed(1)}, ${(drawnAt.y - symbol.at.y).toFixed(1)} px for a drag of -90, 70` });
    expect(Math.abs(drawnAt.x - shifted.x), 'horizontal pan').toBeLessThan(15);
    expect(Math.abs(drawnAt.y - shifted.y), 'vertical pan').toBeLessThan(15);
    expect(await colourAround(page, drawnAt, HIGHLIGHT, 32)).toBeGreaterThan(20);
    const [lon, lat] = await positionAt(page, { x: Math.round(drawnAt.x), y: Math.round(drawnAt.y) });
    expect(Math.abs(lon - symbol.position[0]), 'longitude within about two pixels').toBeLessThan(0.1);
    expect(Math.abs(lat - symbol.position[1]), 'latitude within about two pixels').toBeLessThan(0.05);

    const earlier = await settle(m0.live, symbol.layerId);
    expect(earlier.filter((e) => e.entityId === symbol.id && e.operation !== 'create'), 'no change to the symbol').toEqual([]);
  });
});

test('delete: the Delete key asks first (the shared Delete); cancelled, the symbol stays; confirmed, it leaves the map with no highlight', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async (m0) => {
    const page = await m0.open();
    const symbol = await placeOne(m0, page);
    await page.mouse.click(symbol.at.x, symbol.at.y);
    await expect.poll(() => colourAround(page, symbol.at, HIGHLIGHT, 32), { timeout: 10_000 }).toBeGreaterThan(20);

    // The shell's shared Delete (SDK 1.1.0 part 8, ADR-0032 point 6) asks how many objects, and
    // that there is no undo. Cancel (the first button, focused) keeps the symbol.
    const question = page.getByRole('alertdialog', { name: 'Delete objects' });
    await page.keyboard.press('Delete');
    await expect(question).toContainText('Delete 1 object? This cannot be undone.');
    await question.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toBeHidden();
    const kept = await settle(m0.live, symbol.layerId);
    expect(kept.filter((e) => e.entityId === symbol.id && e.operation === 'delete'), 'not deleted after Cancel').toEqual([]);
    expect(await colourAround(page, symbol.at, FRIEND)).toBeGreaterThan(0);

    await page.keyboard.press('Delete');
    await expect(question).toContainText('Delete 1 object? This cannot be undone.');
    await question.getByRole('button', { name: 'Delete 1 object' }).click();
    await nextEvent(m0.live, (e) => e.entityId === symbol.id && e.operation === 'delete');
    await expect.poll(() => colourAround(page, symbol.at, FRIEND), { timeout: 10_000 }).toBe(0);
    expect(await colourAround(page, symbol.at, HIGHLIGHT, 32)).toBe(0);
    await expect(properties(page)).toContainText('Select a symbol on the map.');
  });
});
