import type { Settings } from '@emc2/plugin-sdk';
import { DEFAULT_MAX_ITEMS } from './tree.ts';

/** The `maxItems` setting, validated where it is read (design pattern section 7). `problem` is set when the value was bad and the default is used. */
export function readMaxItems(settings: Settings): { readonly value: number; readonly problem: string | null } {
  const value = settings['maxItems'];
  if (value === undefined) return { value: DEFAULT_MAX_ITEMS, problem: null };
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return { value, problem: null };
  return { value: DEFAULT_MAX_ITEMS, problem: `Setting maxItems is not a whole number of at least 1; using ${String(DEFAULT_MAX_ITEMS)}` };
}
