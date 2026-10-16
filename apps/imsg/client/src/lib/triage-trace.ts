/**
 * A short ring of what ⌘E and selection changes did, kept in localStorage (`imsg.triageTrace`) so a
 * report from the desktop app ("⌘E showed Select a conversation") can be read back from disk.
 * No message text: guids are truncated and names are omitted.
 */
const KEY = "imsg.triageTrace";
const MAX = 40;

export type TriageTraceEvent =
  | { readonly kind: "settle-key"; readonly guid: string; readonly lens: string; readonly action: string; readonly next: string | null }
  | { readonly kind: "advance"; readonly from: string; readonly to: string | null; readonly reason: string }
  | { readonly kind: "clear"; readonly via: string }
  // Modifier chords only, so typed text is never recorded.
  | { readonly kind: "key"; readonly combo: string; readonly code: string; readonly command: string | null }
  | { readonly kind: "menu"; readonly command: string };

function short(guid: string | null): string | null {
  return guid === null ? null : guid.slice(-6);
}

export function traceTriage(event: TriageTraceEvent): void {
  const store = typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  if (!store) return;
  try {
    const entry = {
      at: new Date().toISOString(),
      ...event,
      ...("guid" in event ? { guid: short(event.guid) } : {}),
      ...("next" in event ? { next: short(event.next) } : {}),
      ...("from" in event ? { from: short(event.from), to: short(event.to) } : {}),
    };
    const ring = JSON.parse(store.getItem(KEY) ?? "[]") as unknown[];
    ring.push(entry);
    store.setItem(KEY, JSON.stringify(ring.slice(-MAX)));
  } catch {
    // A full or blocked store only loses the trace.
  }
}
