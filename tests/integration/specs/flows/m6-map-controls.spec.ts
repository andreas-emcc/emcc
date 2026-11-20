// Quick run: @plugin-map-view-2d
import { expect, test, type Page } from '@playwright/test';
import { seededLayer } from '../../lib/live.mjs';
import { colourAround, frameSymbol, FRIEND, mapCentre, mapPane, openMapControls, positionAt, userPause, withM0 } from '../../lib/m0';

// Map controls close with Escape (T-172, M6; owner NT B: a known bug in M5 RC2, found by the UDA;
// plugins/map-view-2d/README.md "Map controls"): Escape in the open Map controls closes them, also
// from the Projection and Background lists, gives the focus back to their button, and does not
// reach the map, where it would clear the selection. A list's own drop-down, when the browser shows
// one, takes the first Escape itself (the page never sees it); headless Chromium shows none, so
// the lists are tested focused, as they are when the controls open. Each test has a server of its
// own.

/** The shared selection (`MapView.selection`), as m2-actions reads it. */
function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __itaProbe: { mapView: { selection: { value: readonly string[] } } } }).__itaProbe.mapView.selection.value]);
}

test('T-172: Escape closes the Map controls from the Projection list where the focus starts, and from the Background list; the focus goes back to their button, and the selection on the map stays', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, snapshot, open }) => {
      const page = await open();
      const centre = await mapCentre(page);
      const at = { x: centre.x - 180, y: centre.y + 40 };
      const symbol = frameSymbol(seededLayer(snapshot), await positionAt(page, at), 'friend');
      expect((await live.change(symbol)).outcome).toBe('applied');
      await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000, message: 'the symbol is drawn' }).toBeGreaterThan(50);
      await page.mouse.click(at.x, at.y);
      await userPause(page);
      await expect.poll(() => selection(page)).toEqual([symbol.entityId]);

      const controls = mapPane(page).getByRole('group', { name: 'Map controls', exact: true });
      const button = mapPane(page).getByRole('button', { name: /^Map controls/ });
      const projection = controls.getByRole('combobox', { name: 'Projection', exact: true });
      const background = controls.getByRole('combobox', { name: 'Background', exact: true });

      expect(await openMapControls(page), 'the controls start closed (part F2)').toBe(true);
      await expect(projection, 'the focus starts in the Projection list').toBeFocused();
      await page.keyboard.press('Escape');
      await expect(controls, 'Escape in the Projection list closes the controls').toBeHidden();
      await expect(button, 'the focus goes back to the button').toBeFocused();
      expect(await selection(page), 'the Escape did not reach the map').toEqual([symbol.entityId]);

      await button.click();
      await expect(projection).toBeFocused();
      await background.focus();
      await page.keyboard.press('Escape');
      await expect(controls, 'Escape in the Background list closes the controls').toBeHidden();
      await expect(button).toBeFocused();
      expect(await selection(page), 'the selection stays (Escape on the map clears it: m2-actions)').toEqual([symbol.entityId]);
    },
    { probe: true },
  );
});
