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
