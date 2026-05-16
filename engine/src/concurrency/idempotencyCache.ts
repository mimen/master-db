import { LRUCache } from "lru-cache";

export interface IdempotencyKey {
  key: string | undefined;
  entity_ref: string;
  route: string;
}

export interface IdempotencyCache {
  runOnce<T>(key: IdempotencyKey, fn: () => Promise<T>): Promise<T>;
}

export function createIdempotencyCache(opts: {
  ttlMs: number;
  max?: number;
}): IdempotencyCache {
  // Wrap stored values in a box so lru-cache v11's V extends {} constraint is satisfied
  // even if fn() returns null. The undefined-return edge case is documented below.
  type Box = { v: unknown };
  // Use Date as perf provider: vitest fake timers replace the globalThis.performance
  // object entirely (staling lru-cache's module-load-time reference), but Date.now
  // is stubbed by reference and stays current under vi.useFakeTimers().
  const lru = new LRUCache<string, Box>({
    max: opts.max ?? 5000,
    ttl: opts.ttlMs,
    perf: Date,
  });
  return {
    async runOnce<T>(k: IdempotencyKey, fn: () => Promise<T>): Promise<T> {
      if (!k.key) return fn();
      const cacheKey = `${k.route}|${k.entity_ref}|${k.key}`;
      const cached = lru.get(cacheKey);
      // Note: if fn() ever returns undefined, cached.v would be undefined and
      // we'd re-run fn(). At current call sites (HTTP handlers returning objects),
      // undefined is never a real return value, so this is safe.
      if (cached !== undefined) return cached.v as T;
      const result = await fn();
      lru.set(cacheKey, { v: result });
      return result;
    },
  };
}
