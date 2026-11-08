import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

import { findByChatGuid } from "./conversationLookup";

export const setGroupPhoto = internalMutation({
  args: { chatGuid: v.string(), guid: v.union(v.string(), v.null()), storageId: v.optional(v.id("_storage")) },
  returns: v.boolean(),
  handler: async (ctx, { chatGuid, guid, storageId }) => {
    if (Boolean(guid) !== Boolean(storageId)) throw new Error("Group photo requires both GUID and storage id");
    const conversation = await findByChatGuid(ctx, { platform: "imessage", accountId: null }, chatGuid);
    if (!conversation?.isGroup) return false;
    if (storageId && !await ctx.db.system.get(storageId)) throw new Error("Photo storage file not found");
    await ctx.db.patch(conversation._id, {
      groupPhotoGuid: guid || undefined, groupPhotoStorageId: storageId, hasGroupPhoto: Boolean(guid),
    });
    return true;
  },
});
