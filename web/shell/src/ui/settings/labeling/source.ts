/**
 * What Settings › Labeling learns from the shell (T-170): the labeling definitions and the label
 * form, once `GET /api/config` has arrived, and each live notice `labeling`.
 */
import type { Unsubscribe } from '@emc2/plugin-sdk';
import type { LabelingSource } from './LabelingEntry.tsx';
import type { LabelDefinitions, LabelFormat } from './model.ts';

export class LabelingState implements LabelingSource {
  private current: { readonly definitions: LabelDefinitions; readonly format: LabelFormat } | null = null;
  private readonly listeners = new Set<() => void>();

  readonly config = () => this.current;

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** The configuration has arrived. */
  configured(definitions: LabelDefinitions, format: LabelFormat): void {
    this.current = { definitions, format };
    this.changed();
  }

  /** The live notice `labeling`: someone saved the labels. */
  saved(): void {
    this.changed();
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
