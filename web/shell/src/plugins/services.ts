/**
 * Services between plugins (SDK v0, `ctx.services`; CDA review B1).
 *
 * - A plugin may provide only keys listed in its manifest's `provides`; a second provider of a
 *   `one` key is refused.
 * - A provided service becomes visible when its provider has activated; a provider that fails
 *   takes its services with it.
 * - `get` resolves when the provider has activated, and rejects at once when no loaded plugin
 *   provides the key, or when every provider failed. It never hangs on a plugin that is not coming.
 * - SDK 1.3.0 (CR-0023): `provide` returns what removes that one implementation again; `getAll`'s
 *   `current` and `onChange` follow, a second call does nothing, and the plugin may provide the key
 *   again afterwards. A plugin may provide a `many` key several times, e.g. `basemap-wms` one
 *   background per configured layer (the ACA's step-2 review, F1), each with its own undo; `getAll`
 *   lists them in the order provided, after the plugins before it in load order. A `one` key once.
 */
import type { ServiceKey, ServiceList, Unsubscribe } from '@emc2/plugin-sdk';

type ProviderState = 'waiting' | 'active' | 'failed';

interface Waiter {
  readonly resolve: (implementation: unknown) => void;
  readonly reject: (error: Error) => void;
}

export class ServiceRegistry {
  /** Key id → the plugins that declare it in `provides`, in load order. */
  private readonly declared = new Map<string, string[]>();
  private readonly cardinality = new Map<string, 'one' | 'many'>();
  private readonly states = new Map<string, ProviderState>();
  /**
   * Plugin id → key id → its implementations in the order provided (maybe not visible yet), each
   * boxed so that each `provide` is told apart; one for a `one` key. A key with none is removed.
   */
  private readonly provided = new Map<string, Map<string, { readonly implementation: unknown }[]>>();
  private readonly waiters = new Map<string, Waiter[]>();
  private readonly listWatchers = new Map<string, Set<(current: readonly unknown[]) => void>>();

  /** `plugins`: the plugins that will be loaded, in load order, with their manifests' `provides`. */
  constructor(plugins: readonly { readonly id: string; readonly provides: readonly string[] }[]) {
    for (const plugin of plugins) {
      this.states.set(plugin.id, 'waiting');
      for (const key of plugin.provides) {
        const list = this.declared.get(key) ?? [];
        list.push(plugin.id);
        this.declared.set(key, list);
      }
    }
  }

  provide<T>(pluginId: string, key: ServiceKey<T, 'one' | 'many'>, implementation: T): Unsubscribe {
    if (!(this.declared.get(key.id) ?? []).includes(pluginId)) {
      throw new Error(`${pluginId} may not provide ${key.id}: it is not in the manifest's "provides"`);
    }
    const known = this.cardinality.get(key.id);
    if (known !== undefined && known !== key.cardinality) throw new Error(`${key.id} is a "${known}" key`);
    this.cardinality.set(key.id, key.cardinality);
    if (key.cardinality === 'one') {
      const other = [...this.provided].find(([id, keys]) => id !== pluginId && keys.has(key.id) && this.states.get(id) !== 'failed');
      if (other !== undefined) throw new Error(`${key.id} is already provided by ${other[0]}; there can be only one`);
    }
    const own = this.provided.get(pluginId) ?? new Map<string, { readonly implementation: unknown }[]>();
    if (key.cardinality === 'one' && own.has(key.id)) throw new Error(`${pluginId} already provides ${key.id}`);
    const entry = { implementation };
    own.set(key.id, [...(own.get(key.id) ?? []), entry]);
    this.provided.set(pluginId, own);
    if (this.states.get(pluginId) === 'active') this.publish(key.id);
    return () => {
      // Only this provide's entry: not another of the plugin's, nor one a failure has taken.
      const entries = this.provided.get(pluginId)?.get(key.id) ?? [];
      if (!entries.includes(entry)) return;
      const rest = entries.filter((e) => e !== entry);
      if (rest.length === 0) own.delete(key.id);
      else own.set(key.id, rest);
      if (this.states.get(pluginId) === 'active') this.notifyList(key.id);
    };
  }

  get<T>(key: ServiceKey<T>): Promise<T> {
    if ((key.cardinality as string) !== 'one') return Promise.reject(new Error(`${key.id} has many providers: use getAll`));
    const visible = this.visible(key.id);
    if (visible.length > 0) return Promise.resolve(visible[0] as T);
    if (!this.mayStillCome(key.id)) return Promise.reject(this.unavailable(key.id));
    return new Promise<T>((resolve, reject) => {
      const list = this.waiters.get(key.id) ?? [];
      list.push({ resolve: (i) => { resolve(i as T); }, reject });
      this.waiters.set(key.id, list);
    });
  }

  getAll<T>(key: ServiceKey<T, 'many'>): ServiceList<T> {
    const current = () => this.visible(key.id) as readonly T[];
    const watchers = this.listWatchers.get(key.id) ?? new Set();
    this.listWatchers.set(key.id, watchers);
    return {
      get current() {
        return current();
      },
      onChange(listener: (current: readonly T[]) => void): Unsubscribe {
        const watcher = (list: readonly unknown[]) => { listener(list as readonly T[]); };
        watchers.add(watcher);
        return () => { watchers.delete(watcher); };
      },
    };
  }

  /** The plugin has activated: its services become visible. */
  activated(pluginId: string): void {
    this.states.set(pluginId, 'active');
    for (const key of this.provided.get(pluginId)?.keys() ?? []) this.publish(key);
    this.settle();
  }

  /** The plugin failed or was disabled: its services are gone. */
  failed(pluginId: string): void {
    const wasActive = this.states.get(pluginId) === 'active';
    this.states.set(pluginId, 'failed');
    if (wasActive) for (const key of this.provided.get(pluginId)?.keys() ?? []) this.notifyList(key);
    this.provided.delete(pluginId);
    this.settle();
  }

  /** True if an active plugin provides the key. */
  available(keyId: string): boolean {
    return this.visible(keyId).length > 0;
  }

  /** The implementations of active providers, in load order. */
  private visible(keyId: string): unknown[] {
    const out: unknown[] = [];
    for (const id of this.declared.get(keyId) ?? []) {
      if (this.states.get(id) !== 'active') continue;
      for (const entry of this.provided.get(id)?.get(keyId) ?? []) out.push(entry.implementation);
    }
    return out;
  }

  private mayStillCome(keyId: string): boolean {
    return (this.declared.get(keyId) ?? []).some((id) => this.states.get(id) === 'waiting');
  }

  private unavailable(keyId: string): Error {
    const providers = this.declared.get(keyId) ?? [];
    return new Error(providers.length === 0 ? `no loaded plugin provides ${keyId}`
      : `${keyId} is not available: its provider (${providers.join(', ')}) failed or did not provide it`);
  }

  private publish(keyId: string): void {
    const visible = this.visible(keyId);
    if (visible.length > 0) {
      const waiting = this.waiters.get(keyId) ?? [];
      this.waiters.delete(keyId);
      for (const w of waiting) w.resolve(visible[0]);
    }
    this.notifyList(keyId);
  }

  private notifyList(keyId: string): void {
    const current = Object.freeze(this.visible(keyId));
    for (const watcher of [...(this.listWatchers.get(keyId) ?? [])]) watcher(current);
  }

  /** Rejects the waiters of keys that can no longer come. */
  private settle(): void {
    for (const [keyId, waiting] of [...this.waiters]) {
      if (this.visible(keyId).length === 0 && !this.mayStillCome(keyId)) {
        this.waiters.delete(keyId);
        for (const w of waiting) w.reject(this.unavailable(keyId));
      }
    }
  }
}
