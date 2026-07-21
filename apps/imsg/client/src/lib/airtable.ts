/** AUF's Airtable base — same IDs the identity graph's ingest/search actions use (convex/identity/airtableSync.ts, airtableSearch.ts). */
const AIRTABLE_BASE_ID = "app39VsA3z85GTMbT";
const AIRTABLE_HUMANS_TABLE_ID = "tbl6LptFEMKLaN0I9";

export function airtableRecordUrl(recordId: string): string {
  return `https://airtable.com/${AIRTABLE_BASE_ID}/${AIRTABLE_HUMANS_TABLE_ID}/${recordId}`;
}
