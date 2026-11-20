// Quick run: @plugin-draw-symbols @plugin-cot @plugin-symbology @tak
import { expect, test, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLinks } from '../../lib/cot';
import { chosen, symbolsPanel, watchRequests, type Request } from '../../lib/fields';
import { seededLayer } from '../../lib/live.mjs';
import { assembled } from '../../lib/plugins.mjs';
import { mapCentre, positionAt, userPause, withM0 } from '../../lib/m0';
import { startTakDouble } from '../../lib/tak-double.mjs';

// M7, T-156 (SDK 1.6.0 part G, CR-0041; draw-symbols function 31, criteria 54 to 56; cot function
// 32, criterion 46): the Symbols panel's drop-down "Palette" offers "General symbols" and each
// palette of ctx.symbolPalettes, which the shell builds from the enabled plugins' manifests. Of the
// assembled plugins only cot declares one, "CoT", with the 147 rows of its closed APP-6D table, each
// the row's code with the identity friend and labelled with its CoT type and name. A palette symbol
// is placed as a catalogue entry, with the panel's identity; its echelon choice "Unchanged" (owner
// RW A, 2026-11-12) keeps the palette code's own echelon, "None" sets none. Placed in a layer that a
// cot out link sends, it goes out as the row's CoT type (the same table). The choice is kept in the
// user's documents (draw-symbols P2) and survives a reload. Positions are read from the cursor
// display (latitude ≠ longitude in the M0 view).

test.describe.configure({ timeout: 180_000 });

type PaletteSymbol = { standard: string; code: string; label?: string };

/** cot's palette as its assembled manifest declares it (the copy the test server reads). */
function cotPalette(): { id: string; name: string; symbols: PaletteSymbol[] } {
  const manifest = JSON.parse(readFileSync(join(assembled, 'cot', 'plugin.json'), 'utf8'));
  expect(manifest.symbolPalettes, 'cot declares one palette').toHaveLength(1);
  return manifest.symbolPalettes[0];
}

/** The option labels of a select, in order. */
async function optionsOf(select: Locator): Promise<string[]> {
  return (await select.locator('option').allTextContents()).map((t) => t.trim());
}

/** The SIDC the panel's preview shows for the chosen symbol. */
function previewCode(panel: Locator): Locator {
  return panel.locator('.draw-symbols-preview code');
}

test('symbol palettes (T-156; draw-symbols 54 to 56, cot 46): "General symbols" and "CoT" offered; CoT shows its 147 symbols from cot\'s manifest with their labels, "Unchanged" first and chosen; Infantry placed as hostile goes out over a cot out link as a-h-G-U-C-I; Platoon and None set the echelon; the choice survives a reload; back in General symbols no "Unchanged"', async ({ browser }, testInfo) => {
  const palette = cotPalette();
  expect(palette).toMatchObject({ id: 'cot', name: 'CoT' });
  expect(palette.symbols, 'the closed table\'s rows').toHaveLength(147);
  const infantry = palette.symbols.find((s) => s.label === 'G-U-C-I – Infantry')!;
  expect(infantry, 'the palette has Infantry').toBeDefined();
  expect(infantry).toMatchObject({ standard: 'APP-6D', code: '10031000001211000000' });

  const double = await startTakDouble();
  try {
    await withM0(testInfo, browser, async ({ server, snapshot, open }) => {
      const drawing = seededLayer(snapshot);
      await setLinks(server, [{ name: 'tak-out', direction: 'out', port: double.port, sourceLayers: [{ id: drawing, name: 'Drawing' }] }]);
      await double.waitForConnections(1);
      let sent: Request[] = [];
      const page = await open((p) => {
        sent = watchRequests(p);
      });
      const panel = symbolsPanel(page);
      const paletteSelect = panel.getByRole('combobox', { name: 'Palette', exact: true });
      const echelon = panel.getByRole('combobox', { name: 'Echelon', exact: true });
      const grid = panel.getByRole('group', { name: 'Symbols', exact: true });

      // Criterion 54: the drop-down, General symbols first and chosen; the catalogue as before.
      await expect(paletteSelect).toBeVisible();
      expect(await optionsOf(paletteSelect), 'the choices').toEqual(['General symbols', 'CoT']);
      await expect(chosen(paletteSelect)).toHaveText('General symbols');
      await expect(panel.getByRole('combobox', { name: 'Category', exact: true }), 'the catalogue\'s categories').toBeVisible();
      await expect(grid.getByRole('button', { name: 'Infantry', exact: true })).toBeVisible();
      expect(await optionsOf(echelon), 'General symbols offers no "Unchanged"').not.toContain('Unchanged');

      // Criterion 55 and cot 46: CoT's 147 symbols, in the manifest's order, with their labels; none refused.
      await paletteSelect.selectOption({ label: 'CoT' });
      await expect(panel.getByRole('combobox', { name: 'Category', exact: true }), 'no categories with a palette').toHaveCount(0);
      await expect(grid.getByRole('button')).toHaveCount(147);
      expect(await grid.getByRole('button').allTextContents(), 'the labels in the palette\'s order').toEqual(palette.symbols.map((s) => s.label));
      await expect(grid.getByRole('button', { disabled: true }), 'every code valid for the symbol service').toHaveCount(0);
      const echelons = await optionsOf(echelon);
      expect(echelons[0], '"Unchanged" first').toBe('Unchanged');
      expect(echelons, 'then the catalogue\'s echelons').toContain('None');
      await expect(chosen(echelon), '"Unchanged" chosen with a palette').toHaveText('Unchanged');
      const search = panel.getByRole('textbox', { name: 'Search', exact: true });
      await search.fill('Infantry');
      await expect(grid.getByRole('button'), 'the search leaves one').toHaveText(['G-U-C-I – Infantry']);

      // Placed with the identity hostile and the echelon unchanged: the palette's code with the hostile identity.
      await panel.getByRole('combobox', { name: 'Identity', exact: true }).selectOption({ label: 'Hostile' });
      await grid.getByRole('button', { name: 'G-U-C-I – Infantry', exact: true }).click();
      await expect(previewCode(panel)).toHaveText('10061000001211000000');
      const centre = await mapCentre(page);
      const place = async (at: { x: number; y: number }): Promise<Request> => {
        const from = sent.length;
        await panel.getByRole('button', { name: 'Place on map' }).click();
        await page.mouse.click(at.x, at.y);
        await userPause(page);
        await page.keyboard.press('Escape');
        await expect.poll(() => sent.slice(from).filter((r) => r.operation === 'create').length, { message: 'one symbol placed' }).toBe(1);
        return sent.slice(from).find((r) => r.operation === 'create')!;
      };
      const firstAt = { x: centre.x - 120, y: centre.y + 50 };
      const position = await positionAt(page, firstAt);
      const unchanged = await place(firstAt);
      expect(unchanged.data?.symbol, 'the palette code, hostile, its own echelon').toEqual({ standard: 'APP-6D', sidc: '10061000001211000000' });
      expect(unchanged.data?.layerId).toBe(drawing);
      // Out over the cot out link as the row's CoT type, with the affiliation hostile.
      await expect.poll(() => double.receivedEvents().find((e) => e.uid === unchanged.entityId)?.type, { timeout: 15_000, message: 'sent over the out link' }).toBe('a-h-G-U-C-I');
      const event = double.receivedEvents().find((e) => e.uid === unchanged.entityId)!;
      expect(Math.abs(event.lon! - position[0]), 'longitude').toBeLessThan(1e-5);
      expect(Math.abs(event.lat! - position[1]), 'latitude').toBeLessThan(1e-5);

      // An echelon chosen sets digits 9 and 10; None sets none.
      await echelon.selectOption({ label: 'Platoon/detachment' });
      await expect(previewCode(panel)).toHaveText('10061000141211000000');
      const platoon = await place({ x: centre.x + 80, y: centre.y + 60 });
      expect(platoon.data?.symbol?.sidc, 'Platoon').toBe('10061000141211000000');
      await expect.poll(() => double.receivedEvents().some((e) => e.uid === platoon.entityId), { timeout: 15_000, message: 'the platoon sent too' }).toBe(true);
      testInfo.annotations.push({ type: 'the platoon\'s CoT type', description: String(double.receivedEvents().find((e) => e.uid === platoon.entityId)?.type) });
      await echelon.selectOption({ label: 'None' });
      await expect(previewCode(panel), 'None').toHaveText('10061000001211000000');

      // Criterion 56: the choice is kept for the user and survives a reload.
      await page.reload();
      const reloaded = symbolsPanel(page);
      await expect(chosen(reloaded.getByRole('combobox', { name: 'Palette', exact: true })), 'CoT after the reload').toHaveText('CoT');
      await expect(reloaded.getByRole('group', { name: 'Symbols', exact: true }).getByRole('button')).toHaveCount(147);
      await expect(chosen(reloaded.getByRole('combobox', { name: 'Echelon', exact: true }))).toHaveText('Unchanged');

      // Back in General symbols: the catalogue, and no "Unchanged".
      await reloaded.getByRole('combobox', { name: 'Palette', exact: true }).selectOption({ label: 'General symbols' });
      await expect(reloaded.getByRole('combobox', { name: 'Category', exact: true })).toBeVisible();
      await expect(reloaded.getByRole('group', { name: 'Symbols', exact: true }).getByRole('button', { name: 'Infantry', exact: true })).toBeVisible();
      expect(await optionsOf(reloaded.getByRole('combobox', { name: 'Echelon', exact: true }))).not.toContain('Unchanged');
      await expect(reloaded.getByRole('textbox', { name: 'Search', exact: true }), 'no search with the catalogue').toHaveCount(0);
      await page.reload();
      await expect(chosen(symbolsPanel(page).getByRole('combobox', { name: 'Palette', exact: true })), 'General symbols kept too').toHaveText('General symbols');
    });
  } finally {
    await double.close();
  }
});
