import { v } from "convex/values";

import { mutation } from "../_generated/server";

import { ingestOneCard } from "./ingestContacts";
import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * The v1 "Add Contact" action for an unknown handle in imsg: creates a
 * Convex-only person for a raw phone/email with no existing identity match.
 * Deliberately does NOT write to Apple Contacts — that's a distinct,
 * deferred capability (see convex/identity/ingestContacts.ts's docstring and
 * the phase-3 write-back/sync plan). If Apple Contacts later gains this same
 * handle, resolveIdentities's cross-source matching links the two into one
 * person on the next run — no special-casing needed here.
 */
export const createPerson = mutation({
  args: { handle: v.string(), display_name: v.optional(v.string()) },
  handler: async (ctx, { handle, display_name }) => {
    const trimmed = handle.trim();
    const normalized = normalizePhone(trimmed) || normalizeEmail(trimmed) || trimmed;
    const kind: "phone" | "email" = normalizePhone(trimmed) ? "phone" : "email";

    const existingIdentity = await ctx.db
      .query("identities")
      .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
      .first();
    if (existingIdentity?.person_id) {
      return { created: false as const, personId: existingIdentity.person_id };
    }

    const now = new Date().toISOString();
    const personId = await ctx.db.insert("people", {
      display_name,
      normalized_phones: kind === "phone" ? [normalized] : [],
      normalized_emails: kind === "email" ? [normalized] : [],
      identity_count: 1,
      message_count: 0,
      is_self: false,
      auto_clustered: false, // hand-created via "Add Contact", not resolver/source-ingest inferred
      created_at: now,
      updated_at: now,
    });
    await ctx.db.insert("identities", {
      person_id: personId,
      kind,
      value: trimmed,
      normalized,
      network: undefined,
      display_name,
      message_count: 0,
      chat_count: 0,
      is_self: false,
      source: "manual",
      first_seen_at: now,
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    });
    return { created: true as const, personId };
  },
});

/**
 * Explicit "Add Contact from Airtable" — the Contacts screen's search shows
 * Airtable matches below your existing contacts; tapping one calls this.
 * Unlike airtableSync.ts's background cron (link_only, enrich-only), this
 * is a deliberate per-person action, so it's allowed to create a new person
 * when there's no existing match — Milad chose this specific human on
 * purpose, this isn't the cron guessing everyone in a growing database
 * belongs in his graph.
 */
export const addPersonFromAirtable = mutation({
  args: {
    record_id: v.string(),
    display_name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { record_id, display_name, phone, email }) => {
    const result = await ingestOneCard(
      ctx,
      "airtable_human",
      {
        display_name,
        phones: phone ? [phone] : [],
        emails: email ? [email] : [],
        airtable_record_id: record_id,
      },
      false,
    );
    if (result.outcome === "skipped_no_handles" || result.outcome === "skipped_no_match") {
      // skipped_no_match can't actually happen with link_only=false, but
      // the discriminated union doesn't know that statically.
      throw new Error("Can't add a contact with no phone or email");
    }
    return { personId: result.personId };
  },
});
