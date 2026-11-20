import { GENERAL_DATA_TYPE } from '@emc2/plugin-sdk';
import type { JsonValue } from '@emc2/plugin-sdk';
import { readStyleSettings } from './style.ts';
import type { StyleChoice } from './style.ts';

export interface ShapeSettings {
  /** The data type of new shapes until the user chooses one in this browser (ADR-0023). */
  readonly dataType: string;
  /** The style new shapes start with. */
  readonly style: StyleChoice;
}

export const MAX_DATA_TYPE_LENGTH = 128;

/** Reads the settings (the current values: the manifest defaults, or what a user configured). A bad value gives the default and a problem to report. */
export function readSettings(raw: { readonly [name: string]: JsonValue }): { readonly settings: ShapeSettings; readonly problems: readonly string[] } {
  const { style, problems } = readStyleSettings(raw);
  const all = [...problems];
  let dataType = GENERAL_DATA_TYPE;
  const wantedType = raw['dataType'];
  if (typeof wantedType === 'string' && wantedType.length > 0 && wantedType.length <= MAX_DATA_TYPE_LENGTH) dataType = wantedType;
  else if (wantedType !== undefined) all.push(`setting "dataType" must be a data type id, using ${dataType}`);
  return { settings: { dataType, style }, problems: all };
}
