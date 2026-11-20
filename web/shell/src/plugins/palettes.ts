/**
 * SDK 1.6.0 (CR-0041 part G; T-156): `ctx.symbolPalettes`, every enabled plugin's palettes from its
 * manifest's `symbolPalettes` (`GET /api/plugins`), server-only plugins included, with the plugin
 * and the full id `<plugin-id>.<id>`, in the plugin list's order and each plugin's own. ECore has
 * refused a manifest whose palette ids repeat, and the schema has checked each palette.
 */
import type { SymbolPalette } from '@emc2/plugin-sdk';
import { deepFreeze } from '../live/picture.ts';
import type { PluginEntry } from './plan.ts';

export function symbolPalettesOf(entries: readonly PluginEntry[]): readonly SymbolPalette[] {
  return deepFreeze(entries.filter((e) => e.active).flatMap((e) => (e.symbolPalettes ?? []).map((p): SymbolPalette => ({
    plugin: e.id, id: `${e.id}.${p.id}`, name: p.name, symbols: structuredClone(p.symbols),
  }))));
}
