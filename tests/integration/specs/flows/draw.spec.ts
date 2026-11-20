// Quick run: @plugin-draw-symbols @plugin-map-view-2d @plugin-symbology @plugin-basemap-osm @plugin-basemap-naturalearth
import { expect, test } from '@playwright/test';
import { colourFor } from '../../lib/fake-tiles.mjs';
import {
  colourAround,
  expectNear,
  FRIEND,
  mapCentre,
  mapPane,
  openMapControls,
  nextEvent,
  placeSymbols,
  positionAt,
  userPause,
  withM0,
} from '../../lib/m0';

// M0 flow "draw" with the real plugins (draw-symbols, map-view-2d, symbology, coordinates,
// basemap-osm on fake tiles): the map appears, a symbol chosen in "Symbols" is placed and drawn.

test.describe.configure({ timeout: 120_000 });

test('the map appears with its background and controls', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open, tiles }) => {
    const page = await open();
    await openMapControls(page);
    await expect(mapPane(page).getByRole('combobox').first()).toHaveValue('EPSG:3857');
    await expect(mapPane(page).getByRole('combobox').nth(1)).toHaveValue('osm');
    await expect(mapPane(page).getByRole('link', { name: /OpenStreetMap contributors/ })).toBeVisible();
    // The background comes from the fake tile server through basemap-osm's proxy, and the map
    // draws it: the centre shows the colour of the initial zoom level's tiles (5).
    const centre = await mapCentre(page);
    expect(tiles.requests.some((path) => path.startsWith('/5/'))).toBe(true);
    await expect.poll(() => colourAround(page, centre, colourFor(5), 40), { timeout: 10_000 }).toBeGreaterThan(3000);
    // The cursor display shows the initial centre (map-view-2d setting initialCenter [15, 62]).
    const [lon, lat] = await positionAt(page, centre);
    expect(Math.abs(lon - 15)).toBeLessThan(0.1);
    expect(Math.abs(lat - 62)).toBeLessThan(0.1);
  });
});

test('a symbol chosen in Symbols and placed on the map is drawn there and stored where it was clicked', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, open }) => {
    const page = await open();
    const centre = await mapCentre(page);
    expect(await colourAround(page, centre, FRIEND)).toBe(0);
    const clicked = await positionAt(page, centre);
    expect(clicked[0]).not.toBeCloseTo(clicked[1], 1);

    await placeSymbols(page, 'Infantry', [centre]);

    const created = await nextEvent(live, (e) => e.entityType === 'object' && e.operation === 'create');
    expect(created.state.type).toBe('core.symbol');
    expect(created.state.symbol.sidc[3], 'standard identity friend').toBe('3');
    expectNear(created.state.geometry.coordinates, clicked);
    await expect.poll(() => colourAround(page, centre, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
  });
});

test('placing at several points, one click each at a user\'s pace, makes one symbol per click where it was clicked, and the map does not zoom', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, open }) => {
    const page = await open();
    const centre = await mapCentre(page);
    const points = [-180, -90, 0, 90, 180].map((dx, i) => ({ x: centre.x + dx, y: centre.y + (i % 2 === 0 ? 60 : -60) }));
    const expected = [];
    for (const point of points) expected.push(await positionAt(page, point));

    const panel = page.getByRole('region', { name: 'Symbols' });
    await panel.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: 'Infantry', exact: true }).click();
    await panel.getByRole('button', { name: 'Place on map' }).click();
    for (const point of points) {
      await page.mouse.click(point.x, point.y);
      await userPause(page);
    }
    await page.keyboard.press('Escape');

    const creates = async () => live.events.filter((e: { entityType: string; operation: string }) => e.entityType === 'object' && e.operation === 'create');
    await expect.poll(async () => (await creates()).length, { timeout: 10_000 }).toBe(points.length);
    const stored = (await creates()).map((e: { state: { geometry: { coordinates: number[] } } }) => e.state.geometry.coordinates);
    for (const [i, position] of expected.entries()) expectNear(stored[i], position);
    // The map did not zoom: the same pixel still shows the same position.
    expectNear(await positionAt(page, points[0]), expected[0]);
  });
});
