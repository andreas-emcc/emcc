// Quick run: @plugin-coordinates
import { expect, test } from '@playwright/test';
import { closeCoordinates, coordinates, mapCentre, mapPane, positionAt, withM0, type Point } from '../../lib/m0';

// M0 flow "coordinates" with the real plugins: the cursor display follows the mouse, and "Go to"
// moves the map. Positions have latitude ≠ longitude (ADR-0007).

test.describe.configure({ timeout: 120_000 });

/** The window's top right corner against the icon's: its frame may stand out by a few pixels. */
const CORNER_PX = 12;

test('the cursor display follows the mouse: east is a higher longitude, north a higher latitude', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    const centre = await mapCentre(page);
    const here = await positionAt(page, centre);
    const east = await positionAt(page, { x: centre.x + 100, y: centre.y });
    const north = await positionAt(page, { x: centre.x, y: centre.y - 100 });
    expect(east[0]).toBeGreaterThan(here[0]);
    expect(east[1]).toBeCloseTo(here[1], 5);
    expect(north[1]).toBeGreaterThan(here[1]);
    expect(north[0]).toBeCloseTo(here[0], 5);
    // In Web Mercator, 100 px are the same longitude span everywhere at one zoom level.
    const west = await positionAt(page, { x: centre.x - 100, y: centre.y });
    expect(east[0] - here[0]).toBeCloseTo(here[0] - west[0], 4);
  });
});

test('"Coordinates" is an icon over the map (T-104): it opens the dialog in the icon\'s place with the icon hidden (T-162), Escape closes it and the focus goes back to the icon; open or closed is remembered in this browser', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    const icon = mapPane(page).getByRole('button', { name: 'Coordinates', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Coordinates', exact: true });
    await expect(dialog).toBeHidden();
    const place = (await icon.boundingBox())!;
    await icon.click();
    await expect(dialog).toBeVisible();
    // T-162 (owner, 2026-11-10): as the map settings window, in the icon's place in the corner,
    // growing to the left over the map; the icon hidden meanwhile.
    await expect(icon, 'the icon hidden while the window is open').toBeHidden();
    const window = (await dialog.boundingBox())!;
    const corner = { right: window.x + window.width - (place.x + place.width), top: window.y - place.y };
    expect(Math.abs(corner.right) <= CORNER_PX && Math.abs(corner.top) <= CORNER_PX, `the window's top right at the icon's (off by ${JSON.stringify(corner)} px)`).toBe(true);
    expect(window.width, 'it grows to the left').toBeGreaterThan(place.width * 2);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(icon).toBeFocused();

    await icon.click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('emc2.coordinates.open'))).toBe('true');
    await page.reload();
    await expect(dialog, 'open after a reload').toBeVisible();
    await dialog.getByRole('button', { name: 'Close coordinates' }).click();
    await page.reload();
    await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
    await expect(mapPane(page).getByRole('button', { name: 'Coordinates', exact: true })).toBeVisible();
    await expect(dialog, 'closed after a reload').toBeHidden();
  });
});

for (const [format, text] of [
  ['DD', '59.329300° N 18.068600° E'],
  ['DMS', `59°19'45.5" N 018°04'07.0" E`],
] as const) {
  test(`"Go to" with ${format} text centres the map on that position`, async ({ browser }, testInfo) => {
    await withM0(testInfo, browser, async ({ open }) => {
      const page = await open();
      const centre = await mapCentre(page);
      const before = await positionAt(page, centre);
      const panel = await coordinates(page);
      await panel.getByRole('textbox').fill(text);
      await panel.getByRole('button', { name: 'Go' }).click();
      await expect(panel.getByRole('alert')).toHaveCount(0);
      // The dialog stays open after "Go" and covers the map's top right: closed before pointing.
      await closeCoordinates(page);

      // Stockholm, about [18.0686, 59.3293]: within about a pixel at the initial zoom.
      await expect
        .poll(async () => {
          const [lon, lat] = await positionAt(page, centre);
          return Math.abs(lon - 18.0686) < 0.05 && Math.abs(lat - 59.3293) < 0.025;
        }, { timeout: 10_000 })
        .toBe(true);
      expect(Math.abs(before[0] - 18.0686)).toBeGreaterThan(1);
    });
  });
}

for (const format of ['utm', 'mgrs'] as const) {
  test(`"Go to" with the ${format.toUpperCase()} text the cursor display shows for a point centres the map there`, async ({
    browser,
  }, testInfo) => {
    await withM0(testInfo, browser, async ({ open }) => {
      const page = await open();
      const centre = await mapCentre(page);
      const point: Point = { x: centre.x + 150, y: centre.y - 90 };
      const expected = await positionAt(page, point); // DD, the reference
      await (await coordinates(page)).getByRole('combobox').selectOption(format);
      await closeCoordinates(page);
      await page.mouse.move(point.x, point.y);
      const display = page.locator('[aria-label="Pointer position"]');
      await expect(display).not.toHaveText(/°/);
      const text = (await display.textContent())!;

      const panel = await coordinates(page);
      await panel.getByRole('textbox').fill(text);
      await panel.getByRole('button', { name: 'Go' }).click();
      await panel.getByRole('combobox').selectOption('dd');
      await expect(panel.getByRole('alert')).toHaveCount(0);
      await closeCoordinates(page);
      await expect
        .poll(async () => {
          const [lon, lat] = await positionAt(page, centre);
          return Math.abs(lon - expected[0]) < 0.05 && Math.abs(lat - expected[1]) < 0.025;
        }, { timeout: 10_000 })
        .toBe(true);
      test.info().annotations.push({ type: format, description: `${text} for ${expected.join(', ')}` });
    });
  });
}
