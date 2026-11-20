// Quick run: @live @plugin-draw-symbols @plugin-map-view-2d
import { expect, test } from '@playwright/test';
import { colourAround, FRIEND, mapCentre, nextEvent, placeSymbols, withM0 } from '../../lib/m0';

// M0 flow "two browsers": all users share the same live picture (requirements, "View"). A symbol
// drawn in one browser appears live in another, and is still there after a reload.

test.describe.configure({ timeout: 120_000 });

test('a symbol drawn in one browser appears live in another, and is still there after a reload', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, open }) => {
    const drawer = await open();
    const watcher = await open();
    // Both start with the same view (map-view-2d settings) and the same window size, so the same
    // pixel shows the same position in both.
    const at = await mapCentre(drawer);
    expect(await mapCentre(watcher)).toEqual(at);
    expect(await colourAround(watcher, at, FRIEND)).toBe(0);

    await placeSymbols(drawer, 'Infantry', [at]);
    await nextEvent(live, (e) => e.entityType === 'object' && e.operation === 'create');
    await expect.poll(() => colourAround(watcher, at, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
    await expect(watcher.getByRole('tabpanel', { name: 'Layers', exact: true }).getByRole('listitem').filter({ hasText: 'Drawing' }).getByText('1 object', { exact: true })).toBeVisible();

    await watcher.reload();
    await expect(watcher.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
    await expect.poll(() => colourAround(watcher, at, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
  });
});
