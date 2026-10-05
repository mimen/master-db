import type { Priority } from "@/lib/identity";

/** "Favorite · P2 · 3 tags": what a collapsed CRM section shows. */
export function crmSummary(crm: { isFavorite: boolean; priority: Priority | undefined; tagCount: number; eventCount: number }): string {
  const parts = [
    crm.isFavorite ? "Favorite" : null,
    crm.priority !== undefined ? `P${crm.priority}` : null,
    crm.tagCount > 0 ? `${crm.tagCount} ${crm.tagCount === 1 ? "tag" : "tags"}` : null,
    crm.eventCount > 0 ? `${crm.eventCount} ${crm.eventCount === 1 ? "event" : "events"}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Not set";
}

/** The Priority dropdown, P1 (highest) to P5. "none" clears it. */
export const PRIORITY_OPTIONS = [
  { value: "none", label: "None" },
  { value: "1", label: "Highest" },
  { value: "2", label: "High" },
  { value: "3", label: "Medium" },
  { value: "4", label: "Low" },
  { value: "5", label: "Lowest" },
] as const;

export type PriorityOption = (typeof PRIORITY_OPTIONS)[number]["value"];

export function priorityOption(priority: Priority | undefined): PriorityOption {
  return priority === undefined ? "none" : (String(priority) as PriorityOption);
}

export function priorityFromOption(option: PriorityOption): Priority | null {
  return option === "none" ? null : Number(option);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A linked event's date tile and time line, in local time. Null when the event has no date. */
export function eventTile(startDate: string | undefined): { day: string; month: string; time: string; long: string } | null {
  if (!startDate) return null;
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(startDate);
  const local = dateOnly ? new Date(`${startDate}T00:00:00`) : d;
  const h = local.getHours();
  const time = dateOnly ? "" : `${h % 12 || 12}:${String(local.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const day = String(local.getDate());
  const month = MONTHS[local.getMonth()];
  return { day, month, time, long: `${DAYS[local.getDay()]}, ${month} ${day}${time ? `, ${time}` : ""}` };
}

/** "Edited Sep 30" under the notes. */
export function editedLine(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `Edited ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
