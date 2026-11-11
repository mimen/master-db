import type { ChatLater, ChatSummary } from "@shared/types";
import { formatScheduledWhen } from "@/lib/scheduled";

/** Later snoozes a conversation out of every queue; Follow up resurfaces one the user spoke last in if nobody answers. */
export type DeferKind = "later" | "followUp";

function at(now: Date, days: number, hour: number): number {
  const d = new Date(now);
  d.setDate(now.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** Monday 9 AM after this one. */
const nextWeek = (now: Date) => at(now, ((8 - now.getDay()) % 7) || 7, 9);

/** The quick times each menu offers. This evening drops out once 6 PM has passed. */
export function deferOptions(kind: DeferKind, now = new Date()): { label: string; at: number }[] {
  if (kind === "followUp") return [{ label: "In 2 days", at: at(now, 2, 9) }, { label: "Next week", at: nextWeek(now) }];
  const evening = at(now, 0, 18);
  return [
    { label: "Tomorrow 9am", at: at(now, 1, 9) },
    ...(evening > now.getTime() ? [{ label: "This evening", at: evening }] : []),
    { label: "Next week", at: nextWeek(now) },
  ];
}

/** Skip today returns a conversation at 6 AM, ahead of the 7:00 AM Today build, so tomorrow's queue can rank it. */
export const skipTodayAt = (now = new Date()): number => at(now, 1, 6);

export const shortDay = (ms: number) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

/** What Details says about a conversation's deferrals, one line each. */
export function laterLines(later: ChatLater | undefined, now = new Date()): string[] {
  if (!later) return [];
  const lines: string[] = [];
  if (later.snoozedUntil !== undefined) lines.push(`Snoozed until ${formatScheduledWhen(later.snoozedUntil, now)}`);
  if (later.returned) lines.push(later.returned.reason === "message" ? "Back: new reply" : `Snoozed until ${formatScheduledWhen(later.returned.until, now)}`);
  if (later.followUp?.due) lines.push(`No reply since ${shortDay(later.followUp.since)}`);
  else if (later.followUp) lines.push(`Follow up ${formatScheduledWhen(later.followUp.at, now)} if no reply`);
  return lines;
}

/** A conversation where someone else spoke last already needs a reply, so it has nothing to follow up. */
export const canFollowUp = (chat: ChatSummary): boolean => chat.lastMessage?.isFromMe === true;
