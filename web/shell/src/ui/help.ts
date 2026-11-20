import type { MenuItem } from '@emc2/plugin-sdk';
import type { Health, ReleaseVersion } from '../ServerStatus.tsx';

/** Where the server serves the release's user manual (server/app ManualConfiguration). */
export const MANUAL_PATH = '/manual/';

/**
 * The version line of the help menu (M9 RC2, owner ACQ): `emcc M9-RC1 · 2026-11-18 · ea32e90f`, with
 * ` · uncommitted changes` for a build from a changed tree; a developer run `emcc · dev build · SDK 1.9.0`.
 */
export function versionLine(version: ReleaseVersion | undefined): string {
  if (version === undefined) return 'emcc · version not known';
  if (version.name === 'dev') return ['emcc', 'dev build', ...(version.sdk === undefined ? [] : [`SDK ${version.sdk}`])].join(' · ');
  return [`emcc ${version.name}`, version.date, version.commit, version.dirty === true ? 'uncommitted changes' : undefined]
    .filter((part): part is string => part !== undefined && part !== '').join(' · ');
}

/**
 * The help menu's items, in groups (open to additions: M10 adds the licences of the linked libraries). "Manual" is
 * disabled, and says so, when the release has no manual.
 */
export function helpItems(health: Pick<Health, 'manual'>): MenuItem[] {
  return [
    health.manual === true
      ? { id: 'manual', label: 'Manual', group: 'docs' }
      : { id: 'manual', label: 'Manual not installed', group: 'docs', disabled: true },
  ];
}
