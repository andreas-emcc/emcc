/**
 * Loads the plugins' web parts (overview 4.1 and 4.11, SDK v0 "Entry module", S4 rec. 6): in the
 * order of {@link planLoad}, one at a time, each with its CSS first, then `import()` of its entry
 * module (30 s), then `activate(ctx)` (10 s).
 *
 * A plugin that fails, times out, has no usable entry module, or lacks a dependency or a required
 * service that failed is disabled, fenced and reported; the others continue. If the plugin is
 * `required`, the application stops (no further plugins are loaded and the shell says why).
 */
import { capabilitiesOf, capabilityMismatch, type CapabilityId, type WebPlugin as SdkWebPlugin } from '@emc2/plugin-sdk';
import type { TemporalPlugins } from '../time/temporal.ts';
import type { ShellStore } from '../ui/store.ts';
import { createPluginContext, type ContextEnvironment, type LiveSubscriber } from './context.ts';
import { planLoad, webBase, type PluginEntry, type WebPlugin } from './plan.ts';
import { ServiceRegistry } from './services.ts';

export const IMPORT_TIMEOUT_MS = 30_000;
export const ACTIVATE_TIMEOUT_MS = 10_000;

export interface LoaderOptions {
  readonly store: ShellStore;
  readonly environment: Omit<ContextEnvironment, 'store' | 'services' | 'live' | 'setups'> & {
    /** The shell's setups: plugins register their shares, and each gets its share once it has started. */
    readonly setups?: ContextEnvironment['setups'] & { pluginActive(pluginId: string): void };
  };
  /** The live picture's subscriber for the plugins, made with their service registry (for the map view). */
  readonly live: (services: ServiceRegistry) => LiveSubscriber;
  readonly importModule?: (url: string) => Promise<unknown>;
  readonly loadStyle?: (url: string) => Promise<void>;
  readonly importTimeoutMs?: number;
  readonly activateTimeoutMs?: number;
  /**
   * SDK 1.4.0 (ADR-0044 point 4; owner, Q11 and 2026-11-06): after each `activate`, the web part's
   * capabilities are checked against its manifest; `report` sends what it implements and the
   * mismatch to the server, and a temporal web part that passes joins `temporal`.
   */
  readonly capabilities?: {
    readonly report: (pluginId: string, implemented: readonly CapabilityId[], problem: string | null) => void;
    readonly temporal: TemporalPlugins;
  };
}

/** The plugins that run, and the service registry they share. */
export interface LoadResult {
  readonly active: readonly string[];
  readonly services: ServiceRegistry;
}

class Timeout extends Error {}

/** Rejects with `message` if the promise does not settle in time. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Timeout(message)); }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

/**
 * The web part's capabilities after `activate` (ADR-0044 point 4): `capabilityMismatch` against the
 * manifest, reported to the server whenever the plugin declares or implements one, which judges the
 * whole with the server part. With a mismatch the shell uses none of the module's capabilities and
 * the plugin is DEGRADED in this browser; otherwise a temporal module gets the page's time.
 */
function checkCapabilities(plugin: PluginEntry, entry: SdkWebPlugin, options: LoaderOptions, store: ShellStore): void {
  const declared = plugin.capabilities ?? [];
  const implemented = capabilitiesOf(entry);
  if (declared.length === 0 && implemented.length === 0) return;
  const problem = capabilityMismatch(entry, declared, plugin.serverPart ?? true);
  options.capabilities?.report(plugin.id, implemented, problem);
  if (problem !== null) {
    store.observe(plugin.id, { state: 'DEGRADED', detail: `${problem}: its capabilities are not used` });
    return;
  }
  const temporal = entry.capabilities?.temporal;
  if (temporal !== undefined) options.capabilities?.temporal.add(plugin.id, temporal);
}

function defaultImport(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url);
}

/** Adds a style sheet to the page; resolves when it is loaded. */
export function linkStyle(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => { resolve(); };
    link.onerror = () => { reject(new Error(`could not load ${url}`)); };
    document.head.append(link);
  });
}

function entryOf(module: unknown): SdkWebPlugin | null {
  const plugin = (module as { readonly default?: unknown } | null)?.default as { readonly activate?: unknown } | undefined;
  return typeof plugin?.activate === 'function' ? (plugin as SdkWebPlugin) : null;
}

export async function loadPlugins(entries: readonly PluginEntry[], options: LoaderOptions): Promise<LoadResult> {
  const { store } = options;
  const importModule = options.importModule ?? defaultImport;
  const loadStyle = options.loadStyle ?? linkStyle;
  const importTimeout = options.importTimeoutMs ?? IMPORT_TIMEOUT_MS;
  const activateTimeout = options.activateTimeoutMs ?? ACTIVATE_TIMEOUT_MS;

  store.setPlugins(entries);
  for (const entry of entries) {
    if (entry.active && entry.settings !== null) options.environment.shared.initialSettings(entry.id, entry.settings);
  }
  const plan = planLoad(entries);
  const services = new ServiceRegistry(plan.load);
  const live = options.live(services);
  const out = options.environment.console ?? console;
  const unavailable = new Set<string>();
  /** The required plugin that is not available, if any: nothing more is loaded. */
  const halt: { by: string | null } = { by: null };

  const stop = (plugin: WebPlugin, reason: string) => {
    if (plugin.required && halt.by === null) {
      halt.by = plugin.id;
      store.setFatal(`The required plugin ${plugin.name ?? plugin.id} is not available (${reason}). The application cannot run without it.`);
    }
  };
  const refuse = (plugin: WebPlugin, reason: string) => {
    unavailable.add(plugin.id);
    services.failed(plugin.id);
    store.setLoad(plugin.id, 'refused', reason);
    out.warn(`[${plugin.id}] web part not loaded: ${reason}`);
    stop(plugin, reason);
  };

  for (const { plugin, reason } of plan.refused) refuse(plugin, reason);
  for (const { plugin, note } of plan.notes) store.note(plugin.id, note);

  const active: string[] = [];
  for (const plugin of plan.load) {
    if (halt.by !== null) {
      refuse(plugin, `not loaded: the required plugin ${halt.by} is not available`);
      continue;
    }
    const lostDependency = plugin.dependsOn.find((d) => unavailable.has(d));
    if (lostDependency !== undefined) {
      refuse(plugin, `depends on ${lostDependency}, whose web part is not available`);
      continue;
    }
    const lostKey = plugin.requires.find((key) => !plugin.provides.includes(key) && !services.available(key));
    if (lostKey !== undefined) {
      refuse(plugin, `requires ${lostKey}, but its provider is not available`);
      continue;
    }

    store.setLoad(plugin.id, 'loading');
    const handle = createPluginContext(plugin, { ...options.environment, store, services, live });
    try {
      for (const css of plugin.web.css) {
        try {
          await withTimeout(loadStyle(webBase(plugin.id) + css), importTimeout, `its style sheet ${css} did not load within ${String(importTimeout / 1000)} s`);
        } catch (error) {
          // The plugin still works, only looks wrong.
          out.warn(`[${plugin.id}] style sheet ${css} not loaded`, error);
          store.observe(plugin.id, { state: 'DEGRADED', detail: `style sheet ${css} not loaded` });
        }
      }
      const module = await withTimeout(importModule(webBase(plugin.id) + plugin.web.entry), importTimeout,
        `its entry module did not load within ${String(importTimeout / 1000)} s`);
      const entry = entryOf(module);
      if (entry === null) throw new Error('its entry module has no default export with activate(ctx)');
      await withTimeout(Promise.resolve(entry.activate(handle.context)), activateTimeout,
        `activate() did not finish within ${String(activateTimeout / 1000)} s`);
      services.activated(plugin.id);
      store.setLoad(plugin.id, 'active');
      checkCapabilities(plugin, entry, options, store);
      options.environment.setups?.pluginActive(plugin.id); // its share of the remembered setup, now that it has started
      active.push(plugin.id);
    } catch (error) {
      const reason = error instanceof Timeout ? error.message : `failed: ${error instanceof Error ? error.message : String(error)}`;
      handle.fence(reason);
      unavailable.add(plugin.id);
      services.failed(plugin.id);
      store.setLoad(plugin.id, 'failed', reason);
      store.notify(null, { severity: 'error', message: `Plugin ${plugin.name ?? plugin.id}: ${reason}` });
      out.error(`[${plugin.id}] web part disabled: ${reason}`, error);
      stop(plugin, reason);
    }
  }
  return { active, services };
}
