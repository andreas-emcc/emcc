// The user's units (brief function 8; from M4 BV and A67): kept in this browser per user, in
// localStorage, not in the setup; a user who has not chosen gets km/h and metres. Storage that
// cannot be read or written (a private window, blocked site data) leaves the units as they are.
import type { PluginContext } from '@emc2/plugin-sdk';
import { Model } from './model.ts';
import { DEFAULT_UNITS, readUnits, unitsShare } from './units.ts';
import type { Units } from './units.ts';

/** The localStorage key for a user's units. */
export function unitsKey(userId: string): string {
  return `emc2.simulator.units.${userId}`;
}

export class UnitsModel extends Model<Units> {
  private readonly key: string;

  constructor(ctx: PluginContext) {
    super(DEFAULT_UNITS);
    this.key = unitsKey(ctx.user.id);
    try {
      const text = globalThis.localStorage.getItem(this.key);
      const units = text === null ? null : readUnits(JSON.parse(text) as never);
      if (units !== null) this.update(units);
    } catch {
      // Unreadable: the defaults.
    }
  }

  set(units: Partial<Units>): void {
    this.update(units);
    try {
      globalThis.localStorage.setItem(this.key, JSON.stringify(unitsShare(this.getState())));
    } catch {
      // Not kept: the choice holds until the page is reloaded.
    }
  }
}
