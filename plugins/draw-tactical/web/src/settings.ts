import type { JsonValue } from '@emc2/plugin-sdk';
import { isGraphicStandard } from './graphics.ts';
import type { GraphicStandard } from './graphics.ts';
import { IDENTITY_CODES, IDENTITY_NAMES } from './sidc.ts';
import type { IdentityName } from './sidc.ts';

export interface GraphicSettings {
  /** The standard of new graphics (and of the catalogue the panel offers). */
  readonly standard: GraphicStandard;
  /** The name of the standard identity new graphics start with, and its SIDC code. */
  readonly identityName: IdentityName;
  readonly standardIdentity: string;
}

/** The same defaults as in plugin.json (a test checks it). */
export const DEFAULT_SETTINGS: GraphicSettings = { standard: 'APP-6D', identityName: 'Friend', standardIdentity: IDENTITY_CODES.Friend };

function isIdentityName(value: unknown): value is IdentityName {
  return typeof value === 'string' && (IDENTITY_NAMES as readonly string[]).includes(value);
}

/** Reads the settings (the current values: the manifest defaults, or what a user configured). A bad value gives the default and a problem to report. */
export function readSettings(raw: { readonly [name: string]: JsonValue }): { readonly settings: GraphicSettings; readonly problems: readonly string[] } {
  const problems: string[] = [];
  let standard = DEFAULT_SETTINGS.standard;
  const wantedStandard = raw['standard'];
  if (isGraphicStandard(wantedStandard)) standard = wantedStandard;
  else if (wantedStandard !== undefined) problems.push(`setting "standard" must be APP-6D or APP-6E, using ${standard}`);

  let identityName = DEFAULT_SETTINGS.identityName;
  const wantedIdentity = raw['standardIdentity'];
  if (isIdentityName(wantedIdentity)) identityName = wantedIdentity;
  else if (wantedIdentity !== undefined) problems.push(`setting "standardIdentity" must be Friend, Hostile, Neutral or Unknown, using ${identityName}`);

  return { settings: { standard, identityName, standardIdentity: IDENTITY_CODES[identityName] }, problems };
}
