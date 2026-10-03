import { v } from "convex/values";

import { internalMutation, type QueryCtx } from "../_generated/server";
import { normalizeEmail, normalizePhone } from "../identity/normalize";

export async function personForAddress(ctx: Pick<QueryCtx, "db">, address: string) {
  const normalized = normalizeEmail(address) || normalizePhone(address) || address.trim();
  const identities = await ctx.db.query("identities")
    .withIndex("by_normalized", (q) => q.eq("normalized", normalized)).collect();
  for (const identity of identities) {
    if (!identity.person_id) continue;
    const person = await ctx.db.get(identity.person_id);
    if (person && !person.merged_into) return person;
  }
  return null;
}

export const setContactPhoto = internalMutation({
  args: { address: v.string(), storageId: v.id("_storage"), hash: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { address, storageId, hash }) => {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid photo SHA-256");
    const person = await personForAddress(ctx, address);
    if (!person) return false;
    if (person.photoHash === hash && person.photoStorageId) return true;
    if (!await ctx.db.system.get(storageId)) throw new Error("Photo storage file not found");
    await ctx.db.patch(person._id, {
      photoStorageId: storageId, photoHash: hash, updated_at: new Date().toISOString(),
    });
    return true;
  },
});
