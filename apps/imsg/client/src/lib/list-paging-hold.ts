import { useSyncExternalStore } from "react";

let holds = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Holds the next conversation-list page while a thread's first page is in flight, so the thread
 * does not share the socket with a 100-row page. Returns the release; releasing twice is a no-op.
 */
export function holdListPaging(): () => void {
  holds++;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    notify();
  };
}

export function useListPagingHeld(): boolean {
  return useSyncExternalStore(subscribe, () => holds > 0, () => false);
}

export function listPagingHeld(): boolean {
  return holds > 0;
}
