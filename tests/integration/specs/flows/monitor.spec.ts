// Quick run: @settings @plugin-basemap-osm @plugin-adsb @plugin-ais
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../../fixtures';
import { assembled } from '../../lib/plugins.mjs';

// The monitor's internet declarations (T-058, ADR-0030): a plugin's manifest may declare that its
// server part reaches outside hosts; ECore does not limit it to them, and the monitor shows the
// declaration in its ninth column, "Internet". On the run's shared server (no-login mode: the local
// user has settings.admin). The plugins that declare one are those whose assembled manifests say
// so: basemap-osm with its default host, and adsb and ais with none (an admin names their links'
// hosts; their briefs).

type Internet = { hosts: string[]; reason: string };
type MonitorPlugin = { id: string; name: string; internet: Internet | null };

/** A plugin's internet declaration in its assembled manifest (build/plugins), or null. */
function declared(id: string): Internet | null {
  const manifest = join(assembled, id, 'plugin.json');
  return existsSync(manifest) ? ((JSON.parse(readFileSync(manifest, 'utf8')) as { internet?: Internet }).internet ?? null) : null;
}

test('GET /api/monitor gives each plugin the internet declaration of its manifest: basemap-osm its default host, a plugin that declares none none', async ({ request }) => {
  const response = await request.get('/api/monitor');
  expect(response.status()).toBe(200);
  const plugins = (await response.json()).plugins as MonitorPlugin[];
  const osm = plugins.find((p) => p.id === 'basemap-osm');
  expect(osm?.internet, 'basemap-osm declares OpenStreetMap').toMatchObject({ hosts: ['tile.openstreetmap.org'] });
  expect(osm!.internet!.reason.length, 'with a reason').toBeGreaterThan(0);
  for (const plugin of plugins) {
    const own = declared(plugin.id);
    expect(plugin.internet, `${plugin.id}: as its manifest declares`).toEqual(own === null ? null : { hosts: own.hosts, reason: own.reason });
  }
  expect(plugins.filter((p) => declared(p.id) === null).length, 'plugins that declare no internet').toBeGreaterThan(0);
});

test('the monitor\'s plugin table has the column "Internet": "declared" for each plugin whose manifest declares it (basemap-osm with its reason and hosts in the details), "–" for the others', async ({ page, request }, testInfo) => {
  const plugins = (await (await request.get('/api/monitor')).json()).plugins as MonitorPlugin[];
  await page.goto('/#monitor');
  const table = page.getByRole('table', { name: 'Plugins' });
  await expect(table.getByRole('columnheader'), 'nine columns, Internet the last').toHaveText(['Plugin', 'Server', 'Web part here', 'Workers', 'Messages/s', 'Queued', 'Refused', 'Connections', 'Internet']);

  // By the plugin's button in the row header, not the whole header: a row that needs attention adds its mark ("Check",
  // "Problem") to the header's name (MonitorView's Mark).
  const row = (name: string) => table.getByRole('row').filter({ has: page.getByRole('rowheader').getByRole('button', { name, exact: true }) });
  for (const plugin of plugins) {
    await expect(row(plugin.name).getByRole('cell').last(), plugin.id).toHaveText(declared(plugin.id) === null ? '–' : 'declared');
  }
  // Which rows carry a mark, for the report (a mark is the plugin's own state here, not this test's).
  const marked = await table.getByRole('rowheader').filter({ has: page.locator('.attention-mark') }).allInnerTexts();
  await testInfo.attach('monitor.json', { body: JSON.stringify(plugins, null, 2), contentType: 'application/json' });
  testInfo.annotations.push({ type: 'rows with an attention mark', description: marked.map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ') || 'none' });
  await expect(row('Coordinates').getByRole('cell').last(), 'coordinates declares none').toHaveText('–');

  const osm = row('OpenStreetMap background');
  await osm.getByRole('button', { name: 'OpenStreetMap background' }).click();
  await expect(table).toContainText(/Reaches outside hosts: .+ With its default settings: tile\.openstreetmap\.org\. Its settings may name other hosts/);
});
