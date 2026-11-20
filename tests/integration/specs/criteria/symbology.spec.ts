// Quick run: @plugin-symbology
import { expect, test, type Page, type Request } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withM0 } from '../../lib/m0';
import { root } from '../../lib/server.mjs';

// symbology's acceptance criteria 1, 5 and 6 in a real browser (docs/plugins/briefs/symbology.md),
// the parts its unit tests leave to the ITA (docs/handover/pca-symbology.md): real pixels, the
// render time with rasterization, and no network request. The real SymbolService is reached
// through the ITA's test probe plugin (window.__itaProbe).

test.describe.configure({ timeout: 120_000 });

type Symbol = { standard: string; sidc: string; modifiers?: Record<string, unknown> };

/** The symbols of the valid core.symbol examples in model/examples/valid/ (criterion 1). */
function exampleSymbols(): Array<{ file: string; symbol: Symbol }> {
  const folder = join(root, 'model', 'examples', 'valid');
  return readdirSync(folder)
    .filter((f) => f.startsWith('object-'))
    .map((file) => ({ file, object: JSON.parse(readFileSync(join(folder, file), 'utf8')) }))
    .filter(({ object }) => object.type === 'core.symbol')
    .map(({ file, object }) => ({ file, symbol: object.symbol as Symbol }));
}

async function probe(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __itaProbe?: unknown }).__itaProbe !== undefined);
}

/** Renders in the page and counts the image's opaque pixels on a real canvas. */
async function renderPixels(page: Page, symbol: Symbol, withText: boolean) {
  return page.evaluate(
    ({ symbol, withText }) => {
      const service = (window as any).__itaProbe.symbols;
      const image = service.render({ ...symbol, size: 40, withText });
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image.image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
      return { width: image.width, height: image.height, anchor: image.anchor as number[], opaque };
    },
    { symbol, withText },
  );
}

test('criterion 1: every valid core.symbol example renders real pixels with an anchor inside the image', async ({
  browser,
}, testInfo) => {
  const all = exampleSymbols();
  // The examples are the PDA's (model/examples/valid/); every standard must be among them.
  expect([...new Set(all.map((e) => e.symbol.standard))].sort()).toEqual(['APP-6B', 'APP-6D', 'APP-6E', 'vessel']);
  // The vessel standard (data model 1.4.0) is refused by symbology until T-139 draws vessels: bring it back then (MCA, 2026-11-06).
  const examples = all.filter((e) => e.symbol.standard !== 'vessel');
  await withM0(
    testInfo,
    browser,
    async ({ open }) => {
      const page = await open();
      await probe(page);
      for (const { file, symbol } of examples) {
        for (const withText of [false, true]) {
          const result = await renderPixels(page, symbol, withText);
          testInfo.annotations.push({ type: 'criterion 1', description: `${file} withText=${withText}: ${JSON.stringify(result)}` });
          expect(result.width, file).toBeGreaterThan(0);
          expect(result.height, file).toBeGreaterThan(0);
          expect(result.opaque, `${file}: opaque pixels`).toBeGreaterThan(200);
          const [x, y] = result.anchor;
          expect(x >= 0 && x <= result.width && y >= 0 && y <= result.height, `${file}: anchor ${x}, ${y} inside`).toBe(true);
        }
      }
      // An invalid SIDC still renders (milsymbol's invalid frame), never as nothing.
      const invalid = await renderPixels(page, { standard: 'APP-6D', sidc: '10039999999999999999' }, false);
      expect(invalid.opaque, 'an invalid SIDC renders as something').toBeGreaterThan(100);
    },
    { probe: true },
  );
});

test('criterion 5: 120 distinct symbols render in under 100 ms, and 100 000 cached lookups take under 50 ms', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ open }) => {
      const page = await open();
      await probe(page);
      // The protocol of the plugin's own unit test (render.test.ts "AC5"): milsymbol's code paths
      // are loaded once, then 120 distinct SIDCs render cold (a size nothing else uses), then
      // 100 000 lookups cycle through them. Each is run five times; the median counts.
      const runs = await page.evaluate(() => {
        const service = (window as any).__itaProbe.symbols;
        const catalog = service.catalog();
        const sidcs: string[] = [];
        for (let i = 0; sidcs.length < 120; i++) {
          const entity = catalog.entities[i % catalog.entities.length];
          const identity = catalog.standardIdentities[Math.floor(i / catalog.entities.length) % catalog.standardIdentities.length];
          sidcs.push(
            service.compose({
              standard: 'APP-6D',
              standardIdentity: identity.code,
              symbolSet: entity.symbolSet,
              status: '0',
              hqTaskForceDummy: '0',
              echelonMobility: '00',
              entity: entity.entity,
            }),
          );
        }
        service.render({ standard: 'APP-6D', sidc: '10061000001211000000', size: 31 });
        const cold: number[] = [];
        const cached: number[] = [];
        for (const size of [33, 34, 35, 36, 37]) {
          let t = performance.now();
          for (const sidc of sidcs) service.render({ standard: 'APP-6D', sidc, size });
          cold.push(performance.now() - t);
          t = performance.now();
          for (let i = 0; i < 100_000; i++) service.render({ standard: 'APP-6D', sidc: sidcs[i % 120], size });
          cached.push(performance.now() - t);
        }
        return { distinct: new Set(sidcs).size, cold, cached };
      });
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      testInfo.annotations.push({
        type: 'criterion 5',
        description: `120 cold renders: ${runs.cold.map((v) => v.toFixed(1)).join(', ')} ms; 100 000 cached lookups: ${runs.cached.map((v) => v.toFixed(1)).join(', ')} ms`,
      });
      expect(runs.distinct).toBe(120);
      expect(median(runs.cold), '120 distinct renders, median ms').toBeLessThan(100);
      expect(median(runs.cached), '100 000 cached lookups, median ms').toBeLessThan(50);
    },
    { probe: true },
  );
});

test('criterion 6: rendering and validating make no network request', async ({ browser }, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ open }) => {
      const page = await open();
      await probe(page);
      // Every request but the shell's own save of the remembered setup, which may fall in this
      // window: the shell saves it after a start without any user change (the default setup on a
      // first start; map-view-2d's share differs from the one read in its last digits).
      const requests: string[] = [];
      const isSetupSave = (request: Request) =>
        request.method() === 'PUT' && new URL(request.url()).pathname === '/api/user-documents/core/setup.current';
      page.on('request', (request) => {
        if (!isSetupSave(request)) requests.push(`${request.method()} ${request.url()}`);
      });
      const rendered = await page.evaluate((examples) => {
        const service = (window as any).__itaProbe.symbols;
        const catalog = service.catalog();
        let count = 0;
        for (const entity of catalog.entities) {
          for (const identity of catalog.standardIdentities) {
            const sidc = service.compose({
              standard: 'APP-6E',
              standardIdentity: identity.code,
              symbolSet: entity.symbolSet,
              status: '0',
              hqTaskForceDummy: '0',
              echelonMobility: '00',
              entity: entity.entity,
            });
            service.validate('APP-6E', sidc);
            service.render({ standard: 'APP-6E', sidc, size: 29, withText: true, modifiers: { uniqueDesignation: 'X' } });
            count++;
          }
        }
        for (const symbol of examples) {
          service.validate(symbol.standard, symbol.sidc);
          service.render({ ...symbol, size: 29, withText: true });
          count++;
        }
        return count;
      }, exampleSymbols().map((e) => e.symbol));
      // Let anything the rendering might have started reach the network listener.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      testInfo.annotations.push({ type: 'criterion 6', description: `${rendered} symbols rendered and validated, ${requests.length} requests` });
      expect(rendered).toBeGreaterThan(200);
      expect(requests, 'requests while rendering').toEqual([]);
    },
    { probe: true },
  );
});
