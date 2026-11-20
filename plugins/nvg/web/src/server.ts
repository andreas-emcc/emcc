// The NVG panel's calls to its own server part (design pattern, section 6). Every failure becomes a
// short English message the panel shows; a 401 means the session ended.

/** The most a file may weigh (brief, section 4: at most 16 MiB). */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** An import's state, as `GET /import/{job}` gives it. */
export interface ImportState {
  readonly job: string;
  readonly name: string;
  readonly state: 'checking' | 'reading' | 'writing' | 'done' | 'refused' | 'failed';
  readonly reason?: string;
  readonly items?: number;
  readonly created?: number;
  readonly updated?: number;
  readonly unchanged?: number;
  readonly skipped?: Readonly<Record<string, number>>;
  readonly notes?: Readonly<Record<string, number>>;
  readonly failed?: Readonly<Record<string, number>>;
  readonly problem?: string;
}

/** A link, as `GET /links` gives it (NV1, for admins). */
export interface LinkState {
  readonly name: string;
  readonly kind: 'soap-consumer' | 'soap-provider' | 'bad';
  readonly enabled: boolean;
  readonly ok: boolean;
  readonly detail: string;
  readonly counters?: Readonly<Record<string, number>>;
  readonly capabilities?: readonly CapabilityItem[];
  readonly layer?: string;
  readonly path?: string;
}

/** A filter item a provider offers. */
export interface CapabilityItem {
  readonly kind: string;
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

/** A failure with the message to show. */
export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function errorOf(response: Response): Promise<ServerError> {
  let message = '';
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') message = body.error;
  } catch {
    // not JSON: the status says it
  }
  if (message === '') {
    message =
      response.status === 401
        ? 'You are logged out'
        : response.status === 413
          ? 'The file is larger than 16 MiB'
          : response.status === 503 || response.status === 504
            ? 'The server is busy; try again'
            : `The server answered ${String(response.status)}`;
  }
  return new ServerError(message, response.status);
}

/** Starts an import; resolves with the job's first state (202). */
export async function startImport(
  serverBase: string,
  layerId: string,
  file: { readonly name: string; readonly bytes: ArrayBuffer },
  label: { readonly policy: string; readonly classification: string } | null,
  signal?: AbortSignal,
): Promise<ImportState> {
  const query = new URLSearchParams({ layer: layerId, name: file.name });
  if (label !== null) {
    query.set('policy', label.policy);
    query.set('classification', label.classification);
  }
  const response = await fetch(`${serverBase}import?${query.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: file.bytes,
    ...(signal === undefined ? {} : { signal }),
  });
  if (response.status !== 202) throw await errorOf(response);
  return (await response.json()) as ImportState;
}

/** An import's state now. */
export async function importState(serverBase: string, job: string, signal?: AbortSignal): Promise<ImportState> {
  const response = await fetch(`${serverBase}import/${encodeURIComponent(job)}`, signal === undefined ? {} : { signal });
  if (!response.ok) throw await errorOf(response);
  return (await response.json()) as ImportState;
}

/** Whether an import has ended. */
export function finished(state: ImportState): boolean {
  return state.state === 'done' || state.state === 'refused' || state.state === 'failed';
}

/** Exports layers; resolves with the file and its name (from the answer's Content-Disposition). */
export async function exportLayers(serverBase: string, layerIds: readonly string[], fallbackName: string): Promise<{ readonly blob: Blob; readonly name: string }> {
  const query = new URLSearchParams();
  for (const id of layerIds) query.append('layer', id);
  const response = await fetch(`${serverBase}export?${query.toString()}`);
  if (!response.ok) throw await errorOf(response);
  return { blob: await response.blob(), name: fileName(response.headers.get('Content-Disposition')) ?? `${fallbackName}.nvg` };
}

/** The file name of a Content-Disposition header: `filename*` (UTF-8) first, else `filename`. */
export function fileName(disposition: string | null): string | null {
  if (disposition === null) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1] !== undefined) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall back to the plain name
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition);
  return plain?.[1] ?? null;
}

/** The links and their state (admins only). */
export async function listLinks(serverBase: string): Promise<readonly LinkState[]> {
  const response = await fetch(`${serverBase}links`);
  if (!response.ok) throw await errorOf(response);
  const body = (await response.json()) as { readonly links: readonly LinkState[] };
  return body.links;
}

/** Calls a consumer link's provider's GetCapabilities once (NV1). */
export async function getCapabilities(serverBase: string, link: string): Promise<readonly CapabilityItem[]> {
  const response = await fetch(`${serverBase}links/${encodeURIComponent(link)}/capabilities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw await errorOf(response);
  const body = (await response.json()) as { readonly items: readonly CapabilityItem[] };
  return body.items;
}

/** An import's counts in one line, e.g. "5 items: 5 created, 0 updated, 0 unchanged; skipped: content-item 1". */
export function describe(state: ImportState): string {
  if (state.state === 'refused' || state.state === 'failed') return state.reason ?? state.state;
  const parts = [`${String(state.items ?? 0)} items: ${String(state.created ?? 0)} created, ${String(state.updated ?? 0)} updated, ${String(state.unchanged ?? 0)} unchanged`];
  const skipped = Object.entries(state.skipped ?? {});
  if (skipped.length > 0) parts.push(`skipped: ${skipped.map(([k, v]) => `${k.replace(/^skipped: /, '')} ${String(v)}`).join(', ')}`);
  const failed = Object.entries(state.failed ?? {});
  if (failed.length > 0) parts.push(`not written: ${failed.map(([k, v]) => `${k} ${String(v)}`).join(', ')}`);
  return parts.join('; ');
}
