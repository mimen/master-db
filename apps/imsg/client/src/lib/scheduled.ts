/**
 * Pure formatting for app/scheduled.tsx's row timestamps:
 * "Today, 3:45 PM" / "Tomorrow, 9:00 AM" / "Nov 3, 9:00 AM".
 */
export function formatScheduledWhen(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
