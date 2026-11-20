// SDK and data model 1.6.0 part G (CR-0041; T-156, the M7 plan's Q1 A): symbol palettes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_PALETTE_SYMBOLS, MAX_PALETTES_PER_PLUGIN, type PluginContext, type SymbolPalette } from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

const COT: SymbolPalette = {
  plugin: 'cot',
  id: 'cot.cot',
  name: 'CoT',
  symbols: [
    { standard: 'APP-6D', code: '10031000001211000000', label: 'G-U-C-I – Infantry' },
    { standard: 'APP-6B', code: 'SFGPUCI----D---' },
  ],
};

describe('SDK 1.6.0 part G: symbol palettes', () => {
  it('has the schema\'s limits', () => {
    const schema = JSON.parse(readFileSync(new URL('../../../model/schemas/plugin-manifest.schema.json', import.meta.url), 'utf8')) as {
      properties: { symbolPalettes: { maxItems: number } };
      $defs: { symbolPalette: { properties: { symbols: { maxItems: number } } }; paletteSymbol: { properties: { standard: { enum: string[] } } } };
    };
    expect(schema.properties.symbolPalettes.maxItems).toBe(MAX_PALETTES_PER_PLUGIN);
    expect(schema.$defs.symbolPalette.properties.symbols.maxItems).toBe(MAX_PALETTE_SYMBOLS);
    expect(schema.$defs.paletteSymbol.properties.standard.enum).toEqual(['APP-6B', 'APP-6D', 'APP-6E']);
  });

  it('the model example declares what the context gives, with the full id', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../model/examples/valid/manifest-symbol-palettes.json', import.meta.url), 'utf8')) as {
      id: string;
      symbolPalettes: { id: string; name: string; symbols: SymbolPalette['symbols'] }[];
    };
    const given: SymbolPalette[] = manifest.symbolPalettes.map((p) => ({ plugin: manifest.id, id: `${manifest.id}.${p.id}`, name: p.name, symbols: p.symbols }));
    expect(given[0]?.id).toBe('cot.cot');
    expect(given[0]?.symbols[0]?.label).toBe('G-U-C-I – Infantry');
  });

  it('the fake context gives the palettes, none by default, frozen', () => {
    const ctx: PluginContext = createFakeContext({ symbolPalettes: [COT] });
    expect(ctx.symbolPalettes).toEqual([COT]);
    expect(Object.isFrozen(ctx.symbolPalettes)).toBe(true);
    expect(createFakeContext().symbolPalettes).toEqual([]);
  });
});
