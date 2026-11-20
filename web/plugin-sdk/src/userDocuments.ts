/**
 * The current user's own documents (ADR-0027, CR-0015 item 17), for a plugin's web part: JSON
 * documents in the plugin's own namespace, for the logged-in user only (in the no-login mode, the
 * local user). They follow the user to any browser. They are not shared, carry no security label
 * and must not hold copies of objects. The last write wins.
 *
 * @example
 * const tree = (await ctx.userDocuments.get('tree')) ?? { folders: [] };
 * await ctx.userDocuments.put('tree', updated);
 */
import type { JsonValue } from './model.ts';

/** ECore's limits (CDA, owner 2026-10-15). */
export const USER_DOCUMENT_LIMITS = {
  /** Per document, as JSON in UTF-8. */
  maxBytes: 256 * 1024,
  /** Per plugin namespace and user. */
  maxDocuments: 200,
  /** Per user, over all namespaces. */
  maxBytesPerUser: 4 * 1024 * 1024,
} as const;

/** A document's name: as the plugin documents' keys, lowercase letters, digits, `.` and `-`, starting with a letter or digit, at most 128 characters. */
export const USER_DOCUMENT_NAME = /^[a-z0-9][a-z0-9.-]{0,127}$/;

/** Why a write was refused. */
export type UserDocumentProblem = 'bad-name' | 'too-large' | 'too-many' | 'user-full' | 'unavailable';

/** Raised (as a rejected promise) when a read or write fails; `problem` says why. `unavailable`: no answer (connection lost, timeout). */
export class UserDocumentError extends Error {
  readonly problem: UserDocumentProblem;

  constructor(problem: UserDocumentProblem, message: string) {
    super(message);
    this.name = 'UserDocumentError';
    this.problem = problem;
  }
}

export interface UserDocuments {
  /** The document, or null if there is none. */
  get(name: string): Promise<JsonValue | null>;
  /** Writes the whole document (any JSON value). Rejects with {@link UserDocumentError} over a limit or for a bad name. */
  put(name: string, value: JsonValue): Promise<void>;
  /** Deletes it; deleting one that does not exist succeeds. */
  delete(name: string): Promise<void>;
  /** The names of the plugin's documents for this user, sorted. */
  list(): Promise<readonly string[]>;
}
