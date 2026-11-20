/**
 * `ctx.userDocuments` (SDK 1.1.0, CR-0015 item 17; ADR-0027): the plugin's own documents of the
 * logged-in user, over `/api/user-documents/<namespace>/<name>` (`server/README.md`). The namespace
 * is the plugin's id; the shell's own are under `core`. The server decides the user from the login
 * session and checks the limits; a refusal comes back as a `UserDocumentError`.
 */
import { USER_DOCUMENT_NAME, UserDocumentError, type JsonValue, type UserDocumentProblem, type UserDocuments } from '@emc2/plugin-sdk';

const BASE = '/api/user-documents/';
/** Longer than the server's own 10 s for an answer from ECore (`504`). */
export const TIMEOUT_MS = 15_000;

/** The server's word for a refusal, from its status (`server/README.md`, "User documents"). */
function problemOf(status: number): UserDocumentProblem {
  switch (status) {
    case 400: return 'bad-name';
    case 409: return 'too-many';
    case 413: return 'too-large';
    case 507: return 'user-full';
    default: return 'unavailable'; // 401 (the login ended), 404 (an unknown namespace), 5xx
  }
}

async function refusal(response: Response): Promise<UserDocumentError> {
  let text = `the server answered ${String(response.status)}`;
  try {
    const body = (await response.json()) as { problem?: unknown };
    if (typeof body.problem === 'string') text = body.problem;
  } catch {
    // no JSON body: keep the status
  }
  return new UserDocumentError(problemOf(response.status), text);
}

/**
 * `keepalive`: the calls outlive the page (at most 64 KiB in all, the browser's limit), for the
 * shell's last save of the remembered setup when the page closes (`setups/setups.ts`).
 */
export function userDocumentsOf(namespace: string, doFetch: typeof fetch = (input, init) => fetch(input, init),
  options: { readonly keepalive?: boolean } = {}): UserDocuments {
  const call = async (method: string, path: string, body?: string): Promise<Response> => {
    try {
      return await doFetch(BASE + path, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body }),
        ...(options.keepalive === true ? { keepalive: true } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new UserDocumentError('unavailable', `no answer from the server: ${String(error)}`);
    }
  };
  /** The answer's JSON; an answer that is not JSON (e.g. a login page) counts as no answer. */
  const json = async (response: Response): Promise<unknown> => {
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new UserDocumentError('unavailable', `the server's answer is not JSON (${String(response.status)})`);
    }
  };
  /** A value as JSON text; one that has none is the plugin's mistake, not the server's. */
  const text = (value: JsonValue): string => {
    let written: unknown; // JSON.stringify gives undefined for undefined, functions and symbols
    try {
      written = JSON.stringify(value);
    } catch (error) {
      throw new TypeError(`a user document must be a JSON value: ${String(error)}`, { cause: error });
    }
    if (typeof written !== 'string') throw new TypeError(`a user document must be a JSON value, not ${typeof value}`);
    return written;
  };
  const named = (name: string): string => {
    if (typeof name !== 'string' || !USER_DOCUMENT_NAME.test(name)) throw new UserDocumentError('bad-name', `not a document name: ${JSON.stringify(name)}`);
    return `${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  };
  return {
    async get(name) {
      const response = await call('GET', named(name));
      if (response.status === 404) {
        const error = await refusal(response);
        if (error.message === 'no such document') return null;
        throw error; // an unknown namespace: unavailable
      }
      if (!response.ok) throw await refusal(response);
      return (await json(response)) as JsonValue;
    },
    async put(name, value) {
      const response = await call('PUT', named(name), text(value));
      if (!response.ok) throw await refusal(response);
    },
    async delete(name) {
      const response = await call('DELETE', named(name));
      if (!response.ok) throw await refusal(response);
    },
    async list() {
      const response = await call('GET', encodeURIComponent(namespace));
      if (!response.ok) throw await refusal(response);
      const body = (await json(response)) as { names?: unknown } | null;
      return Array.isArray(body?.names) ? body.names.filter((n): n is string => typeof n === 'string') : [];
    },
  };
}
