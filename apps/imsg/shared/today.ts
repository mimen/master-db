import type { ChatFlags } from "./types";

/** The Today queue's rules shared by Convex, the Mini and the client. See docs/today-queue.md. */

export type DayKey = string & { readonly __brand: "DayKey" };

export const TODAY_TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 86_400_000;

/**
 * A build reads up to `needsYou` Needs you threads: the newest `recent` under `recentMaxAgeMs`, then the rest of the
 * backlog least recently read first, so the deep inbox rotates through. Plus the newest `waiting` Waiting threads.
 */
export const TODAY_LIMITS = {
  groups: 6, items: 50, messages: 30,
  needsYou: 150, recent: 100, recentMaxAgeMs: 30 * DAY_MS,
  waiting: 50, waitingMaxAgeMs: 30 * DAY_MS,
} as const;

/** The reduce's reserved group for threads that need no reply. The client gives it Settle all. */
export const TODAY_SETTLE_GROUP = "settle";

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: TODAY_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

function wall(at: number): { year: number; month: number; day: number; utc: number } {
  const parts = Object.fromEntries(wallClock.formatToParts(at).map((p) => [p.type, Number(p.value)]));
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts;
  return { year, month, day, utc: Date.UTC(year, month - 1, day, hour, minute, second) };
}

/** The LA calendar day containing `now` and its local midnight. DST changes at 2 AM, so midnight is never ambiguous. */
export function todayWindow(now: number): { day: DayKey; start: number } {
  const { year, month, day } = wall(now);
  const guess = Date.UTC(year, month - 1, day);
  const offset = (at: number) => wall(at).utc - Math.floor(at / 1000) * 1000;
  const start = guess - offset(guess - offset(guess));
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { day: key as DayKey, start };
}

/** Build-input rule: known, not spam, message-based. Needs you at any age; Waiting under 30 days. */
export function todayCandidateState(
  c: { flags: ChatFlags; known: boolean; isSpam: boolean; lastMessageAt: number },
  now: number,
): "needsYou" | "waiting" | null {
  if (!c.known || c.isSpam) return null;
  if (c.flags.unresponded) return "needsYou";
  return c.flags.waiting && now - c.lastMessageAt < TODAY_LIMITS.waitingMaxAgeMs ? "waiting" : null;
}
