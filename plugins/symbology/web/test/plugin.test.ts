import { describe, expect, it } from 'vitest';
import { PLUGIN_ICONS, settingsHintsProblem, SYMBOLS, type JsonValue } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeUser } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.ts';
// For its side effect: jsdom has no canvas, so this gives every canvas a recording 2D context.
import { callsOn } from './canvas.ts';

/** The settings as the shell passes them when nothing is configured: the default of every setting. */
function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

async function activated(settings: Record<string, JsonValue> = settingDefaults()) {
  const ctx = createFakeContext({ pluginId: manifest.id, settings, provides: manifest.provides });
  await plugin.activate(ctx);
  return ctx;
}

describe('symbology web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('provides the SymbolService under emc2.symbols and reports OK', async () => {
    const ctx = await activated();
    expect(manifest.provides).toEqual([SYMBOLS.id]);
    const symbols = await ctx.services.get(SYMBOLS);
    expect(symbols.validate('APP-6D', '10031000001211000000')).toEqual({ valid: true });
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it("draws a vessel's gap in the look's ground colour, and the new one after a change of look (owner, LS)", async () => {
    const ctx = await activated();
    const symbols = await ctx.services.get(SYMBOLS);
    const gap = () => {
      const image = symbols.render({ standard: 'vessel', sidc: '0470', size: 30 }).image;
      return image instanceof HTMLCanvasElement ? callsOn(image).filter((c) => c.name === 'stroke')[1]?.strokeStyle : undefined;
    };
    expect(gap()).toBe(ctx.theme.tokens().colorGround);
    ctx.changeTheme({ look: 'chart-room', scheme: 'light' }, { colorGround: '#f4f1ea' });
    expect(gap()).toBe('#f4f1ea');
  });

  it('declares the one key it provides, and none it gets (design pattern v1, section 3)', () => {
    expect(manifest.provides).toEqual(['emc2.symbols']);
    expect(manifest).not.toHaveProperty('requires');
    expect(manifest).not.toHaveProperty('uses');
    expect(manifest.sdkVersion).toBe('^1.8.0');
  });

  it('works the same for a user without permissions: it has no panels and checks none (design pattern v1, section 10)', async () => {
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults(), provides: manifest.provides, user: createFakeUser({ permissions: [] }) });
    await plugin.activate(ctx);
    const symbols = await ctx.services.get(SYMBOLS);
    expect(symbols.validate('APP-6D', '10031000001211000000')).toEqual({ valid: true });
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('adds no panels or overlays', async () => {
    const ctx = await activated();
    expect(ctx.panels).toEqual([]);
    expect(ctx.overlays).toEqual([]);
  });

  it.each([0, -5, 1.5, 'big', null])('reports DEGRADED for imageCacheSize %j and still provides the service', async (bad) => {
    const ctx = await activated({ imageCacheSize: bad });
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.statusHistory.at(-1)?.detail).toContain('imageCacheSize');
    expect(ctx.logs.some((l) => l.level === 'warn')).toBe(true);
    await expect(ctx.services.get(SYMBOLS)).resolves.toBeDefined();
  });

  it('reports DEGRADED when imageCacheSize is missing', async () => {
    const ctx = await activated({});
    expect(ctx.statusHistory.at(-1)?.detail).toBe('imageCacheSize missing is not a positive integer; using 2000');
  });

  it('has a cache size default of 2 000 entries (brief, settings)', () => {
    expect(manifest.settings.properties.imageCacheSize.default).toBe(2000);
  });

  describe('T-204: the settings form and the icon (SDK 1.8.0 parts C and D)', () => {
    it("declares SDK ^1.8.0 and the icon Hexagon, one of the SDK's icons", () => {
      expect(manifest.sdkVersion).toBe('^1.8.0');
      expect(manifest.icon).toBe('Hexagon');
      expect(PLUGIN_ICONS).toHaveProperty('Hexagon');
    });

    it("has hints settingsHintsProblem finds nothing wrong with: groups, short hints and units", () => {
      expect(settingsHintsProblem(manifest.settings)).toBeNull();
      const { properties } = manifest.settings;
      const annotation = (p: object) => (p as { 'x-emc2'?: { hint?: string; unit?: string } })['x-emc2'];
      for (const [name, property] of Object.entries(properties)) {
        // A description longer than 80 characters needs a hint to show under the field.
        if (property.description.length > 80) expect(annotation(property)?.hint, name).toBeDefined();
        expect((annotation(property)?.hint ?? '').length, name).toBeLessThanOrEqual(80);
      }
      expect(Object.fromEntries(Object.entries(properties).map(([name, p]) => [name, annotation(p)?.unit]))).toEqual({
        imageCacheSize: 'images', graphicTimeoutSeconds: 's', sensorReportShape: undefined, sensorReportColor: undefined, sensorReportSize: 'px',
      });
    });

    it('groups every setting: the sensor reports first, the cache and the timeout folded as advanced', () => {
      expect(manifest.settings['x-emc2'].groups).toEqual([
        { id: 'sensorReports', label: 'Sensor reports', description: expect.any(String) as unknown, properties: ['sensorReportShape', 'sensorReportColor', 'sensorReportSize'] },
        { id: 'advanced', label: 'Advanced', description: expect.any(String) as unknown, properties: ['imageCacheSize', 'graphicTimeoutSeconds'], advanced: true },
      ]);
      expect(manifest.settings['x-emc2'].groups.flatMap((g) => g.properties).sort()).toEqual(Object.keys(manifest.settings.properties).sort());
    });
  });

  it('has a closed settings schema, so the server refuses a missing or unknown setting', () => {
    expect(manifest.settings.required).toEqual(Object.keys(manifest.settings.properties));
    expect(manifest.settings.additionalProperties).toBe(false);
    expect(manifest.settings.properties.imageCacheSize).toMatchObject({ type: 'integer', minimum: 1 });
  });

  describe('graphicTimeoutSeconds (M5, brief Settings)', () => {
    it('is a whole number of seconds from 1 to 30, default 5', () => {
      expect(manifest.settings.properties.graphicTimeoutSeconds).toMatchObject({ type: 'integer', minimum: 1, maximum: 30, default: 5 });
    });

    it.each([0, 31, 2.5, 'slow', null])('reports DEGRADED for %j and keeps the current timeout', async (bad) => {
      const ctx = await activated({ ...settingDefaults(), graphicTimeoutSeconds: bad });
      expect(ctx.statusHistory.at(-1)).toEqual({ state: 'DEGRADED', detail: `graphicTimeoutSeconds ${JSON.stringify(bad)} is not a whole number from 1 to 30; using 5` });
    });

    it('applies a new timeout at once and reports OK again', async () => {
      const ctx = await activated({ ...settingDefaults(), graphicTimeoutSeconds: 0 });
      ctx.changeSettings({ ...settingDefaults(), graphicTimeoutSeconds: 12 });
      expect(ctx.statusHistory.at(-1)?.state).toBe('OK');
      expect(ctx.logs.some((l) => l.message === 'graphic draw timeout is now 12 s')).toBe(true);
    });

    it('provides graphicCatalog and renderGraphic, and starts no worker at activation (criterion 14)', async () => {
      const ctx = await activated();
      const symbols = await ctx.services.get(SYMBOLS);
      expect(typeof symbols.graphicCatalog).toBe('function');
      expect(typeof symbols.renderGraphic).toBe('function');
      // jsdom has no Worker: had activation started one, it would have thrown.
      expect(ctx.statusHistory.at(-1)?.state).toBe('OK');
    });
  });

  describe('settings changed at runtime (SDK v1)', () => {
    const INFANTRY = { standard: 'APP-6D', sidc: '10031000001211000000', size: 30 } as const;
    const ARMOUR = { standard: 'APP-6D', sidc: '10031000001205000000', size: 30 } as const;

    it('applies a smaller imageCacheSize at once: the least recently used images are dropped', async () => {
      const ctx = await activated();
      const symbols = await ctx.services.get(SYMBOLS);
      const infantry = symbols.render(INFANTRY);
      const armour = symbols.render(ARMOUR);
      expect(symbols.render(INFANTRY)).toBe(infantry); // 2 000 entries: both stay
      ctx.changeSettings({ imageCacheSize: 1 }); // keeps only the most recent: infantry
      expect(symbols.render(INFANTRY)).toBe(infantry);
      expect(symbols.render(ARMOUR)).not.toBe(armour);
      expect(symbols.render(INFANTRY)).not.toBe(infantry); // one entry: armour pushed it out
      expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
      expect(ctx.logs.some((l) => l.level === 'info' && l.message.includes('image cache size is now 1'))).toBe(true);
    });

    it('applies a larger imageCacheSize', async () => {
      const ctx = await activated({ imageCacheSize: 1 });
      const symbols = await ctx.services.get(SYMBOLS);
      ctx.changeSettings({ imageCacheSize: 5 });
      const infantry = symbols.render(INFANTRY);
      symbols.render(ARMOUR);
      expect(symbols.render(INFANTRY)).toBe(infantry);
    });

    it('keeps the current size and reports DEGRADED for a bad value, and OK again for a good one', async () => {
      const ctx = await activated({ imageCacheSize: 3 });
      ctx.changeSettings({ imageCacheSize: 0 });
      expect(ctx.statusHistory.at(-1)).toEqual({ state: 'DEGRADED', detail: 'imageCacheSize 0 is not a positive integer; using 3' });
      const symbols = await ctx.services.get(SYMBOLS);
      const infantry = symbols.render(INFANTRY);
      symbols.render(ARMOUR);
      expect(symbols.render(INFANTRY)).toBe(infantry); // still 3 entries
      ctx.changeSettings({ imageCacheSize: 2000 });
      expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
    });

    it('keeps the same service object, so users of emc2.symbols need not get it again', async () => {
      const ctx = await activated();
      const before = await ctx.services.get(SYMBOLS);
      ctx.changeSettings({ imageCacheSize: 10 });
      expect(await ctx.services.get(SYMBOLS)).toBe(before);
    });
  });
});
