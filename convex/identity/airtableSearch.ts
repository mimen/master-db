import { v } from "convex/values";

import { action } from "../_generated/server";

import { requireIdentityKey } from "./key";

/**
 * Live search against Airtable's Humans table, for imsg's Contacts screen:
 * "search our existing contacts first, Airtable matches below." Unlike
 * airtableSync.ts (background, link_only, only touches people Milad already
 * has), this surfaces people he DOESN'T have yet too — the whole point is
 * finding someone in the growing community database who isn't in the
 * identity graph, so he can add them on purpose (see mutations.ts's
 * addPersonFromAirtable).
 *
 * Not cached/ingested — searched live each call. The Humans table is small
 * enough (~7k rows) that Airtable's own SEARCH() filter is plenty fast, and
 * this avoids storing data for records nobody ever chose to add.
 */

const AIRTABLE_BASE_ID = "app39VsA3z85GTMbT";
const HUMANS_TABLE_ID = "tbl6LptFEMKLaN0I9";

type AirtableRecord = {
  id: string;
  fields: {
    Name?: string;
    "Phone Number"?: string;
    "Email Address"?: string;
    "Email Address 2"?: string;
  };
};

// Airtable formulas don't have parameterized queries — escape single quotes
// and backslashes so a name like "O'Brien" can't break the formula (or, if
// unescaped, be used to inject arbitrary formula syntax).
export function airtableNameSearchFormula(needle: string): string {
  const escaped = needle.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `SEARCH(LOWER('${escaped}'), LOWER({Name}))`;
}

export const searchAirtableHumans = action({
  args: { key: v.string(), query: v.string() },
  handler: async (_ctx, { key, query }) => {
    requireIdentityKey(key);
    const needle = query.trim();
    if (needle.length < 2) return [];

    const apiKey = process.env.AIRTABLE_API_KEY;
    if (!apiKey) throw new Error("AIRTABLE_API_KEY not configured on this Convex deployment");

    const formula = airtableNameSearchFormula(needle);
    const params = new URLSearchParams({
      pageSize: "15",
      filterByFormula: formula,
    });
    for (const f of ["Name", "Phone Number", "Email Address", "Email Address 2"]) {
      params.append("fields[]", f);
    }

    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${HUMANS_TABLE_ID}?${params.toString()}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) throw new Error(`Airtable search failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { records: AirtableRecord[] };
    return body.records
      .map((r) => ({
        record_id: r.id,
        display_name: r.fields.Name ?? "",
        phone: r.fields["Phone Number"],
        email: r.fields["Email Address"] ?? r.fields["Email Address 2"],
      }))
      .filter((r) => r.display_name && (r.phone || r.email));
  },
});
