import type { ScheduledMessageStatus } from "@shared/types";

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

export function scheduledStatusLabel(status: ScheduledMessageStatus): string {
  switch (status) {
    case "pending":
      return "Scheduled";
    case "in-progress":
      return "Sending…";
    case "complete":
      return "Sent";
    case "failed":
      return "Failed";
    case "interrupted":
      return "Interrupted";
    case "expired":
      return "Expired";
  }
}

export interface ScheduleInputParts {
  date: string;
  time: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function scheduleInputParts(timestamp: number): ScheduleInputParts {
  const date = new Date(timestamp);
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export type ParseScheduleResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export function parseScheduleInput(date: string, time: string, now = Date.now()): ParseScheduleResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return { ok: false, error: "Use YYYY-MM-DD and HH:MM" };
  }
  const [yearText, monthText, dayText] = date.split("-");
  const [hourText, minuteText] = time.split(":");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return { ok: false, error: "Choose a valid date and time" };
  }
  const value = parsed.getTime();
  if (value <= now) return { ok: false, error: "Choose a future date and time" };
  return { ok: true, value };
}
