// The UXA's screenshots of a running emcc: View, Settings and the Monitor in every look, light and
// dark, compact and comfortable (agents/uxa.md rule 7).
//
//   node shots.mjs [base-url] [out-folder]
//
// base-url defaults to http://127.0.0.1:18104 (the UXA's port), out-folder to <temp>/emcc-ux-shots.
// The screenshots are not committed. It needs an emcc started without login; it changes nothing on
// the server: the look is set on the page, as the shell's theme sets it.
//
// It also measures what the looks must keep (looks.md): the top bar's and a panel head's height
// against the density's token. A difference is listed at the end and the exit code is 1.
// It uses Playwright's Chromium (the browser that the integration tests install).

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:18104';
const OUT = process.argv[3] ?? path.join(os.tmpdir(), 'emcc-ux-shots');
const LOOKS = ['night-watch', 'chart-room', 'signal'];
const SCHEMES = ['dark', 'light'];
const DENSITIES = ['compact', 'comfortable'];
const VIEWS = [['view', '#'], ['simulation', '#simulation'], ['settings', '#settings/general'], ['settings-map', '#settings/plugin/map-view-2d'], ['settings-list', '#settings/plugin/ais'], ['settings-data-types', '#settings/data-types'], ['monitor', '#monitor']];
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE + '/');
await page.locator('.top-bar').waitFor();
await page.waitForTimeout(1500);
// The GPU notice covers the map on a computer without one.
const dismiss = page.getByRole('button', { name: 'Dismiss' });
if (await dismiss.isVisible().catch(() => false)) await dismiss.click();

for (const [view, hash] of VIEWS) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(800);
  for (const look of LOOKS) {
    for (const scheme of SCHEMES) {
      for (const density of DENSITIES) {
        const sizes = await page.evaluate(([l, s, d]) => {
          const root = document.documentElement;
          Object.assign(root.dataset, { look: l, scheme: s, density: d });
          const px = (n) => Number.parseFloat(getComputedStyle(root).getPropertyValue(n));
          const h = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().height : null; };
          return { bar: h('.top-bar'), barToken: px('--shell-top-bar'), head: h('.panel-head'), headToken: px('--shell-panel-head') };
        }, [look, scheme, density]);
        await page.waitForTimeout(150);
        const name = `${view}-${look}-${scheme}-${density}`;
        await page.screenshot({ path: path.join(OUT, name + '.png') });
        if (sizes.bar !== sizes.barToken) failures.push(`${name}: top bar ${sizes.bar} px, looks.md ${sizes.barToken} px`);
        if (view === 'view' && sizes.head !== null && sizes.head !== sizes.headToken) failures.push(`${name}: panel head ${sizes.head} px, looks.md ${sizes.headToken} px`);
        console.log('  shot', name);
      }
    }
  }
}
await browser.close();

for (const e of errors) failures.push('page error: ' + e);
console.log(`\n${LOOKS.length * SCHEMES.length * DENSITIES.length * VIEWS.length} screenshots in ${OUT}`);
if (failures.length > 0) {
  console.log('\nDifferences:\n' + failures.map((f) => '- ' + f).join('\n'));
  process.exit(1);
}
console.log('Top bar and panel heads as looks.md says, in every look, scheme and density.');
