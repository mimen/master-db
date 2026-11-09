import type { ConversationId, Platform, ScheduledMessageStatus } from "@shared/types";

/** A row on the Scheduled screen: BlueBubbles' own for iMessage (`bbId`), or one Comma schedules for Slack and Gmail. */
export interface ScheduledItem {
  /** The Convex row's id. */
  id: string;
  bbId?: number;
  platform: Platform;
  /** Absent until the bridge has mirrored the scheduled message's chat. */
  conversationId?: ConversationId;
  chatGuid?: string;
  chatName: string;
  /** An email's subject. */
  subject?: string;
  text: string;
  sendAt: number;
  status: ScheduledMessageStatus;
  error: string | null;
  sentAt: number | null;
}

/** `Sam Lee <sam@venue.test>` reads as Sam Lee; a bare address as itself. */
export function recipientName(recipient: string): string {
  return recipient.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || recipient.replace(/[<>]/g, "").trim();
}

/** Quick relative schedule targets, iMessage "Send Later" style. */
export function scheduleOptions(now = new Date()): Array<{ label: string; at: number }> {
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  const tomorrowAm = new Date(now);
  tomorrowAm.setDate(now.getDate() + 1);
  tomorrowAm.setHours(9, 0, 0, 0);
  const opts = [
    { label: "In 1 hour", at: now.getTime() + 3_600_000 },
    { label: "In 3 hours", at: now.getTime() + 3 * 3_600_000 },
  ];
  if (tonight.getTime() > now.getTime()) opts.push({ label: "Tonight, 8 PM", at: tonight.getTime() });
  opts.push({ label: "Tomorrow, 9 AM", at: tomorrowAm.getTime() });
  return opts;
}

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

/** Scheduled messages that have not gone out yet: the sidebar footer's count. */
export function pendingScheduledCount(rows: readonly { status: ScheduledMessageStatus }[] | undefined): number {
  return rows?.filter((row) => row.status === "pending" || row.status === "in-progress").length ?? 0;
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
    case "interrupted":
    case "expired":
      return "Not sent";
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
