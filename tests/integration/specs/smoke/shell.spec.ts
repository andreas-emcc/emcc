// Quick run: @always
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../fixtures';

// Smoke: the web client loads without login, with no console errors (fixture) and no requests
// to other hosts (fixture). The shell (T-014) shows two status lines: "Server" and "Live picture".

test('the shell loads without login and shows its layout', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/');

  await expect(page).toHaveTitle('emcc'); // the product's name as users see it (T-134)
  await expect(page.getByRole('main', { name: 'Map Pane' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Control Pane' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Server' })).toHaveText('Server: UP (ECore RUNNING)');
  expect(failed, 'responses with an error status').toEqual([]);
});

test('the shell reloads cleanly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Server' })).toHaveText('Server: UP (ECore RUNNING)');
  await page.reload();
  await expect(page.getByRole('status', { name: 'Server' })).toHaveText('Server: UP (ECore RUNNING)');
});

test('the shell connects to the live picture', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

/**
 * What installed plugins are known to show, by plugin id: panels in a side pane, tabs in the bottom
 * pane, buttons over the map (M4: Layers and Objects in the bottom pane, T-108; Coordinates an icon
 * over the map, T-104). A plugin that is not listed here is still checked for loading without failure.
 */
const KNOWN: Record<string, (page: Page) => Locator[]> = {
  template: (page) => [page.getByRole('complementary').getByRole('region', { name: 'Template', exact: true })],
  'draw-symbols': (page) => ['Symbols', 'Symbol properties'].map((name) => page.getByRole('complementary').getByRole('region', { name, exact: true })),
  coordinates: (page) => [page.getByRole('main', { name: 'Map Pane' }).getByRole('button', { name: 'Coordinates', exact: true })],
  'layer-panel': (page) => [page.getByRole('complementary', { name: 'Bottom pane' }).getByRole('tab', { name: 'Layers', exact: true })],
  'object-list': (page) => [page.getByRole('complementary', { name: 'Bottom pane' }).getByRole('tab', { name: 'Objects', exact: true })],
};

/**
 * What a web part may report besides OK. Without a GPU, map-view-2d reports that it draws in
 * software (ADR-0017); that is the expected state on machines without a GPU, not a failure.
 */
const EXPECTED_WEB_STATE: Record<string, RegExp> = { 'map-view-2d': /web (OK|DEGRADED: drawn without a GPU)/ };

type PluginInfo = { id: string; name: string; active: boolean; web?: unknown };

test("every installed plugin's web part loads, and known panels are shown", async ({ page, request }) => {
  const plugins = ((await (await request.get('/api/plugins')).json()) as PluginInfo[]).filter(
    (p) => p.active && p.web != null, // a plugin without a web part (e.g. cot) has web: null
  );
  expect(plugins, "the run's plugin folder holds no installed plugin with a web part (node tools/build.mjs)").not.toEqual([]);

  await page.goto('/');
  await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
  const pane = page.getByRole('complementary', { name: 'Control Pane' });
  await pane.getByText(`Plugins (`).click();
  // The rows of the plugin list (a <details>, role group); a row is the plugin's when its name is
  // one element of exactly that text. A name such as "Objects" also occurs in other rows and in
  // other panels' lists, and one plugin's name may begin another's.
  const list = pane.getByRole('group').filter({ hasText: 'Plugins (' });
  for (const plugin of plugins) {
    const line = list.getByRole('listitem').filter({ has: page.getByText(plugin.name, { exact: true }) });
    await expect(line, plugin.id).toContainText(EXPECTED_WEB_STATE[plugin.id] ?? 'web OK');
    // Where the plugin puts it by default (ADR-0031).
    for (const shown of KNOWN[plugin.id]?.(page) ?? []) {
      await expect(shown, `${plugin.id} shows its panel, tab or button`).toBeVisible();
    }
  }
  await expect(page.getByRole('alert'), 'failed panels or a fatal shell error').toHaveCount(0);
});
