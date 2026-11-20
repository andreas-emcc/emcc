import { GENERAL_DATA_TYPE } from '@emc2/plugin-sdk';
import type { JsonValue } from '@emc2/plugin-sdk';

export interface DrawSettings {
  readonly standard: 'APP-6D' | 'APP-6E';
  readonly pickerSymbolSize: number;
  /** The data type of new symbols until the user chooses one in this browser (ADR-0023). */
  readonly dataType: string;
}

/** The same defaults as in plugin.json (a test checks it). */
export const DEFAULT_SETTINGS: DrawSettings = { standard: 'APP-6D', pickerSymbolSize: 40, dataType: GENERAL_DATA_TYPE };

export const MIN_PICKER_SIZE = 16;
export const MAX_PICKER_SIZE = 128;
export const MAX_DATA_TYPE_LENGTH = 128;

/** Reads the settings (the current values: the manifest defaults, or what a user configured). A bad value gives the default and a problem to report. */
export function readSettings(raw: { readonly [name: string]: JsonValue }): { readonly settings: DrawSettings; readonly problems: readonly string[] } {
  const problems: string[] = [];
  let standard = DEFAULT_SETTINGS.standard;
  const wantedStandard = raw['standard'];
  if (wantedStandard === 'APP-6D' || wantedStandard === 'APP-6E') standard = wantedStandard;
  else if (wantedStandard !== undefined) problems.push(`setting "standard" must be APP-6D or APP-6E, using ${standard}`);

  let pickerSymbolSize = DEFAULT_SETTINGS.pickerSymbolSize;
  const wantedSize = raw['pickerSymbolSize'];
  if (typeof wantedSize === 'number' && Number.isInteger(wantedSize) && wantedSize >= MIN_PICKER_SIZE && wantedSize <= MAX_PICKER_SIZE) {
    pickerSymbolSize = wantedSize;
  } else if (wantedSize !== undefined) {
    problems.push(`setting "pickerSymbolSize" must be a whole number from ${String(MIN_PICKER_SIZE)} to ${String(MAX_PICKER_SIZE)}, using ${String(pickerSymbolSize)}`);
  }

  let dataType = DEFAULT_SETTINGS.dataType;
  const wantedType = raw['dataType'];
  if (typeof wantedType === 'string' && wantedType.length > 0 && wantedType.length <= MAX_DATA_TYPE_LENGTH) dataType = wantedType;
  else if (wantedType !== undefined) problems.push(`setting "dataType" must be a data type id, using ${dataType}`);
  return { settings: { standard, pickerSymbolSize, dataType }, problems };
}
