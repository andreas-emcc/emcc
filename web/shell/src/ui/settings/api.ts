/**
 * The settings calls of the server (server/app SettingsController). Every call needs
 * `settings.admin`; the server checks it, hiding the tabs is not the protection. An answer is the
 * value, or a message for the user with the server's problems per JSON Pointer.
 */
import type { DataType, DataTypeDefaults, DisplayChoices } from '@emc2/plugin-sdk';
import { premadeOf, type Premade } from './labeling/model.ts';
import type { Json, JsonObject } from './schema.ts';

export interface Problem {
  /** A JSON Pointer into the values sent; empty for the whole. */
  readonly path: string;
  readonly problem: string;
}

export type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false; readonly message: string; readonly problems: readonly Problem[];
    /** The server checked the values and refused them (HTTP 400): `problems` say why. */
    readonly invalid?: boolean;
  };

/** `GET /api/settings/plugins/{id}`: the schema is null for a plugin without settings. */
export interface PluginSettingsView {
  readonly schema: Json;
  readonly values: JsonObject;
}

/** SDK 1.9.0 (ADR-0064): a plugin's compute threads, what it declares and why, and what the admin allows it now. */
export interface ComputeThreads {
  readonly declared: number;
  readonly reason: string;
  readonly allowed: number;
}

const TIMEOUT_MS = 10_000;

export class SettingsApi {
  private readonly doFetch: typeof fetch;

  constructor(doFetch?: typeof fetch, private readonly timeoutMs = TIMEOUT_MS) {
    // Not stored as `fetch` itself: called as a method of this object, the browser's fetch throws.
    this.doFetch = doFetch ?? ((input, init) => fetch(input, init));
  }

  plugin(pluginId: string): Promise<Answer<PluginSettingsView>> {
    return this.call('GET', pluginPath(pluginId), undefined, 'plugin');
  }

  /** Replaces the plugin's settings with `values`; the answer is the stored values. */
  async savePlugin(pluginId: string, values: JsonObject): Promise<Answer<JsonObject>> {
    const answer = await this.call<{ values: JsonObject }>('PUT', pluginPath(pluginId), values, 'plugin');
    return answer.ok ? { ok: true, value: answer.value.values } : answer;
  }

  /** ADR-0062 point 3 (M9 C3): the names of the server's TLS credentials, sorted (`settings.admin`). */
  async tlsCredentials(): Promise<Answer<readonly string[]>> {
    const answer = await this.call<{ names?: unknown }>('GET', '/api/settings/tls-credentials', undefined, 'setting');
    if (!answer.ok) return answer;
    const names = answer.value.names;
    return Array.isArray(names) && names.every((n) => typeof n === 'string')
      ? { ok: true, value: names }
      : { ok: false, message: 'The server\'s answer has no names.', problems: [] };
  }

  /** SDK 1.9.0: a plugin's compute threads (`settings.admin`). */
  compute(pluginId: string): Promise<Answer<ComputeThreads>> {
    return this.call('GET', `${pluginPath(pluginId)}/compute`, undefined, 'setting');
  }

  /** SDK 1.9.0: the plugin's compute threads, applied at once; the answer is them as stored. */
  saveCompute(pluginId: string, allowed: number): Promise<Answer<ComputeThreads>> {
    return this.call('PUT', `${pluginPath(pluginId)}/compute`, { allowed }, 'setting');
  }

  /** Replaces a data type's behaviour; the answer is the data type as it is now. */
  saveDataType(dataType: string, behaviour: DataTypeDefaults): Promise<Answer<DataType>> {
    return this.call('PUT', dataTypePath(dataType), behaviour as Json, 'data type');
  }

  /** Sets the installation's default look (Settings › General, ADR-0034); the answer is the general settings. */
  saveDefaultLook(look: string): Promise<Answer<{ readonly defaultLook: string }>> {
    return this.call('PUT', '/api/settings/general', { defaultLook: look }, 'setting');
  }

  /** Sets the users' display defaults (Settings › Display; SDK 1.4.0 part 5, ADR-0046 point 3); the answer is them as stored. */
  async saveDisplayDefaults(defaults: DisplayChoices): Promise<Answer<DisplayChoices>> {
    const answer = await this.call<{ defaults: DisplayChoices }>('PUT', '/api/settings/display', defaults as Json, 'setting');
    return answer.ok ? { ok: true, value: answer.value.defaults } : answer;
  }

  /** The premade security labels (Settings › Labeling, T-170). */
  async labeling(): Promise<Answer<Premade>> {
    const answer = await this.call<unknown>('GET', LABELING_PATH, undefined, 'setting');
    return answer.ok ? { ok: true, value: premadeOf(answer.value) } : answer;
  }

  /** Replaces all premade security labels (one Save for the entry, owner OJ B); the answer is them as stored. */
  async saveLabeling(premade: Premade): Promise<Answer<Premade>> {
    const answer = await this.call<unknown>('PUT', LABELING_PATH, premade as unknown as Json, 'setting');
    return answer.ok ? { ok: true, value: premadeOf(answer.value) } : answer;
  }

  /** Sets a data type's behaviour back to its manifest's defaults. */
  resetDataType(dataType: string): Promise<Answer<DataType>> {
    return this.call('DELETE', dataTypePath(dataType), undefined, 'data type');
  }

  private async call<T>(method: string, path: string, body: Json | undefined, what: string): Promise<Answer<T>> {
    let response: Response;
    try {
      response = await this.doFetch(path, {
        method,
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return refused('The server did not answer. Your edits are kept; try again.');
    }
    if (response.ok) {
      try {
        return { ok: true, value: (await response.json()) as T };
      } catch {
        return refused('The server sent an answer this page cannot read.');
      }
    }
    switch (response.status) {
      case 400:
        return { ok: false, message: 'The server refused the values; nothing was changed.', problems: await problemsOf(response), invalid: true };
      case 401:
        return refused('Your login has ended. Reload the page to log in again.');
      case 403:
        return refused('This needs the settings.admin permission.');
      case 404:
        return refused(`The server does not know this ${what}.`);
      default:
        return refused(`The server answered HTTP ${String(response.status)}; nothing was changed.`);
    }
  }
}

const LABELING_PATH = '/api/settings/labeling';
const pluginPath = (pluginId: string) => `/api/settings/plugins/${encodeURIComponent(pluginId)}`;
const dataTypePath = (dataType: string) => `/api/settings/data-types/${encodeURIComponent(dataType)}`;

function refused(message: string, problems: readonly Problem[] = []): Answer<never> {
  return { ok: false, message, problems };
}

async function problemsOf(response: Response): Promise<readonly Problem[]> {
  try {
    const body: unknown = await response.json();
    const problems = typeof body === 'object' && body !== null && 'problems' in body ? body.problems : null;
    if (!Array.isArray(problems)) return [];
    return problems.flatMap((p: unknown) => (typeof p === 'object' && p !== null && 'path' in p && 'problem' in p
      && typeof p.path === 'string' && typeof p.problem === 'string' ? [{ path: p.path, problem: p.problem }] : []));
  } catch {
    return [];
  }
}
