/**
 * The web parts that implement the capability `temporal` (ADR-0045 point 4): each gets
 * `timeChanged` with the page's time once after `activate`, and at each change. One whose call
 * throws is reported (its plugin becomes DEGRADED) and keeps getting the changes.
 */
import { NOW, type TemporalCapability, type UserTime } from '@emc2/plugin-sdk';

export class TemporalPlugins {
  private readonly modules = new Map<string, TemporalCapability>();
  private current: UserTime = NOW;

  constructor(private readonly onError: (pluginId: string, error: unknown) => void) {}

  /** The page's time now. */
  get time(): UserTime {
    return this.current;
  }

  /** A web part whose capability passed the check, right after its `activate`: it gets the time at once. */
  add(pluginId: string, capability: TemporalCapability): void {
    this.modules.set(pluginId, capability);
    this.call(pluginId, capability, this.current);
  }

  /** The plugin's web part was fenced: no more calls. */
  remove(pluginId: string): void {
    this.modules.delete(pluginId);
  }

  /** The page's time changed; each web part gets it, once per change. */
  changed(time: UserTime): void {
    if (JSON.stringify(time) === JSON.stringify(this.current)) return;
    this.current = time;
    for (const [id, capability] of [...this.modules]) this.call(id, capability, time);
  }

  private call(pluginId: string, capability: TemporalCapability, time: UserTime): void {
    try {
      capability.timeChanged(time);
    } catch (error) {
      this.onError(pluginId, error);
    }
  }
}

/** The header that names the page's live session in requests to the plugins' endpoints (owner, 2026-11-06). */
export const SESSION_HEADER = 'X-Emc2-Session';

/**
 * `original` with the page's live session added as {@link SESSION_HEADER} to each request to a
 * plugin's endpoints (`/api/plugins/…` on this page's origin), so that its server part gets the
 * page's time (`EndpointRequest.userTime()`; owner, 2026-11-06). A header the request names itself
 * is kept, and nothing is added while no session is open.
 */
export function withSessionHeader(original: typeof fetch, session: () => string | null, origin: string): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const id = session();
    if (id === null) return original(input, init);
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), origin);
    } catch {
      return original(input, init);
    }
    if (url.origin !== origin || !url.pathname.startsWith('/api/plugins/')) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(SESSION_HEADER)) headers.set(SESSION_HEADER, id);
    return original(input, { ...init, headers });
  };
}
