/**
 * ADR-0062 point 3 (M9 C3, CR-0048 point 1.3): the names of the server's TLS credentials, which a settings field of
 * kind `tls-credential` offers. Asked once per settings view, on the first such field; never a path or a password.
 */
import type { Answer } from './api.ts';

export type CredentialNamesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly names: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string };

export class CredentialNames {
  private answer: Promise<CredentialNamesState> | null = null;

  constructor(private readonly load: () => Promise<Answer<readonly string[]>>) {}

  /** The names, asked of the server the first time only. */
  names(): Promise<CredentialNamesState> {
    this.answer ??= this.load().then(
      (a): CredentialNamesState => (a.ok ? { kind: 'loaded', names: a.value } : { kind: 'failed', message: a.message }),
      (e: unknown): CredentialNamesState => ({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }),
    );
    return this.answer;
  }
}
