// Quick run: @plugin-layer-panel @plugin-draw-symbols
import { expect, test, type Page } from '@playwright/test';
import { newLayer } from '../../lib/layer-panel';
import { colourAround, frameSymbol, FRIEND, HOSTILE, mapCentre, nextEvent, placeSymbols, positionAt, settle, withM0 } from '../../lib/m0';

// M0 flow "layers" with the real plugins: layer-panel creates, activates, hides, reorders and
// deletes layers; draw-symbols draws into the active layer; map-view-2d hides a layer locally.

test.describe.configure({ timeout: 120_000 });

function layers(page: Page) {
  return page.getByRole('tabpanel', { name: 'Layers', exact: true });
}

/** The layer names as the panel lists them, top of the draw order first. */
async function listed(page: Page): Promise<string[]> {
  return layers(page).getByRole('list', { name: 'Layers' }).getByRole('button', { name: /^Make .* active$/ }).allTextContents();
}

test('a new layer becomes active, a symbol is drawn into it, and the layer can be hidden and shown in this browser', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, open }) => {
    const page = await open();
    await expect(layers(page).getByRole('button', { name: 'Make Drawing active' })).toHaveAttribute('aria-pressed', 'true');

    await newLayer(page);
    const created = await nextEvent(live, (e) => e.entityType === 'layer' && e.operation === 'create' && e.state.name === 'Layer 1');
    await expect(layers(page).getByRole('button', { name: 'Make Layer 1 active' })).toHaveAttribute('aria-pressed', 'true');
    await expect(layers(page).getByRole('button', { name: 'Make Drawing active' })).toHaveAttribute('aria-pressed', 'false');
    expect(await listed(page)).toEqual(['Layer 1', 'Drawing']);

    const at = await mapCentre(page);
    await placeSymbols(page, 'Infantry', [at]);
    const symbol = await nextEvent(live, (e) => e.entityType === 'object' && e.operation === 'create');
    expect(symbol.state.layerId, 'drawn into the active layer').toBe(created.entityId);
    await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
    await expect(layers(page).getByRole('listitem').filter({ hasText: 'Layer 1' }).getByText('1 object', { exact: true })).toBeVisible();

    await layers(page).getByRole('button', { name: 'Hide Layer 1' }).click();
    await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000 }).toBe(0);
    await layers(page).getByRole('button', { name: 'Show Layer 1' }).click();
    await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);

    // Hiding is local to this browser: nothing was sent for the layer.
    const earlier = await settle(live, created.entityId);
    expect(earlier.filter((e) => e.entityId === created.entityId && e.operation !== 'create')).toEqual([]);
  });
});

test('layers can be reordered, and an empty layer can be deleted while one with objects cannot', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const page = await open();
    await newLayer(page);
    const first = await nextEvent(live, (e) => e.entityType === 'layer' && e.operation === 'create' && e.state.name === 'Layer 1');
    await expect(layers(page).getByRole('button', { name: 'Make Layer 1 active' })).toHaveAttribute('aria-pressed', 'true');
    expect(await listed(page)).toEqual(['Layer 1', 'Drawing']);

    await layers(page).getByRole('button', { name: 'Move Layer 1 down' }).click();
    const moved = await nextEvent(live, (e) => e.entityId === first.entityId && e.operation === 'update');
    // The Drawing layer was seeded before the test began, so its drawOrder is in the snapshot.
    const drawingOrder = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.drawOrder as number;
    expect(moved.state.drawOrder).toBeLessThan(drawingOrder);
    await expect.poll(() => listed(page)).toEqual(['Drawing', 'Layer 1']);

    // Layer 1 gets an object; Layer 2 stays empty.
    await placeSymbols(page, 'Infantry', [await mapCentre(page)]);
    await nextEvent(live, (e) => e.entityType === 'object' && e.operation === 'create');
    await newLayer(page);
    const second = await nextEvent(live, (e) => e.entityType === 'layer' && e.operation === 'create' && e.state.name === 'Layer 2');
    await expect(layers(page).getByRole('button', { name: 'Delete Layer 1' })).toBeDisabled();

    await layers(page).getByRole('button', { name: 'Delete Layer 2' }).click();
    // Confirmed in the shared dialog (T-054 part B), not in the row.
    const question = page.getByRole('alertdialog', { name: 'Delete layer' });
    await expect(question).toContainText('Delete the empty layer "Layer 2"?');
    await question.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(question).toBeHidden();
    await nextEvent(live, (e) => e.entityId === second.entityId && e.operation === 'delete');
    await expect.poll(() => listed(page)).toEqual(['Drawing', 'Layer 1']);
  });
});

test('the layer order is the draw order: a symbol in a back layer is drawn on top once its layer is moved to the front, in this and a second browser (T-087)', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const pages = [await open(), await open()];
    await newLayer(pages[0]);
    const back = await nextEvent(live, (e) => e.entityType === 'layer' && e.operation === 'create' && e.state.name === 'Layer 1');
    await layers(pages[0]).getByRole('button', { name: 'Move Layer 1 down' }).click();
    await nextEvent(live, (e) => e.entityId === back.entityId && e.operation === 'update');
    for (const page of pages) await expect.poll(() => listed(page)).toEqual(['Drawing', 'Layer 1']);

    // Two symbols at one point: the front layer's first, with a text (a unique designation), the
    // back layer's after it, without. Before T-087's fix the map view drew every symbol with text a
    // second time above all layers, so the front one stayed on top whatever the order (the owner's
    // finding). The centre of each is its frame's fill; the text is beside it.
    const at = await mapCentre(pages[0]);
    const position = await positionAt(pages[0], at);
    const front = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id as string;
    const withText = frameSymbol(front, position, 'hostile');
    withText.data.symbol.modifiers = { uniqueDesignation: 'FRONT 1' };
    for (const request of [withText, frameSymbol(back.entityId, position, 'friend')]) {
      expect(await live.change(request)).toMatchObject({ outcome: 'applied' });
    }
    const centre = (page: (typeof pages)[number], colour: readonly number[]) => colourAround(page, at, colour, 6);
    for (const [i, page] of pages.entries()) {
      await expect.poll(() => centre(page, HOSTILE), { timeout: 10_000, message: `browser ${i + 1}: the front layer's symbol on top` }).toBeGreaterThan(50);
      expect(await centre(page, FRIEND), `browser ${i + 1}: the back layer's symbol under it`).toBe(0);
    }

    await layers(pages[0]).getByRole('button', { name: 'Move Layer 1 up' }).click();
    await nextEvent(live, (e) => e.entityId === back.entityId && e.operation === 'update' && e.state.drawOrder > (snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.drawOrder as number));
    for (const [i, page] of pages.entries()) {
      await expect.poll(() => listed(page)).toEqual(['Layer 1', 'Drawing']);
      await expect.poll(() => centre(page, FRIEND), { timeout: 10_000, message: `browser ${i + 1}: Layer 1's symbol now on top` }).toBeGreaterThan(50);
      expect(await centre(page, HOSTILE), `browser ${i + 1}: Drawing's symbol now under it`).toBe(0);
    }
  });
});
