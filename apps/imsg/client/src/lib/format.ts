import { format } from "date-fns/format";
import { isSameDay } from "date-fns/isSameDay";
import { isSameWeek } from "date-fns/isSameWeek";
import { isToday } from "date-fns/isToday";
import { isYesterday } from "date-fns/isYesterday";
import { differenceInCalendarDays } from "date-fns/differenceInCalendarDays";

export function formatListTimestamp(ms: number): string {
  const d = new Date(ms);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  if (isSameWeek(d, new Date())) return format(d, "EEEE");
  return format(d, "M/d/yy");
}

export function formatDayDivider(ms: number): string {
  const d = new Date(ms);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, MMMM d");
}

/** A thread's date separator: the day, then the time its first message arrived ("Friday 8:12 PM"). */
export function formatThreadTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = format(d, "h:mm a");
  const days = differenceInCalendarDays(now, d);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${format(d, "EEEE")} ${time}`;
  return format(d, "EEE, MMM d 'at' h:mm a");
}

/** The read receipt's time: a clock time today, a weekday this week, else a date ("Read Friday"). */
export function formatReceiptTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const days = differenceInCalendarDays(now, d);
  if (days === 0) return format(d, "h:mm a");
  if (days === 1) return "Yesterday";
  if (days < 7) return format(d, "EEEE");
  return format(d, "MMM d");
}

export function formatBubbleTime(ms: number): string {
  return format(new Date(ms), "h:mm a");
}

export function sameDay(a: number, b: number): boolean {
  return isSameDay(new Date(a), new Date(b));
}

export function initials(name: string): string {
  // Only letter-bearing words make a monogram; phone-number / short-code names
  // have none, so they fall back to "#" instead of garbage like "(4".
  const parts = name.trim().split(/\s+/).filter((p) => /[a-z]/i.test(p));
  if (parts.length === 0) return "#";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "#";
}

