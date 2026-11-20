// The web part's calls to its own server part (brief function 24; design pattern, web part): the
// GET endpoints for the state it shows, and the commands as POST endpoints with a JSON body
// (CR-0026). Only the emc2 server is reachable from the browser (ADR-0030), so every path is
// under `ctx.serverBase`, and no path or body names a host.

/** What a call gives: the answer's JSON, or why there is none and whether a retry may help (A33). */
export type Answer = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly status: number; readonly message: string; readonly retry: boolean };

/** Shown for a 405 until the CDA builds CR-0026's edge (A33). */
export const NOT_TAKEN = "The server does not take the simulator's commands yet";

/** Every call has a timeout (rule: every request/reply has one). ECore answers 504 after the endpoint's 5 s, so this only ends a call that never settles. */
export const CALL_TIMEOUT_MS = 10_000;

const NO_ANSWER = 'No answer in time; it may have been done';

export class SimulatorServer {
  /** `base` is `ctx.serverBase`, `/api/plugins/simulator/`. */
  constructor(private readonly base: string) {}

  get(path: string): Promise<Answer> {
    return this.call(path, { method: 'GET', cache: 'no-store' });
  }

  /** A command. The browser adds the `Origin` and the session cookie. */
  post(path: string, body: unknown): Promise<Answer> {
    return this.call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  }

  private async call(path: string, init: RequestInit): Promise<Answer> {
    let response: Response;
    try {
      response = await fetch(`${this.base}${path}`, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
      return { ok: false, status: 0, message: timedOut ? NO_ANSWER : 'The server cannot be reached', retry: true };
    }
    const body: unknown = await response.json().catch((): unknown => null);
    if (response.ok) return { ok: true, body };
    return { ok: false, status: response.status, ...failure(response.status, errorText(body)) };
  }
}

function errorText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { readonly error?: unknown }).error;
  return typeof error === 'string' && error !== '' ? error : null;
}

/** The message for a failed call, by the design pattern's list; a 504 may have run. */
function failure(status: number, error: string | null): { readonly message: string; readonly retry: boolean } {
  switch (status) {
    case 401:
      return { message: 'You are logged out; log in again', retry: false };
    case 403:
      return { message: 'You may not do this', retry: false };
    case 405:
      return { message: NOT_TAKEN, retry: false };
    case 413:
      return { message: 'Too much at once; choose fewer objects', retry: false };
    case 503:
      return { message: 'The simulator is loading; try again', retry: true };
    case 504:
      return { message: NO_ANSWER, retry: true };
    case 400:
    case 404:
    case 409:
      return { message: error ?? `The server answered ${String(status)}`, retry: false };
    default:
      return { message: error ?? `The server answered ${String(status)}`, retry: true };
  }
}
