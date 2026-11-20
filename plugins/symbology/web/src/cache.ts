/** The appearance key of a symbol image: standard, canonical SIDC, size, and the drawn modifiers. */
export interface AppearanceKey {
  readonly standard: string;
  readonly sidc: string;
  readonly size: number;
  readonly modifiers: string;
}

interface Entry<V> {
  readonly key: AppearanceKey;
  readonly value: V;
  readonly weight: number;
}

/** standard → SIDC → size → modifiers → entry. */
type Index<V> = Map<string, Map<string, Map<number, Map<string, Entry<V>>>>>;

/**
 * A cache of at most `capacity` entries, whose weights (e.g. pixels) add up to at most `maxWeight`.
 * When either limit is passed, it drops the least recently used entries; it never drops the entry
 * just added, so one entry heavier than `maxWeight` is kept alone.
 *
 * It is indexed by the parts of the key in nested maps instead of one joined string: a lookup then
 * hashes no new string, because callers pass the same SIDC string again and again (100 000 lookups
 * have to take under 50 ms, brief criterion 5). The insertion order of a `Set` is the order of use.
 */
export class AppearanceCache<V> {
  private readonly index: Index<V> = new Map();
  private readonly order = new Set<Entry<V>>();
  private totalWeight = 0;
  private maxEntries: number;

  constructor(
    capacity: number,
    readonly maxWeight = Number.POSITIVE_INFINITY,
    private readonly weigh: (value: V) => number = () => 0,
  ) {
    this.maxEntries = checkedCapacity(capacity);
    if (!(maxWeight > 0)) throw new RangeError(`cache maxWeight must be positive, not ${String(maxWeight)}`);
  }

  /** The most entries the cache holds. */
  get capacity(): number {
    return this.maxEntries;
  }

  /** Changes the capacity; a smaller one drops the least recently used entries at once. */
  resize(capacity: number): void {
    this.maxEntries = checkedCapacity(capacity);
    this.trim();
  }

  get size(): number {
    return this.order.size;
  }

  /** The sum of the weights of the entries. */
  get weight(): number {
    return this.totalWeight;
  }

  /** The value for the key, which becomes the most recently used one. */
  get(standard: string, sidc: string, size: number, modifiers: string): V | undefined {
    const entry = this.index.get(standard)?.get(sidc)?.get(size)?.get(modifiers);
    if (entry === undefined) return undefined;
    this.order.delete(entry);
    this.order.add(entry);
    return entry.value;
  }

  set(key: AppearanceKey, value: V): void {
    const bySidc = getOrAdd(this.index, key.standard, () => new Map());
    const bySize = getOrAdd(bySidc, key.sidc, () => new Map());
    const byModifiers = getOrAdd(bySize, key.size, () => new Map());
    const old = byModifiers.get(key.modifiers);
    if (old !== undefined) {
      this.order.delete(old);
      this.totalWeight -= old.weight;
    }
    const entry: Entry<V> = { key, value, weight: this.weigh(value) };
    byModifiers.set(key.modifiers, entry);
    this.order.add(entry);
    this.totalWeight += entry.weight;
    this.trim();
  }

  /** Drops the least recently used entries while a limit is passed, but never the most recent one. */
  private trim(): void {
    while (this.order.size > 1 && (this.order.size > this.maxEntries || this.totalWeight > this.maxWeight)) {
      const oldest = this.order.values().next();
      if (oldest.done === true) break;
      this.remove(oldest.value);
    }
  }

  private remove(entry: Entry<V>): void {
    this.order.delete(entry);
    this.totalWeight -= entry.weight;
    const { standard, sidc, size, modifiers } = entry.key;
    const bySidc = this.index.get(standard);
    const bySize = bySidc?.get(sidc);
    const byModifiers = bySize?.get(size);
    byModifiers?.delete(modifiers);
    // Drop emptied levels, so that the index does not grow with every SIDC ever drawn.
    if (byModifiers?.size === 0) bySize?.delete(size);
    if (bySize?.size === 0) bySidc?.delete(sidc);
    if (bySidc?.size === 0) this.index.delete(standard);
  }
}

function checkedCapacity(capacity: number): number {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`cache capacity must be a positive integer, not ${String(capacity)}`);
  return capacity;
}

function getOrAdd<K, T>(level: Map<K, T>, key: K, create: () => NoInfer<T>): T {
  let next = level.get(key);
  if (next === undefined) {
    next = create();
    level.set(key, next);
  }
  return next;
}
