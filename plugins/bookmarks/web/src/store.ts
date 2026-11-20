// The tree in the user's own document (ADR-0027). There is no cache: every change reads the
// document again first, so that two browsers of one user lose as little as the rule "the last
// write wins" allows (brief function 5), and a document that cannot be read is never overwritten.
import { USER_DOCUMENT_LIMITS, UserDocumentError, type UserDocuments, type UserDocumentProblem } from '@emc2/plugin-sdk';
import { DOCUMENT_NAME, EMPTY_TREE, parseDocument, serialize, type Outcome, type Refusal, type Tree, type Unreadable } from './tree.ts';

export type LoadResult =
  /** The tree; an empty one when the user has no document yet. */
  | { readonly status: 'ok'; readonly tree: Tree }
  /** A document this plugin must not overwrite: damaged, or written by a newer version. Offer "start an empty tree" after confirmation. */
  | { readonly status: 'unreadable'; readonly reason: Unreadable }
  /** No answer from the server (connection lost, timeout). */
  | { readonly status: 'unavailable' };

export type UpdateResult =
  | { readonly status: 'saved'; readonly tree: Tree }
  /** The change itself was not allowed (a name, the limit, the depth); nothing was written. */
  | { readonly status: 'refused'; readonly reason: Refusal }
  | { readonly status: 'unreadable'; readonly reason: Unreadable }
  /** Nothing was written. `too-large`: over ECore's limit for the document; `user-full`: over the user's total; `unavailable`: no answer. */
  | { readonly status: 'failed'; readonly problem: UserDocumentProblem };

/** The size of the stored document in bytes, as ECore counts it (JSON in UTF-8). */
export function documentBytes(tree: Tree): number {
  return new TextEncoder().encode(JSON.stringify(serialize(tree))).length;
}

export class BookmarkStore {
  readonly #documents: UserDocuments;
  /** The changes of this browser run one after the other, so that two quick actions (Add, then Rename) cannot read the same document and lose one. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(documents: UserDocuments) {
    this.#documents = documents;
  }

  /**
   * Reads the newest tree. Never throws for a lost connection or a bad document: the result says which.
   * It lists the documents first and reads only one that exists, as the shell's setups do: a user without
   * bookmarks would otherwise make a request that answers 404, which the browser logs as an error.
   */
  async load(): Promise<LoadResult> {
    let stored;
    try {
      stored = (await this.#documents.list()).includes(DOCUMENT_NAME) ? await this.#documents.get(DOCUMENT_NAME) : null;
    } catch (error) {
      if (error instanceof UserDocumentError) return { status: 'unavailable' };
      throw error;
    }
    const parsed = parseDocument(stored);
    if (parsed.kind === 'empty') return { status: 'ok', tree: EMPTY_TREE };
    if (parsed.kind === 'tree') return { status: 'ok', tree: parsed.tree };
    return { status: 'unreadable', reason: parsed.reason };
  }

  /** Reads the newest tree, applies one change to it and writes the result. Writes nothing unless the change is allowed and the result fits. */
  update(change: (tree: Tree) => Outcome): Promise<UpdateResult> {
    return this.#inTurn(() => this.#update(change));
  }

  async #update(change: (tree: Tree) => Outcome): Promise<UpdateResult> {
    const loaded = await this.load();
    if (loaded.status === 'unreadable') return loaded;
    if (loaded.status === 'unavailable') return { status: 'failed', problem: 'unavailable' };
    const outcome = change(loaded.tree);
    if (!outcome.ok) return { status: 'refused', reason: outcome.reason };
    return this.#write(outcome.tree);
  }

  /** Replaces an unreadable document with an empty tree. Only after the user has confirmed (brief function 5, criterion 8). */
  startEmpty(): Promise<UpdateResult> {
    return this.#inTurn(() => this.#write(EMPTY_TREE));
  }

  #inTurn<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(task);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #write(tree: Tree): Promise<UpdateResult> {
    if (documentBytes(tree) > USER_DOCUMENT_LIMITS.maxBytes) return { status: 'failed', problem: 'too-large' };
    try {
      await this.#documents.put(DOCUMENT_NAME, serialize(tree));
    } catch (error) {
      if (error instanceof UserDocumentError) return { status: 'failed', problem: error.problem };
      throw error;
    }
    return { status: 'saved', tree };
  }
}
