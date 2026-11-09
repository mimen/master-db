import { useSyncExternalStore } from "react";

/**
 * Today's "to go", the one count every badge shows: the home-screen icon, the dock and the phone's Messages tab.
 * The Messages list computes it and publishes it here; undefined until Today's plan first loads.
 */
let count: number | undefined;
const listeners = new Set<() => void>();

export function publishBadgeCount(next: number | undefined): void {
  if (next === count) return;
  count = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useBadgeCount(): number | undefined {
  return useSyncExternalStore(subscribe, () => count, () => count);
}
