import { format, isSameDay, isSameWeek, isToday, isYesterday } from "date-fns";

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
