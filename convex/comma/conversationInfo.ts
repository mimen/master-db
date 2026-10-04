import { v } from "convex/values";

import { query } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";

import { conversationKey } from "./conversationKey";
import { personForAddress } from "./photos";

const service = v.union(v.literal("iMessage"), v.literal("SMS"));

export const findChat = query({
  args: { address: v.string(), service: v.optional(service) },
  returns: v.union(v.null(), v.object({
    chatGuid: v.string(), service, isGroup: v.literal(false), participants: v.array(v.string()),
  })),
  handler: async (ctx, args) => {
    await assertAllowed(ctx);
    const key = conversationKey({ isGroup: false, primaryChatGuid: "", participants: [{ address: args.address, name: null }] });
    const conversation = await ctx.db.query("comma_conversations")
      .withIndex("by_conversationKey", (q) => q.eq("conversationKey", key)).unique();
    if (!conversation || conversation.isGroup || conversation.participants.length !== 1) return null;
    const aliases = await ctx.db.query("comma_chat_aliases")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id)).collect();
    const candidates = aliases.filter((alias) => args.service
      ? alias.service === args.service || (args.service === "SMS" && alias.service === "RCS")
      : ["iMessage", "SMS", "RCS"].includes(alias.service));
    candidates.sort((a, b) => Number(b.chatGuid === conversation.primaryChatGuid) - Number(a.chatGuid === conversation.primaryChatGuid) ||
      Number(b.service === "iMessage") - Number(a.service === "iMessage") || a.chatGuid.localeCompare(b.chatGuid));
    const chosen = candidates[0];
    return chosen ? { chatGuid: chosen.chatGuid, service: chosen.service === "iMessage" ? "iMessage" as const : "SMS" as const,
      isGroup: false as const, participants: conversation.participants.map((p) => p.address) } : null;
  },
});

export const chatInfo = query({
  args: { chatGuid: v.string() },
  returns: v.union(v.null(), v.object({
    guid: v.string(), displayName: v.union(v.string(), v.null()), isGroup: v.boolean(),
    participants: v.array(v.object({ address: v.string(), name: v.string(), is_favorite: v.optional(v.boolean()) })),
  })),
  handler: async (ctx, { chatGuid }) => {
    await assertAllowed(ctx);
    const alias = await ctx.db.query("comma_chat_aliases")
      .withIndex("by_chatGuid", (q) => q.eq("chatGuid", chatGuid)).unique();
    const conversation = alias ? await ctx.db.get(alias.conversationId) : null;
    if (!conversation) return null;
    const participants = await Promise.all(conversation.participants.map(async (participant) => {
      const person = await personForAddress(ctx, participant.address);
      return { address: participant.address, name: person?.display_name ?? participant.name ?? participant.address,
        ...(person?.is_favorite !== undefined ? { is_favorite: person.is_favorite } : {}) };
    }));
    return { guid: chatGuid, displayName: conversation.rawDisplayName || null, isGroup: conversation.isGroup, participants };
  },
});
