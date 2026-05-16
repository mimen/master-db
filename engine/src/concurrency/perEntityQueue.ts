type Task = () => Promise<unknown>;

interface EntityState {
  queue: Task[];
  draining: boolean;
}

export interface PerEntityQueue {
  enqueue(entity_ref: string, task: Task): Promise<unknown>;
  interrupt(entity_ref: string): void;
  isBusy(entity_ref: string): boolean;
  drainAll(): Promise<void>;
}

export function createPerEntityQueue(opts: {
  onInterrupt: (entity_ref: string) => Promise<void>;
}): PerEntityQueue {
  const map = new Map<string, EntityState>();

  function getOrCreate(entity_ref: string): EntityState {
    let s = map.get(entity_ref);
    if (!s) {
      s = { queue: [], draining: false };
      map.set(entity_ref, s);
    }
    return s;
  }

  async function drain(entity_ref: string): Promise<void> {
    const state = map.get(entity_ref);
    if (!state || state.draining) return;
    state.draining = true;
    try {
      while (state.queue.length > 0) {
        const task = state.queue.shift();
        if (!task) break;
        await task();
      }
    } finally {
      state.draining = false;
    }
  }

  return {
    enqueue(entity_ref, task) {
      const state = getOrCreate(entity_ref);
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const settled = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      state.queue.push(async () => {
        try {
          resolve(await task());
        } catch (e) {
          reject(e);
        }
      });
      void drain(entity_ref);
      return settled;
    },
    interrupt(entity_ref) {
      const state = map.get(entity_ref);
      if (!state) return;
      state.queue.length = 0;
      void opts.onInterrupt(entity_ref);
    },
    isBusy(entity_ref) {
      const state = map.get(entity_ref);
      if (!state) return false;
      return state.draining || state.queue.length > 0;
    },
    async drainAll() {
      while ([...map.values()].some((s) => s.queue.length > 0 || s.draining)) {
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}
