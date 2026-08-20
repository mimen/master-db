import type { StateFilter } from "@shared/types";

/**
 * Bus for requesting an inbox state filter from outside the Messages screen —
 * the desktop rail is rendered on Contacts too, so its Needs reply / Waiting /
 * All messages items need to reach the Messages screen's filter state. Both
 * tabs stay mounted (lazy: false), so the listener is live even while
 * Contacts is foregrounded; the caller navigates to Messages afterwards.
 */
type Listener = (state: StateFilter) => void;
const listeners = new Set<Listener>();

/** Returns true when the Messages screen applied it (caller then navigates). */
export function requestInboxFilter(state: StateFilter): boolean {
  if (listeners.size === 0) return false;
  for (const listener of listeners) listener(state);
  return true;
}

export function onRequestInboxFilter(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
