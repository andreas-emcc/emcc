// Quick run: @settings @plugin-gmti @plugin-simulator @plugin-cot @plugin-map-view-2d @plugin-bookmarks
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { installOfflineGuard } from '../../fixtures';
import { withM0 } from '../../lib/m0';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installPlugins } from '../../lib/plugins.mjs';

// M7's shell part F in the browser (SDK 1.6.0, CR-0041 part F; docs/plugins/sdk-v1.md "Part F"):
// T-174, the Settings list grouped under the six categories of PLUGIN_CATEGORIES in the owner's
// order (Data Links, GeoMetoc, Map and Symbols, Drawing, Simulation, General), the plugins by name
// within each, the shell's own entries first in General, an empty category hidden, as the briefs'
// index (docs/plugins/briefs/README.md, "Categories") assigns the plugins; a `kind: "colour"`
// setting (gmti's pairingColour, T-181) as the browser's colour picker beside its hex; and T-152,
// a top bar item by workspace: the simulator's "Scenario" only in Simulation, the bookmarks and
// setups (no workspaces named) everywhere. No login: the local user has settings.admin.

test.describe.configure({ timeout: 180_000 });

/** The Settings list as shown: each heading as "# label", each entry as its label, in order. */
async function settingsList(page: Page): Promise<string[]> {
  const list = page.getByRole('tablist', { name: 'Settings', exact: true });
  await expect(list).toBeVisible({ timeout: 30_000 });
  return list.locator('.settings-list-heading, [role="tab"]').evaluateAll((nodes) =>
    nodes.map((n) => (n.getAttribute('role') === 'tab' ? (n.querySelector('.settings-list-label')?.textContent ?? '') : `# ${n.textContent ?? ''}`)));
}

/** What the list must show with every assembled plugin running (the briefs' index; names from the manifests). */
const FULL_LIST = [
  '# Data Links', 'ADS-B aircraft', 'AIS', 'Cursor on Target', 'FMV', 'GMTI', 'NVG',
  '# GeoMetoc', 'Natural Earth background', 'OpenStreetMap background', 'Terrain', 'WMS background maps',
  '# Map and Symbols', '2D map view', 'Coordinates', 'Symbology',
  '# Drawing', 'Draw shapes', 'Draw symbols', 'Draw tactical graphics',
  '# Simulation', 'Simulator',
  // The shell's own entries first, in their order; then the General plugins by name (layer-panel has no settings).
  '# General', 'General', 'Display', 'Data types', 'Layers', 'Labeling', 'Bookmarks', 'Objects',
];

function views(page: Page) {
  return page.getByRole('tablist', { name: 'Views' });
}

async function switchTo(page: Page, name: 'View' | 'Simulation' | 'Settings' | 'Monitor'): Promise<void> {
  await views(page).getByRole('tab', { name, exact: true }).click();
  await expect(views(page).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
}

function entryTab(page: Page, label: string): Locator {
  return page.getByRole('tablist', { name: 'Settings', exact: true }).getByRole('tab', { name: label, exact: true });
}

test('the Settings list (T-174): the six category headings in the owner\'s order, the plugins by name in each, the shell\'s own entries first in General, each entry described by its heading, the arrow keys across headings', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    await page.goto('/#settings');
    await expect.poll(() => settingsList(page), { timeout: 30_000, message: 'every plugin\'s entry, grouped' }).toEqual(FULL_LIST);
    testInfo.annotations.push({ type: 'Settings list', description: (await settingsList(page)).join(' | ') });

    // Each entry names its category for screen readers (aria-describedby: its heading).
    let heading = '';
    for (const item of FULL_LIST) {
      if (item.startsWith('# ')) {
        heading = item.slice(2);
        continue;
      }
      await expect(entryTab(page, item), `${item} under ${heading}`).toHaveAccessibleDescription(heading);
    }

    // The arrow keys follow the list's order, across a heading: NVG (last of Data Links) → Natural Earth background.
    await entryTab(page, 'NVG').click();
    await expect(page).toHaveURL(/#settings\/plugin\/nvg$/);
    await page.keyboard.press('ArrowDown');
    await expect(entryTab(page, 'Natural Earth background')).toBeFocused();
    await expect(entryTab(page, 'Natural Earth background')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(entryTab(page, 'NVG')).toHaveAttribute('aria-selected', 'true');
    // Home is the first entry of the list (Data Links' first), End the last (General's last).
    await page.keyboard.press('Home');
    await expect(entryTab(page, 'ADS-B aircraft')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(entryTab(page, 'Objects')).toHaveAttribute('aria-selected', 'true');
  });
});

test('an empty category is hidden (T-174): with only cot, map-view-2d, symbology and the simulator running the list has Data Links, Map and Symbols, Simulation and General, no GeoMetoc and no Drawing', async ({ browser }, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installPlugins(folders.pluginsDir, { only: ['cot', 'map-view-2d', 'symbology', 'simulator'] });
    const server = await start();
    const page = await guardedPage(browser, server);
    await page.goto('/#settings');
    await expect.poll(() => settingsList(page), { timeout: 30_000 }).toEqual([
      '# Data Links', 'Cursor on Target',
      '# Map and Symbols', '2D map view', 'Symbology',
      '# Simulation', 'Simulator',
      '# General', 'General', 'Display', 'Data types', 'Layers', 'Labeling',
    ]);
    await closeGuarded(page);
    await stopOwnServer(server);
  });
});

test('a colour setting (SDK 1.6.0 part F; gmti\'s pairingColour, T-181): the colour picker beside its hex, each following the other; saved as #RRGGBB; a value that is not a colour leaves the picker black and is not saved', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const page = await open();
    await page.goto('/#settings/plugin/gmti');
    const entry = page.getByRole('tabpanel', { name: /^GMTI/ });
    await expect(entry.getByRole('heading', { name: 'GMTI', level: 2 })).toBeVisible({ timeout: 30_000 });
    const hex = entry.getByRole('textbox', { name: 'Pairing line colour', exact: true });
    const picker = entry.getByLabel('Pairing line colour: pick a colour', { exact: true });
    await expect(hex, 'the default, as typed').toHaveValue('#FFFF00');
    await expect(picker).toHaveAttribute('type', 'color');
    await expect(picker, 'the picker shows the same colour').toHaveValue('#ffff00');

    // The hex typed: the picker follows.
    await hex.fill('#12ab34');
    await expect(picker).toHaveValue('#12ab34');
    // A colour picked: the hex follows, in capitals.
    await picker.fill('#ff00ff');
    await expect(hex).toHaveValue('#FF00FF');
    await entry.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(entry.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const saved = async () => (await (await fetch(`${server.baseUrl}/api/settings/plugins/gmti`)).json()).values.pairingColour;
    expect(await saved(), 'the server holds the picked colour').toBe('#FF00FF');

    // Not a colour: the text stays as typed, the picker shows black, and the value is not saved.
    await hex.fill('#12345');
    await expect(hex).toHaveValue('#12345');
    await expect(picker, 'black while the hex is not a colour').toHaveValue('#000000');
    // The form leaves the check to the server's schema (SchemaForm: "the schema's pattern reports it"): Save refused.
    const save = entry.getByRole('button', { name: 'Save', exact: true });
    await save.click();
    await expect(entry.getByRole('alert'), 'the pattern refuses it').toBeVisible();
    testInfo.annotations.push({ type: 'not a colour', description: (await entry.getByRole('alert').textContent()) ?? '' });
    expect(await saved(), 'still the saved colour').toBe('#FF00FF');
    await entry.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(hex).toHaveValue('#FF00FF');
    await expect(picker).toHaveValue('#ff00ff');
  }, { allowConsoleErrors: /Failed to load resource: the server responded with a status of 400/ }); // the refused save
});

test('a top bar item by workspace (T-152; SDK 1.6.0 part F): the simulator\'s "Scenario" only in Simulation; the bookmarks and the setups, which name no workspaces, in View and Simulation alike', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    const banner = page.getByRole('banner');
    const scenario = banner.getByRole('button', { name: 'Scenario', exact: true });
    const always = ['Bookmarks', 'Setups'];
    await expect(views(page).getByRole('tab', { name: 'View', exact: true })).toHaveAttribute('aria-selected', 'true');
    for (const name of always) await expect(banner.getByRole('button', { name, exact: true }), `${name} in View`).toBeVisible();
    await expect(scenario, 'no Scenario in View').toHaveCount(0);

    await switchTo(page, 'Simulation');
    await expect(scenario, 'Scenario in Simulation').toBeVisible({ timeout: 15_000 });
    for (const name of always) await expect(banner.getByRole('button', { name, exact: true }), `${name} in Simulation`).toBeVisible();
    await scenario.click();
    const menu = page.getByRole('menu', { name: 'Scenario', exact: true });
    await expect(menu.getByRole('menuitem', { name: /^Import scenario/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    for (const name of ['Settings', 'Monitor', 'View'] as const) {
      await switchTo(page, name);
      await expect(scenario, `no Scenario in ${name}`).toHaveCount(0);
    }
    await page.reload();
    await expect(views(page).getByRole('tab', { name: 'View', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
    await expect(banner.getByRole('button', { name: 'Bookmarks', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(scenario, 'none after a reload in View').toHaveCount(0);
  });
});

// ---------------------------------------------------------------- a page without withM0's app start

type GuardedPage = Page & { readonly __errors: string[]; readonly __blocked: string[] };

/** A page on a server of the test's own, offline-guarded, recording console errors, without openApp (which needs draw-symbols). */
async function guardedPage(browser: Browser, server: OwnServer): Promise<GuardedPage> {
  const context = await browser.newContext({ baseURL: server.baseUrl, serviceWorkers: 'block' });
  const blocked = await installOfflineGuard(context, server.baseUrl);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console.error: ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return Object.assign(page, { __errors: errors, __blocked: blocked });
}

async function closeGuarded(page: GuardedPage): Promise<void> {
  await page.context().close();
  expect(page.__blocked, 'requests to anything but the emc2 server (ADR-0014)').toEqual([]);
  expect(page.__errors, 'browser console errors').toEqual([]);
}
