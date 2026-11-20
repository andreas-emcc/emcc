/**
 * The shell's batches of change requests: the shared Delete (ADR-0032) and the Layers entry's raise
 * (ADR-0031 point 3). One change request per object (a change request carries one object) as
 * `core-shell`, with at most {@link MAX_WAITING} waiting at a time for all of them together (a
 * Delete and a raise running at once share it; review F3): the session may have 100 waiting
 * (`server/live-picture-protocol.md`), and the plugins keep the other half. A request
 * refused with `INTERNAL_ERROR` (the session's queue was full, or the store failed; both may be sent
 * again) is sent again {@link RETRIES} times, {@link RETRY_DELAY_MS} apart.
 */
import {
  OutcomeUnknownError, SHELL_SOURCE_PLUGIN, type ChangeOutcome, type ChangeRequestContent, type MapObject, type RejectionCode,
} from '@emc2/plugin-sdk';

/** The shell's change requests waiting for their outcome at most at a time, over all its batches. */
export const MAX_WAITING = 50;
/** A request refused with `INTERNAL_ERROR` is sent again this often, after this long. */
export const RETRIES = 2;
export const RETRY_DELAY_MS = 1_000;
/** Failed objects named in a final notice; the rest are counted. */
export const NAMED_FAILURES = 5;

export interface Submitter {
  submit(content: ChangeRequestContent, pluginId: string): Promise<ChangeOutcome>;
}

/** What became of one request: applied, or why not (`code` null when no answer came). */
export type Sent = { readonly ok: true } | { readonly ok: false; readonly code: RejectionCode | null; readonly reason: string };

/** One object that could not be changed, for the final notice. */
export interface Failure {
  readonly name: string;
  readonly reason: string;
}

export const count = (n: number): string => n.toLocaleString('en-GB');
export const objects = (n: number): string => `${count(n)} ${n === 1 ? 'object' : 'objects'}`;
export const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** An object's name for a notice: its name, else its id. */
export const nameOf = (object: MapObject): string => object.properties?.name?.trim() || object.id;
const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Sends one change request as `core-shell`, again when refused with `INTERNAL_ERROR`.
 *
 * @param unknown what no answer may mean, e.g. "it may have been deleted"
 */
export async function send(connection: Submitter, content: ChangeRequestContent, unknown: string): Promise<Sent> {
  for (let attempt = 0; ; attempt++) {
    let outcome: ChangeOutcome;
    try {
      outcome = await connection.submit(content, SHELL_SOURCE_PLUGIN);
    } catch (error) {
      const reason = error instanceof OutcomeUnknownError ? `no answer from the server (${unknown}): ${error.message}` : describe(error);
      return { ok: false, code: null, reason };
    }
    if (outcome.outcome === 'applied') return { ok: true };
    const { code, message } = outcome.rejection;
    if (code === 'INTERNAL_ERROR' && attempt < RETRIES) {
      await wait(RETRY_DELAY_MS);
      continue;
    }
    return { ok: false, code, reason: reasonFor(code, content, message) };
  }
}

/** A refusal in a few words: the permission, the layer lock (ADR-0042), otherwise the server's message. */
function reasonFor(code: RejectionCode, content: ChangeRequestContent, message: string): string {
  if (code === 'PERMISSION_DENIED') return 'you may not change it';
  if (code === 'LAYER_LOCKED') return content.entityType === 'layer' ? 'it is locked' : 'its layer is locked';
  return message;
}

/** Places for running tasks, at most {@link MAX_WAITING} at a time; the others wait their turn in order. */
class Places {
  private taken = 0;
  private readonly queue: (() => void)[] = [];

  async run(task: () => Promise<void>): Promise<void> {
    if (this.taken < MAX_WAITING) this.taken++;
    else await new Promise<void>((resolve) => { this.queue.push(resolve); });
    try {
      await task();
    } finally {
      const next = this.queue.shift();
      if (next === undefined) this.taken--;
      else next(); // the place goes to the next task
    }
  }
}

/** One set of places for the whole page: every batch of the shell shares it. */
const places = new Places();

/** Runs `each` for every item, in order, at most {@link MAX_WAITING} at a time over all the shell's batches. */
export async function inBatches<T>(items: readonly T[], each: (item: T) => Promise<void>): Promise<void> {
  await Promise.all(items.map((item) => places.run(() => each(item))));
}

/** "Alpha: reason; Bravo: reason; and 3 more": the first {@link NAMED_FAILURES} by name. */
export function failureList(failed: readonly Failure[]): string {
  const named = failed.slice(0, NAMED_FAILURES).map((f) => `${f.name}: ${f.reason}`).join('; ');
  return failed.length > NAMED_FAILURES ? `${named}; and ${count(failed.length - NAMED_FAILURES)} more` : named;
}
