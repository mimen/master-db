import type { EventSuggestion } from "@shared/types";

/**
 * Google Calendar's event template page, prefilled from a detected scheduling
 * agreement. Opening it is the whole integration: Milad reviews and saves in
 * Google's own UI, so the app never needs calendar credentials.
 *
 * `start` is local wall-clock time; the dates param stays timezone-less so
 * Google applies the calendar's own zone.
 */

const START_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function parseEventStart(start: string): Date | null {
  const match = start.match(START_RE);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const parsed = new Date(year!, month! - 1, day!, hour!, minute!);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function calendarTemplateUrl(event: EventSuggestion): string | null {
  const start = parseEventStart(event.start);
  if (!start) return null;
  const end = new Date(start.getTime() + event.durationMinutes * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${compact(start)}/${compact(end)}`,
  });
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Short pill label, e.g. "Sun Aug 31, 6:00 PM". */
export function eventShelfLabel(event: EventSuggestion): string {
  const start = parseEventStart(event.start);
  if (!start) return event.start;
  return start.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function compact(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}
