/**
 * Unsaved edits in the settings views, kept while the page lives so that switching tabs loses
 * nothing (T-039 part 2, owner 2026-10-13). Each draft remembers the values it started from, so a
 * view can tell when someone else saved in the meantime. A draft equal to its start is no draft.
 */
import type { Unsubscribe } from '@emc2/plugin-sdk';
import { changedValues, sameJson, type Json } from './schema.ts';

export interface Draft {
  /** The saved values the edits started from. */
  readonly base: Json;
  readonly value: Json;
}

export class Drafts {
  private readonly drafts = new Map<string, Draft>();
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get(key: string): Draft | undefined {
    return this.drafts.get(key);
  }

  /** T-203 part C: how many values the draft under `key` changes (0 without one). */
  count(key: string): number {
    const draft = this.drafts.get(key);
    return draft === undefined ? 0 : changedValues(draft.base, draft.value);
  }

  /** True while any view has unsaved edits. */
  any(): boolean {
    return this.drafts.size > 0;
  }

  /** The keys of the unsaved edits, for marks such as the Settings list's. A new array after every change, the same until then. */
  keys(): readonly string[] {
    return this.keyList;
  }

  edit(key: string, base: Json, value: Json): void {
    if (sameJson(base, value)) {
      this.drop(key);
      return;
    }
    this.drafts.set(key, { base, value });
    this.changed();
  }

  drop(key: string): void {
    if (this.drafts.delete(key)) this.changed();
  }

  /** Drops the drafts whose view is gone (e.g. a plugin's tab), so they no longer hold the page. */
  retain(keep: (key: string) => boolean): void {
    let dropped = false;
    for (const key of [...this.drafts.keys()]) {
      if (!keep(key)) dropped = this.drafts.delete(key) || dropped;
    }
    if (dropped) this.changed();
  }

  private keyList: readonly string[] = [];

  private changed(): void {
    this.keyList = [...this.drafts.keys()];
    for (const listener of [...this.listeners]) listener();
  }
}
