import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

import { normalizeEmail, normalizePhone } from "./normalize";

/**
 * Hard-delete a person and every identity pointing at them, resolved by one of
 * their handles (phone/email). Internal-only, no undo — for removing test rows
 * or a genuinely bogus person, not a user-facing feature. Returns what it
 * removed so a one-off `convex run` reports cleanly.
 */
export const deletePersonByHandle = internalMutation({
  args: { handle: v.string() },
  handler: async (ctx, { handle }) => {
    const normalized = normalizePhone(handle) || normalizeEmail(handle) || handle.trim();
    const match = await ctx.db
      .query("identities")
      .withIndex("by_normalized", (q) => q.eq("normalized", normalized))
      .first();
    if (!match?.person_id) return { deleted: false as const, reason: "no person for handle" };

    const personId = match.person_id;
    const identities = await ctx.db
      .query("identities")
      .withIndex("by_person", (q) => q.eq("person_id", personId))
      .collect();
    for (const i of identities) await ctx.db.delete(i._id);
    await ctx.db.delete(personId);
    return { deleted: true as const, personId, identitiesDeleted: identities.length };
  },
});
