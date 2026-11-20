// Installs the assembled plugins (build/plugins/, from tools/build.mjs) into a run's own plugin
// folder, so that every run and every test server has a fresh copy.
//
// basemap-osm: a run starts with the manifest's default settings, so the installed copy's manifest
// is changed to fetch tiles from the test's fake tile server instead of OpenStreetMap
// (settings.properties.upstreamUrl.default). Its internet declaration stays as it is: since
// T-058 (ADR-0030) it is a declaration shown in the monitor, not a limit ECore enforces. The
// plugin's own files in plugins/ and build/plugins/ are never touched.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './server.mjs';

export const assembled = join(root, 'build', 'plugins');
/** Test-only plugins of the ITA (never assembled, never installed outside the tests). */
export const fixtures = join(root, 'tests', 'integration', 'fixtures', 'plugins');

/** Installs a test-only plugin from tests/integration/fixtures/plugins/. */
export function installFixture(pluginsDir, id) {
  cpSync(join(fixtures, id), join(pluginsDir, id), { recursive: true });
}

/** The ids of the assembled plugins, or [] if tools/build.mjs has not assembled any. */
export function assembledPlugins() {
  return existsSync(assembled) ? readdirSync(assembled, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
}

/**
 * Copies the assembled plugins (all, or the given ids) into `pluginsDir`. `tileTemplate`, when
 * given, is the URL template basemap-osm uses instead of OpenStreetMap. Without it basemap-osm is
 * left out, so that nothing can reach the internet.
 */
export function installPlugins(pluginsDir, { only, tileTemplate } = {}) {
  const ids = assembledPlugins().filter((id) => !only || only.includes(id));
  const installed = [];
  for (const id of ids) {
    if (id === 'basemap-osm' && !tileTemplate) continue;
    cpSync(join(assembled, id), join(pluginsDir, id), { recursive: true });
    if (id === 'basemap-osm') pointAtFakeTiles(join(pluginsDir, id, 'plugin.json'), tileTemplate);
    installed.push(id);
  }
  return installed;
}

function pointAtFakeTiles(manifestFile, tileTemplate) {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.settings.properties.upstreamUrl.default = tileTemplate;
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
}
