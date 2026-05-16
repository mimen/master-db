export interface IdempotencyKey {
  key: string | undefined;
  entity_ref: string;
  route: string;
}

export interface IdempotencyCache {
  runOnce<T>(key: IdempotencyKey, fn: () => Promise<T>): Promise<T>;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export function createIdempotencyCache(opts: {
  ttlMs: number;
  max?: number;
}): IdempotencyCache {
  const max = opts.max ?? 5000;
  const map = new Map<string, CacheEntry>();
  const insertOrder: string[] = [];

  function evictExpired(): void {
    const now = Date.now();
    for (const [k, entry] of map) {
      if (entry.expiresAt <= now) {
        map.delete(k);
      }
    }
  }

  function set(cacheKey: string, value: unknown): void {
    evictExpired();
    if (!map.has(cacheKey)) {
      insertOrder.push(cacheKey);
    }
    map.set(cacheKey, { value, expiresAt: Date.now() + opts.ttlMs });
    // Enforce max size using insertion order
    while (map.size > max && insertOrder.length > 0) {
      const oldest = insertOrder.shift();
      if (oldest) map.delete(oldest);
    }
  }

  function get(cacheKey: string): unknown {
    const entry = map.get(cacheKey);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      map.delete(cacheKey);
      return undefined;
    }
    return entry.value;
  }

  return {
    async runOnce<T>(k: IdempotencyKey, fn: () => Promise<T>): Promise<T> {
      if (!k.key) return fn();
      const cacheKey = `${k.route}|${k.entity_ref}|${k.key}`;
      const cached = get(cacheKey) as T | undefined;
      if (cached !== undefined) return cached;
      const result = await fn();
      set(cacheKey, result);
      return result;
    },
  };
}
