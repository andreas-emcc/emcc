// Quick run: @plugin-draw-symbols
import { expect, test } from '@playwright/test';
import { colourAround, colourCentre, drag, expectNear, FRIEND, mapCentre, nextEvent, positionAt, userPause, withM0 } from '../../lib/m0';

// draw-symbols' acceptance criteria 1 and 3 in a real browser (docs/plugins/briefs/draw-symbols.md),
// the parts its unit tests leave to the ITA (docs/handover/pca-draw-symbols.md): the second browser
// within 1 s, and the drop point within 1 pixel.

test.describe.configure({ timeout: 120_000 });

test('criterion 1: placing sends exactly one valid create (active layer, new id, default label), and a second browser shows it within 1 s', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    const sent: string[] = [];
    const drawer = await open((page) => {
      page.on('websocket', (socket) => socket.on('framesent', (frame) => sent.push(String(frame.payload))));
    });
    const watcher = await open();
    const defaultLabel = (await (await fetch(`${server.baseUrl}/api/config`)).json()).defaultLabel;
    const activeLayer = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id;

    const panel = drawer.getByRole('region', { name: 'Symbols' });
    await panel.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: 'Infantry', exact: true }).click();
    await panel.getByRole('button', { name: 'Place on map' }).click();
    const centre = await mapCentre(drawer);
    const times: number[] = [];
    const ids = new Set<string>();
    for (const [i, dx] of [-200, 0, 200].entries()) {
      const point = { x: centre.x + dx, y: centre.y + (i === 1 ? 70 : -70) };
      expect(await colourAround(watcher, point, FRIEND)).toBe(0);
      const clicked = Date.now();
      await drawer.mouse.click(point.x, point.y);
      // Screenshots of the second browser until the symbol is there; the time includes the
      // screenshots, so it is an upper bound.
      while ((await colourAround(watcher, point, FRIEND)) < 50) {
        expect(Date.now() - clicked, 'symbol in the second browser').toBeLessThan(1000);
      }
      times.push(Date.now() - clicked);
      const created = await nextEvent(live, (e) => e.entityType === 'object' && e.operation === 'create' && !ids.has(e.entityId));
      ids.add(created.entityId);
      expect(created.state.layerId, 'the active layer').toBe(activeLayer);
      expect(created.state.label, 'the default label').toEqual(defaultLabel);
      expect(created.entityId, 'a new UUID v7').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      await userPause(drawer);
    }
    await drawer.keyboard.press('Escape');
    testInfo.annotations.push({ type: 'criterion 1', description: `click to second browser: ${times.join(', ')} ms (upper bounds)` });

    // Exactly one change request per click went over the drawer's WebSocket, and each was applied
    // (the server validates every request against the schema; an invalid one is rejected).
    const requests = sent.map((text) => JSON.parse(text)).filter((m) => m.type === 'change-request');
    expect(requests.map((m) => m.request.entityId).sort()).toEqual([...ids].sort());
    for (const m of requests) expect(m.request.operation).toBe('create');
  });
});

test('criterion 3: a dragged symbol is stored at the drop point within 1 pixel (latitude ≠ longitude)', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, open }) => {
    const page = await open();
    const centre = await mapCentre(page);
    const panel = page.getByRole('region', { name: 'Symbols' });
    await panel.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: 'Infantry', exact: true }).click();
    await panel.getByRole('button', { name: 'Place on map' }).click();
    await page.mouse.click(centre.x, centre.y);
    await userPause(page);
    await page.keyboard.press('Escape');
    const created = await nextEvent(live, (e) => e.entityType === 'object' && e.operation === 'create');
    await expect.poll(() => colourAround(page, centre, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);

    const drop = { x: centre.x + 137, y: centre.y - 83 };
    const dropPosition = await positionAt(page, drop);
    // One pixel at the drop point, in degrees: the positions of its neighbours.
    const right = await positionAt(page, { x: drop.x + 1, y: drop.y });
    const below = await positionAt(page, { x: drop.x, y: drop.y + 1 });
    const pixel = { lon: Math.abs(right[0] - dropPosition[0]), lat: Math.abs(below[1] - dropPosition[1]) };
    expect(dropPosition[0]).not.toBeCloseTo(dropPosition[1], 1);

    await page.mouse.click(centre.x, centre.y);
    await drag(page, centre, drop);
    const moved = await nextEvent(live, (e) => e.entityId === created.entityId && e.operation === 'update');
    const [lon, lat] = moved.state.geometry.coordinates;
    testInfo.annotations.push({
      type: 'criterion 3',
      description: `drop ${dropPosition.join(', ')}, stored ${lon}, ${lat}, one pixel = ${pixel.lon.toFixed(5)}° lon, ${pixel.lat.toFixed(5)}° lat`,
    });
    expect(Math.abs(lon - dropPosition[0]), 'longitude within 1 pixel').toBeLessThanOrEqual(pixel.lon);
    expect(Math.abs(lat - dropPosition[1]), 'latitude within 1 pixel').toBeLessThanOrEqual(pixel.lat);
    expectNear([lon, lat], dropPosition); // in fact equal to the cursor display (6 decimals)

    // And it is drawn there: the symbol's pixels are centred within a pixel or two of the drop.
    await expect.poll(() => colourAround(page, drop, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
    const drawnAt = (await colourCentre(page, drop, FRIEND))!;
    expect(Math.abs(drawnAt.x - drop.x)).toBeLessThan(2);
    expect(Math.abs(drawnAt.y - drop.y)).toBeLessThan(2);
  });
});
