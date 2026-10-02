/**
 * Click-to-render timing for opening a conversation, read from a real session:
 * `window.__commaTimings` on web, plus one `console.info` line per open.
 *
 * `firstMs` is press until the first messages paint (from the thread cache or
 * the network); `freshMs` is press until the server's window paints.
 */
export interface OpenTiming {
  chat: string;
  at: string;
  source: "cache" | "network";
  firstMs: number;
  freshMs: number | null;
}

const MAX_ENTRIES = 50;
const STALE_START_MS = 10_000;

const starts = new Map<string, number>();
const open = new Map<string, OpenTiming>();
export const openTimings: OpenTiming[] = [];

if (typeof window !== "undefined") Object.assign(window, { __commaTimings: openTimings });

/** Record the press. A later call for the same chat keeps the earlier press. */
export function markOpenStart(chat: string, now = performance.now()): void {
  const start = starts.get(chat);
  if (start !== undefined && now - start < STALE_START_MS) return;
  starts.set(chat, now);
  open.delete(chat);
}

/** Record that messages painted; `fresh` means they came from the server. */
export function markOpenRendered(chat: string, fresh: boolean, now = performance.now()): void {
  const start = starts.get(chat);
  if (start === undefined) return;
  const elapsed = Math.round(now - start);
  let entry = open.get(chat);
  if (!entry) {
    entry = {
      chat,
      at: new Date().toISOString(),
      source: fresh ? "network" : "cache",
      firstMs: elapsed,
      freshMs: null,
    };
    open.set(chat, entry);
    openTimings.push(entry);
    if (openTimings.length > MAX_ENTRIES) openTimings.shift();
  }
  if (!fresh) return;
  entry.freshMs = elapsed;
  starts.delete(chat);
  open.delete(chat);
  console.info(
    `[comma] open ${chat}: first paint ${entry.firstMs}ms (${entry.source}), fresh ${entry.freshMs}ms`,
  );
}

/** Run after the next paint, so a mark covers React's commit and layout. */
export function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === "undefined") return fn();
  requestAnimationFrame(() => setTimeout(fn, 0));
}
