// Quick run: @plugin-layer-panel @plugin-map-view-2d @plugin-coordinates @plugin-gmti @plugin-simulator @settings
import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { applied, watchRequests, type Request, type State } from '../../lib/fields';
import { layersPanel, newLayer, newLayerButton, openNewLayer } from '../../lib/layer-panel';
import { seededLayer, type LiveClient } from '../../lib/live.mjs';
import { bottomPanel, mapPane, nextEvent, withM0 } from '../../lib/m0';

// The layer panel in M6 (docs/plugins/briefs/layer-panel.md):
// - T-171 (functions 5 and 23, criteria 27 to 31; SDK 1.5.0 part 4, the owner's Q46 A and PS A):
//   "New layer" and "Create first layer" open a dialog with the name and the classification, the
//   default policy's order lowest first; the layer gets the default label with that classification;
//   an empty name shows "Enter a name" and sends nothing. The layer picker's "+" in a settings form
//   has the same Classification select (the CDA's A4).
// - T-154 (function 24, criteria 32 to 35; the owner's Q47 A and Q48 A): "Active layer: <name>" over
//   the map at the bottom left, just above the cursor display; it follows activation, a rename, a
//   lock (also from a second browser) and a delete, says "No active layer" when there is none, cuts
//   a long name with "…", and only shows. In View and in Simulation, in a light and a dark look.
// Each test has a server of its own. The order is application.properties' NATO order.

test.describe.configure({ timeout: 120_000 });

const NATO_ORDER = ['UNCLASSIFIED', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET', 'COSMIC TOP SECRET'];

async function defaultLabel(baseUrl: string): Promise<State> {
  return (await (await fetch(`${baseUrl}/api/config`)).json()).defaultLabel;
}

/** The option texts of a select. */
async function options(select: Locator): Promise<string[]> {
  return (await select.locator('option').allTextContents()).map((t) => t.trim());
}

/** The text of a select's chosen option. */
async function chosen(select: Locator): Promise<string> {
  return select.evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.textContent?.trim() ?? '');
}

const layerCreates = (sent: Request[]) => sent.filter((r) => r.entityType === 'layer' && r.operation === 'create');

test('T-171: "New layer" asks for the name and the classification; Escape and Cancel send nothing, an empty name shows "Enter a name" and sends nothing, and the layer made gets the classification chosen, shown in Settings › Layers in a second browser; "Create first layer" opens the same dialog', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, snapshot, open }) => {
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const label = await defaultLabel(server.baseUrl);
    expect(label.classification, 'the default label').toBe('UNCLASSIFIED');

    // The dialog: "Layer 1" and the order, lowest first, the default's chosen.
    let dialog = await openNewLayer(page);
    await expect(dialog.name).toHaveValue('Layer 1');
    expect(await options(dialog.classification), 'the default policy\'s order, lowest first').toEqual(NATO_ORDER);
    expect(await chosen(dialog.classification)).toBe('UNCLASSIFIED');
    await page.keyboard.press('Escape');
    await expect(dialog.dialog, 'Escape closes it').toBeHidden();
    dialog = await openNewLayer(page);
    await dialog.cancel.click();
    await expect(dialog.dialog).toBeHidden();

    // An empty name: "Enter a name", and Create sends nothing and leaves the dialog open (PS A).
    dialog = await openNewLayer(page);
    await dialog.name.fill('   ');
    await expect(dialog.dialog).toContainText('Enter a name');
    await dialog.create.click();
    await expect(dialog.dialog, 'still open').toBeVisible();
    await page.waitForTimeout(500);
    expect(layerCreates(sent), 'Escape, Cancel and an empty name sent nothing').toEqual([]);

    // A typed name, trimmed, and RESTRICTED: one create with the default label at RESTRICTED.
    await dialog.name.fill('  ITA Restricted  ');
    await expect(dialog.dialog).not.toContainText('Enter a name');
    await dialog.classification.selectOption('RESTRICTED');
    await dialog.create.click();
    await expect(dialog.dialog).toBeHidden();
    const created = await nextEvent(live, (e) => e.entityType === 'layer' && e.operation === 'create');
    expect(layerCreates(sent), 'one create').toHaveLength(1);
    expect(created.state.name, 'the typed name, trimmed').toBe('ITA Restricted');
    expect(created.state.label, 'the default label with the classification chosen').toEqual({ ...label, classification: 'RESTRICTED' });
    await expect(layersPanel(page).getByRole('button', { name: 'Make ITA Restricted active' }), 'on top and active').toHaveAttribute('aria-pressed', 'true');

    const other = await open();
    await other.goto('/#settings/layers');
    await expect(other.getByRole('article', { name: 'ITA Restricted' }), 'Settings › Layers in a second browser').toContainText('NATO RESTRICTED');
    await expect(other.getByRole('article', { name: 'Drawing' })).toContainText('NATO UNCLASSIFIED');

    // No layer left in View: "Create first layer" opens the same dialog.
    for (const id of [created.entityId, seededLayer(snapshot)]) {
      await applied(live, { requestId: randomUUID(), entityType: 'layer', operation: 'delete', entityId: id, source: { plugin: 'ita-test' } } as unknown as Request);
    }
    await expect(newLayerButton(page)).toHaveText(/Create first layer/);
    const name = await newLayer(page, { classification: 'SECRET' });
    const first = await nextEvent(live, (e) => e.entityType === 'layer' && e.operation === 'create' && e.state.name === name);
    expect(name).toBe('Layer 1');
    expect(first.state.label.classification).toBe('SECRET');
  });
});

test('T-171 (A4): the layer picker\'s "+" in Settings › gmti offers the same classifications, and its layer gets the one chosen', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, live, open }) => {
    const label = await defaultLabel(server.baseUrl);
    const page = await open();
    await page.goto('/#settings/plugin/gmti');
    const form = page.getByRole('tabpanel').last();
    await form.getByRole('region', { name: 'Links', exact: true }).getByRole('button', { name: 'Add link', exact: true }).click(); // T-203 part D: a new link in the side form
    const plus = form.getByRole('button', { name: /^New layer for / }).first();
    await plus.click();
    const popover = page.getByRole('dialog', { name: /^New layer for / });
    await expect(popover).toBeVisible();
    const classification = popover.getByRole('combobox', { name: 'Classification', exact: true });
    expect(await options(classification)).toEqual(NATO_ORDER);
    expect(await chosen(classification)).toBe('UNCLASSIFIED');
    await popover.getByRole('textbox', { name: 'Name of the new layer', exact: true }).fill('ITA Secret');
    await classification.selectOption('SECRET');
    await popover.getByRole('button', { name: 'Create', exact: true }).click();
    const created = await nextEvent(live, (e) => e.entityType === 'layer' && e.operation === 'create' && e.state.name === 'ITA Secret');
    expect(created.state.label).toEqual({ ...label, classification: 'SECRET' });
    expect(created.state.workspace ?? 'core.view', 'made in View').toBe('core.view');
    await expect(popover).toBeHidden();
  });
});

/** The active layer box over the map (layer-panel's overlay; no role of its own: it only shows). */
function activeBox(page: Page): Locator {
  return mapPane(page).locator('.layer-panel-active');
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The box sits just above the cursor display at the bottom left, its own width, and covers none of the map's buttons. */
async function placed(page: Page, what: string): Promise<void> {
  const box = (await activeBox(page).boundingBox())!;
  const display = (await page.locator('[aria-label="Pointer position"]').boundingBox())!;
  const pane = (await mapPane(page).boundingBox())!;
  expect(box, `${what}: drawn`).not.toBeNull();
  expect(box.y + box.height, `${what}: above the cursor display`).toBeLessThanOrEqual(display.y + 1);
  expect(display.y - (box.y + box.height), `${what}: just above it`).toBeLessThan(24);
  expect(box.x - pane.x, `${what}: at the left`).toBeLessThan(40);
  expect(pane.y + pane.height - (box.y + box.height), `${what}: at the bottom`).toBeLessThan(120);
  expect(box.width, `${what}: within 40 % of the Map Pane`).toBeLessThanOrEqual(pane.width * 0.4 + 1);
  for (const button of await mapPane(page).getByRole('button').all()) {
    const b = await button.boundingBox();
    if (b !== null && (await button.isVisible())) expect(overlaps(box, b), `${what}: covers no map button (${await button.getAttribute('aria-label')})`).toBe(false);
  }
}

/** A live client's newest state of an entity, from its events. */
function latest(live: LiveClient, id: string): State | undefined {
  return (live.events as Array<{ entityId: string; state: State | null }>).filter((e) => e.entityId === id && e.state !== null).at(-1)?.state ?? undefined;
}

async function rename(live: LiveClient, layer: State, name: string): Promise<State> {
  const { id, version, meta: _meta, ...data } = layer;
  return applied(live, { requestId: randomUUID(), entityType: 'layer', operation: 'update', entityId: id, baseVersion: version, data: { ...data, name }, source: { plugin: 'ita-test' } } as unknown as Request);
}

test('T-154: "Active layer: <name>" just above the cursor display at the bottom left; it follows activation, a rename, a lock from a second browser and a delete, says "No active layer" without one, cuts a long name with "…" and only shows', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const page = await open();
    const box = activeBox(page);
    await expect(box).toHaveText('Active layer: Drawing');
    await placed(page, 'View');
    const display = (await page.locator('[aria-label="Pointer position"]').boundingBox())!;
    expect(Math.abs((await box.boundingBox())!.width - display.width), 'each box its own width').toBeGreaterThan(2);

    // Only shows: no button, link or tab stop, and a click changes nothing.
    await expect(box.getByRole('button')).toHaveCount(0);
    await expect(box.getByRole('link')).toHaveCount(0);
    expect(await box.evaluate((el) => [el, ...el.querySelectorAll('*')].filter((e) => (e as HTMLElement).tabIndex >= 0).length), 'no tab stop').toBe(0);

    // Activation from the panel.
    await newLayer(page, { name: 'ITA Two' });
    await expect(box).toHaveText('Active layer: ITA Two');
    await layersPanel(page).getByRole('button', { name: 'Make Drawing active' }).click();
    await expect(box).toHaveText('Active layer: Drawing');
    await box.click();
    await expect(layersPanel(page).getByRole('button', { name: 'Make Drawing active' }), 'a click on the box changes nothing').toHaveAttribute('aria-pressed', 'true');

    // A rename by another user, then a lock and an unlock from a second browser's panel.
    const drawing = snapshot.layers.find((l: State) => l.id === seededLayer(snapshot)) as State;
    await rename(live, drawing, 'ITA Renamed');
    await expect(box).toHaveText('Active layer: ITA Renamed');
    const other = await open();
    await bottomPanel(other, 'Layers');
    const lock = (verb: 'Lock' | 'Unlock') => layersPanel(other).getByRole('button', { name: `${verb} ITA Renamed`, exact: true });
    await lock('Lock').click();
    await expect(box.getByRole('img', { name: 'Locked' }), 'the lock icon, labelled').toBeVisible();
    await expect(box).toContainText('ITA Renamed');
    await lock('Unlock').click();
    await expect(box.getByRole('img', { name: 'Locked' }), 'gone on unlock').toHaveCount(0);

    // A long name: cut with "…", whole in the title.
    await expect.poll(() => latest(live, drawing.id)?.locked, { message: 'unlocked' }).toBeUndefined();
    const long = `ITA ${'x'.repeat(196)}`;
    await rename(live, latest(live, drawing.id)!, long);
    await expect(box).toHaveAttribute('title', `Active layer: ${long}`);
    const cut = await box.locator('.layer-panel-active-name').evaluate((el) => ({ overflow: getComputedStyle(el).textOverflow, scroll: el.scrollWidth, client: el.clientWidth }));
    expect(cut.overflow, 'cut with "…"').toBe('ellipsis');
    expect(cut.scroll, 'longer than it shows').toBeGreaterThan(cut.client);
    await placed(page, 'a long name');

    // The active layer deleted: the panel's next active layer; none left: "No active layer".
    await applied(live, { requestId: randomUUID(), entityType: 'layer', operation: 'delete', entityId: drawing.id, source: { plugin: 'ita-test' } } as unknown as Request);
    await expect(box).toHaveText('Active layer: ITA Two');
    const two = (live.events as Array<{ entityType: string; operation: string; state: State | null }>).find((e) => e.entityType === 'layer' && e.operation === 'create' && e.state?.name === 'ITA Two')!.state!;
    await applied(live, { requestId: randomUUID(), entityType: 'layer', operation: 'delete', entityId: two.id, source: { plugin: 'ita-test' } } as unknown as Request);
    await expect(box).toHaveText('No active layer');
  });
});

test('T-154 in Simulation, light and dark: the box names Simulation\'s active layer and changes at once with the panel', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    // Dark first: the active layer is the user's setup, which the light round changes.
    for (const colorScheme of ['dark', 'light'] as const) {
      const page = await open(undefined, { context: { colorScheme } });
      const views = page.getByRole('tablist', { name: 'Views' });
      await views.getByRole('tab', { name: 'Simulation', exact: true }).click();
      await expect(views.getByRole('tab', { name: 'Simulation', exact: true })).toHaveAttribute('aria-selected', 'true');
      await bottomPanel(page, 'Layers');
      const box = activeBox(page);
      await expect(box, `${colorScheme}: Simulation's first layer`).toHaveText('Active layer: Simulation');
      await placed(page, `Simulation, ${colorScheme}`);
      const look = await box.evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
      expect(look.fg, `${colorScheme}: text and background differ`).not.toBe(look.bg);
      if (colorScheme === 'light') {
        await newLayer(page, { name: 'ITA Sim' });
        await expect(box).toHaveText('Active layer: ITA Sim');
        await layersPanel(page).getByRole('button', { name: 'Make Simulation active' }).click();
        await expect(box).toHaveText('Active layer: Simulation');
      }
      await page.context().close();
    }
  });
});

