// The web part's calls to its own server part (brief function 13): GET /cameras, and the commands as
// POST endpoints with a JSON body. Only the emc2 server is reachable from the browser (ADR-0030), so
// every path is under `ctx.serverBase`, and no path or body names a host.

/** What a call gives: the answer's JSON, or why there is none, with the field the server named. */
export type Answer =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly status: number; readonly message: string; readonly field: string | null; readonly camera: string | null };

/** Every call has a timeout. ECore answers 504 after the endpoint's 5 s, so this only ends a call that never settles. */
export const CALL_TIMEOUT_MS = 10_000;

export class CamerasServer {
  /** `base` is `ctx.serverBase`, `/api/plugins/uav-simulation/`. */
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
      return { ok: false, status: 0, message: timedOut ? 'No answer in time; it may have been done' : 'The server cannot be reached', field: null, camera: null };
    }
    const body: unknown = await response.json().catch((): unknown => null);
    if (response.ok) return { ok: true, body };
    return { ok: false, status: response.status, message: message(response.status, text(body, 'error')), field: text(body, 'field'), camera: text(body, 'camera') };
  }
}

function text(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Readonly<Record<string, unknown>>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The message for a failed call, by the design pattern's list. */
function message(status: number, error: string | null): string {
  switch (status) {
    case 401:
      return 'You are logged out; log in again';
    case 403:
      return 'You may not do this';
    case 503:
      return 'The cameras are loading; try again';
    case 504:
      return 'No answer in time; it may have been done';
    default:
      return error ?? `The server answered ${String(status)}`;
  }
}
