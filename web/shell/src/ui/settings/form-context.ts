import { createContext } from 'react';
import type { KnownLayers } from '../../layers/known.ts';
import type { LayerCreator } from '../../layers/creator.ts';
import type { CredentialNames } from './credentials.ts';

export interface FormContextValue {
  /** Prefix of the form's DOM ids. */
  readonly idPrefix: string;
  /** The server's problems at exactly this JSON Pointer. */
  readonly problemsAt: (pointer: string) => readonly string[];
  /** SDK 1.5.0 part 4: the server's problems at or below this JSON Pointer, with where each is. */
  readonly problemsUnder: (pointer: string) => readonly { readonly path: string; readonly problem: string }[];
  /**
   * T-161: whether something at or below this JSON Pointer needs the user: a problem from the
   * server, or an input that cannot be read. A collapsed list entry opens for it.
   */
  readonly needsAttention: (pointer: string) => boolean;
  /**
   * An input reports whether it holds what it cannot read (text that is not JSON or not a number, a
   * required value left empty); then the form cannot be saved.
   */
  readonly setInvalid: (pointer: string, invalid: boolean) => void;
  /** The layers the layer pickers offer (SDK 1.2.0); null where the form has none (the picker then says so). */
  readonly layers: KnownLayers | null;
  /** SDK 1.4.0 (T-133): what the pickers' "+" creates a layer with; null where the form has none (no "+"). */
  readonly creator: LayerCreator | null;
  /** ADR-0062 (M9 C3): the TLS credentials' names a `tls-credential` field offers; null where the form has none (a text field then). */
  readonly credentials: CredentialNames | null;
}

export const FormContext = createContext<FormContextValue>({
  idPrefix: 'settings', problemsAt: () => [], problemsUnder: () => [], needsAttention: () => false, setInvalid: () => undefined, layers: null, creator: null, credentials: null,
});

/** The DOM id of the input at `pointer`. */
export function inputId(prefix: string, pointer: string): string {
  return `${prefix}-${Array.from(pointer, (c) => (/[A-Za-z0-9]/.test(c) ? c : `_${c.charCodeAt(0).toString(16)}`)).join('')}`;
}
