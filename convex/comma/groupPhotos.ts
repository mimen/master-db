import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

export const setGroupPhoto = internalMutation({
  args: { chatGuid: v.string(), guid: v.union(v.string(), v.null()), storageId: v.optional(v.id("_storage")) },
  returns: v.boolean(),
  handler: async (ctx, { chatGuid, guid, storageId }) => {
    if (Boolean(guid) !== Boolean(storageId)) throw new Error("Group photo requires both GUID and storage id");
    const alias = await ctx.db.query("comma_chat_aliases")
      .withIndex("by_chatGuid", (q) => q.eq("chatGuid", chatGuid)).unique();
    const conversation = alias ? await ctx.db.get(alias.conversationId) : null;
    if (!conversation?.isGroup) return false;
    if (storageId && !await ctx.db.system.get(storageId)) throw new Error("Photo storage file not found");
    await ctx.db.patch(conversation._id, {
      groupPhotoGuid: guid || undefined, groupPhotoStorageId: storageId, hasGroupPhoto: Boolean(guid),
    });
    return true;
  },
});
