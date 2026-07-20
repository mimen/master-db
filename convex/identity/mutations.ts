import { v } from "convex/values";

import { mutation } from "../_generated/server";

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
