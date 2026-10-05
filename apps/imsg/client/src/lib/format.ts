import { format } from "date-fns/format";
import { isSameDay } from "date-fns/isSameDay";
import { isSameWeek } from "date-fns/isSameWeek";
import { isToday } from "date-fns/isToday";
import { isYesterday } from "date-fns/isYesterday";

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

/** Time since `ms`, compact: 14m, 2h, 3d, 2w. Under a minute reads "now"; a year or more reads in years. */
export function formatAge(ms: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 365)}y`;
}
