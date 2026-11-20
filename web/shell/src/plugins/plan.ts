/**
 * Which plugin web parts this browser loads, and in which order (overview 4.1, SDK v0
 * "Services between plugins", CDA review B1).
 *
 * - Only active plugins (the server started them) with a web part.
 * - Refused: an `sdkVersion` this shell's SDK does not satisfy; a shared library the shell does not
 *   share, or shares at a version outside the caret range of the plugin's (SDK 1.9.0, CR-0048 point 2:
 *   the same major, the shell's at least as new; the SDK itself by `sdkVersion` only); a provided
 *   service key of another plugin's id (model rule 24); a second `map-view` plugin (the first in the
 *   server's order wins); a dependency (`dependsOn`) whose web part is refused; a required service key
 *   no loaded plugin provides; a key in both `requires` and `uses` (CR-0011); cycles across
 *   `dependsOn`, `requires` and `uses`.
 * - Order: dependencies and service providers first, of `requires` and `uses` keys alike, ties by
 *   id, as the plugin host orders the server parts.
 * - Noted, never refused (CR-0011): a `uses` key no loaded plugin provides.
 */
import {
  SDK_VERSION, SHARED_LIBRARIES, compatibleShared, satisfies, serviceKeyOwner, type JsonValue, type SymbolPalette,
} from '@emc2/plugin-sdk';

/** One plugin as `GET /api/plugins` lists it (server/app PluginController). */
export interface PluginEntry {
  readonly id: string;
  readonly name: string | null;
  readonly version: string | null;
  readonly kind: string | null;
  readonly active: boolean;
  readonly status: { readonly state: string; readonly detail: string };
  readonly web: {
    readonly entry: string;
    readonly css: readonly string[];
    readonly shared: Readonly<Record<string, string>>;
    /** The folder of the built web part, e.g. `/plugins/<id>/web/`. The shell does not use it: see {@link webBase}. */
    readonly url: string;
  } | null;
  readonly sdkVersion: string | null;
  readonly dependsOn: readonly string[];
  readonly provides: readonly string[];
  readonly requires: readonly string[];
  /** Service keys used when a provider is there (SDK v1, CR-0011). */
  readonly uses?: readonly string[];
  readonly required: boolean;
  readonly settings: { readonly [name: string]: JsonValue } | null;
  /** It has settings a user can change at runtime (its settings schema names a property). */
  readonly hasSettings?: boolean;
  /** SDK 1.9.0 (ADR-0064): the compute threads its manifest declares; 0 or absent: none. */
  readonly computeThreads?: number;
  /** SDK 1.4.0: the capabilities its manifest declares (ADR-0044), e.g. `temporal`. */
  readonly capabilities?: readonly string[];
  /** SDK 1.4.0: whether it has a server part, which may implement a declared capability for the web part. */
  readonly serverPart?: boolean;
  /** SDK 1.6.0 (T-174): its manifest's `category`; null or absent means General. */
  readonly category?: string | null;
  /** SDK 1.8.0 (CR-0043 part D): its manifest's `icon`, a name from `PLUGIN_ICONS`; null or absent: none. */
  readonly icon?: string | null;
  /** SDK 1.6.0 (CR-0041 part G): an enabled plugin's manifest's `symbolPalettes`, ids without the plugin's; null or absent: none. */
  readonly symbolPalettes?: readonly { readonly id: string; readonly name: string; readonly symbols: SymbolPalette['symbols'] }[] | null;
}

/** A plugin whose web part will be loaded. */
export type WebPlugin = PluginEntry & { readonly web: NonNullable<PluginEntry['web']> };

export interface Refusal {
  readonly plugin: WebPlugin;
  readonly reason: string;
}

export interface Note {
  readonly plugin: WebPlugin;
  readonly note: string;
}

export interface LoadPlan {
  /** In load order. */
  readonly load: readonly WebPlugin[];
  readonly refused: readonly Refusal[];
  /** What the Control Pane shows about plugins that load: e.g. a `uses` key nobody provides. */
  readonly notes: readonly Note[];
}

const usesOf = (plugin: PluginEntry): readonly string[] => plugin.uses ?? [];

/** A plugin id: lowercase words separated by hyphens (the manifest's rule). */
const PLUGIN_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * The folder a plugin's web part is loaded from, built from its id (T-014 review (3)): the shell
 * never takes a URL from the server's answer, so a wrong `web.url` cannot send it to another place.
 */
export function webBase(pluginId: string): string {
  return `/plugins/${pluginId}/web/`;
}

/**
 * A plain relative path: segments of letters, digits, `.`, `_` and `-` (an allow-list, review F1:
 * no `%`, which the URL parser decodes, so `%2e%2e` would climb; no `?`, `#`, `:`, `\` or white
 * space, which the parser strips or treats specially).
 */
const PLAIN_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * Why the web part's files cannot be loaded from its folder, or null if they can: an id that is
 * not one, or an entry or style sheet that is not a plain path inside the folder ({@link
 * PLAIN_PATH}, and no `.` or `..` segment).
 */
export function unsafeWebPart(plugin: WebPlugin): string | null {
  if (!PLUGIN_ID.test(plugin.id)) return 'has an id that is not lowercase words separated by hyphens';
  for (const file of [plugin.web.entry, ...plugin.web.css]) {
    const parts = file.split('/');
    if (!PLAIN_PATH.test(file) || parts.includes('..') || parts.includes('.')) {
      return `names the file "${file}", which is not inside its web folder`;
    }
  }
  return null;
}

/** Why this shell cannot run the plugin's web part, or null if it can. */
export function incompatibility(plugin: WebPlugin, sdkVersion: string = SDK_VERSION, shared: Readonly<Record<string, string>> = SHARED_LIBRARIES): string | null {
  const range = plugin.sdkVersion ?? '';
  let compatible: boolean;
  try {
    compatible = satisfies(range, sdkVersion);
  } catch {
    compatible = false;
  }
  if (!compatible) return `needs SDK ${range}, but the shell has ${sdkVersion}`;
  for (const [library, version] of Object.entries(plugin.web.shared)) {
    const own = shared[library];
    if (own === undefined) return `was built against ${library} ${version}, which the shell does not share`;
    if (!compatibleShared(library, version, own)) return `needs ${library} ^${version}, but the shell shares ${own}`;
  }
  return null;
}

/** Model rule 24 (SDK 1.9.0): a provided key is the SDK's own (`emc2.`) or the plugin's (`<id>.`). Why not, or null. */
export function foreignKey(plugin: Pick<WebPlugin, 'id' | 'provides'>): string | null {
  const key = plugin.provides.find((k) => serviceKeyOwner(k) !== 'emc2' && serviceKeyOwner(k) !== plugin.id);
  return key === undefined ? null : `provides ${key}, a key of the plugin ${serviceKeyOwner(key)}; a plugin provides emc2.* keys or its own`;
}

const compareIds = (a: WebPlugin, b: WebPlugin) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function planLoad(entries: readonly PluginEntry[]): LoadPlan {
  const refused: Refusal[] = [];
  const candidates = new Map<string, WebPlugin>();
  let mapView: WebPlugin | null = null;
  for (const entry of entries) {
    if (!entry.active || entry.web === null) continue;
    const plugin = entry as WebPlugin;
    const problem = unsafeWebPart(plugin) ?? incompatibility(plugin) ?? foreignKey(plugin);
    const twice = plugin.requires.find((key) => usesOf(plugin).includes(key));
    if (problem !== null) {
      refused.push({ plugin, reason: problem });
    } else if (twice !== undefined) {
      refused.push({ plugin, reason: `lists ${twice} in both requires and uses; a key is in one of them` });
    } else if (plugin.kind === 'map-view' && mapView !== null) {
      refused.push({ plugin, reason: `another map view (${mapView.id}) is active; only one can be` });
    } else {
      if (plugin.kind === 'map-view') mapView = plugin;
      candidates.set(plugin.id, plugin);
    }
  }
  const refusedIds = () => new Set(refused.map((r) => r.plugin.id));

  for (;;) {
    // Refusals spread: to users of a refused dependency, and to users of a key nobody provides.
    let changed = true;
    while (changed) {
      changed = false;
      const gone = refusedIds();
      for (const plugin of [...candidates.values()]) {
        const lostDependency = plugin.dependsOn.find((d) => gone.has(d));
        const missingKey = plugin.requires.find((key) => ![...candidates.values()].some((p) => p.provides.includes(key)));
        const reason = lostDependency !== undefined ? `depends on ${lostDependency}, whose web part is not loaded`
          : missingKey !== undefined ? `requires ${missingKey}, which no loaded plugin provides` : null;
        if (reason !== null) {
          candidates.delete(plugin.id);
          refused.push({ plugin, reason });
          changed = true;
        }
      }
    }
    const { order, cyclic } = topologicalOrder([...candidates.values()]);
    if (cyclic.length === 0) {
      const notes: Note[] = [];
      for (const plugin of order) {
        for (const key of usesOf(plugin)) {
          if (!order.some((p) => p.provides.includes(key))) notes.push({ plugin, note: `uses ${key}, which no loaded plugin provides` });
        }
      }
      return { load: order, refused, notes };
    }
    for (const plugin of cyclic) {
      candidates.delete(plugin.id);
      refused.push({ plugin, reason: `is part of a cycle of dependencies and service keys (${cyclic.map((p) => p.id).join(', ')})` });
    }
  }
}

/**
 * Kahn's algorithm over dependsOn and requires/uses→providers. `cyclic`: the plugins on a cycle; plugins
 * that only wait behind one are refused by the next round of {@link planLoad}.
 */
function topologicalOrder(plugins: readonly WebPlugin[]): { order: WebPlugin[]; cyclic: WebPlugin[] } {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const before = new Map<string, Set<string>>();
  for (const plugin of plugins) {
    const deps = new Set(plugin.dependsOn.filter((d) => byId.has(d) && d !== plugin.id));
    for (const key of [...plugin.requires, ...usesOf(plugin)]) {
      for (const provider of plugins) if (provider.id !== plugin.id && provider.provides.includes(key)) deps.add(provider.id);
    }
    before.set(plugin.id, deps);
  }
  const order: WebPlugin[] = [];
  const done = new Set<string>();
  for (;;) {
    const ready = plugins.filter((p) => !done.has(p.id) && [...(before.get(p.id) ?? [])].every((d) => done.has(d))).sort(compareIds);
    const next = ready[0];
    if (next === undefined) break;
    order.push(next);
    done.add(next.id);
  }
  const left = plugins.filter((p) => !done.has(p.id));
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    for (const d of before.get(from) ?? []) {
      if (d === to) return true;
      if (!done.has(d) && !seen.has(d)) {
        seen.add(d);
        if (reaches(d, to, seen)) return true;
      }
    }
    return false;
  };
  return { order, cyclic: left.filter((p) => reaches(p.id, p.id)).sort(compareIds) };
}
