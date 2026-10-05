import type { ScheduledMessage, ScheduledMessageStatus } from "@shared/types";

export interface ScheduledGroup {
  readonly key: string;
  readonly title: string;
  readonly items: readonly ScheduledMessage[];
}

const NOT_SENT: ReadonlySet<ScheduledMessageStatus> = new Set(["failed", "interrupted", "expired"]);

export function isNotSent(status: ScheduledMessageStatus): boolean {
  return NOT_SENT.has(status);
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Tomorrow", a weekday inside the coming week, else "Oct 12". */
export function scheduledDayTitle(ms: number, now: Date = new Date()): string {
  const today = startOfDay(now.getTime());
  const day = startOfDay(ms);
  const days = Math.round((day - today) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const d = new Date(ms);
  if (days > 1 && days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The Scheduled pane's sections: anything that failed to go out first as
 * "Not sent", then the queue by send day, then what already went out.
 */
export function groupScheduled(items: readonly ScheduledMessage[], now: Date = new Date()): ScheduledGroup[] {
  const sorted = [...items].sort((a, b) => a.sendAt - b.sendAt);
  const notSent = sorted.filter((item) => isNotSent(item.status));
  const sent = sorted.filter((item) => item.status === "complete");
  const byDay = new Map<number, ScheduledMessage[]>();
  for (const item of sorted) {
    if (isNotSent(item.status) || item.status === "complete") continue;
    const day = startOfDay(item.sendAt);
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  return [
    ...(notSent.length > 0 ? [{ key: "not-sent", title: "Not sent", items: notSent }] : []),
    ...[...byDay].map(([day, dayItems]) => ({ key: `day-${day}`, title: scheduledDayTitle(day, now), items: dayItems })),
    ...(sent.length > 0 ? [{ key: "sent", title: "Sent", items: sent }] : []),
  ];
}
