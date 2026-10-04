import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

import { choosePrimary, foldTapbacks } from "./internal";

const phases = ["messages", "attachments", "scheduled", "suggestions", "events", "open", "state", "drafts", "presence", "finalize"] as const;
const phase = v.union(...phases.map((name) => v.literal(name)));

export const deleteChat = internalMutation({
  args: { chatGuid: v.string(), phase: v.optional(phase), cursor: v.optional(v.string()) },
  returns: v.object({ done: v.boolean(), phase: v.optional(phase), cursor: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const alias = await ctx.db.query("comma_chat_aliases")
      .withIndex("by_chatGuid", (q) => q.eq("chatGuid", args.chatGuid)).unique();
    if (!alias) return { done: true };
    const conversationId = alias.conversationId;
    const aliases = await ctx.db.query("comma_chat_aliases")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).collect();
    const siblings = aliases.filter((row) => row.chatGuid !== args.chatGuid);
    const current = args.phase ?? "messages";
    const pagination = { numItems: 100, cursor: args.cursor ?? null };
    const next = (page: { isDone: boolean; continueCursor: string }) => page.isDone
      ? { done: false, phase: phases[phases.indexOf(current) + 1]! }
      : { done: false, phase: current, cursor: page.continueCursor };
    const messageExists = async (guid: string) => Boolean(await ctx.db.query("comma_messages")
      .withIndex("by_guid", (q) => q.eq("guid", guid)).unique());

    if (current === "messages") {
      const page = await ctx.db.query("comma_messages")
        .withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId)).paginate(pagination);
      const targets = new Set<string>();
      for (const row of page.page) {
        if (!siblings.length || row.chatGuid === args.chatGuid) {
          await ctx.db.delete(row._id);
          if (row.tapbackTargetGuid) targets.add(row.tapbackTargetGuid);
        }
      }
      for (const guid of targets) {
        const target = await ctx.db.query("comma_messages").withIndex("by_guid", (q) => q.eq("guid", guid)).unique();
        if (!target) continue;
        const tapbacks = await ctx.db.query("comma_messages")
          .withIndex("by_tapbackTargetGuid", (q) => q.eq("tapbackTargetGuid", guid)).collect();
        await ctx.db.patch(target._id, { reactions: foldTapbacks(tapbacks) });
      }
      return next(page);
    }
    if (current === "attachments") {
      const page = await ctx.db.query("comma_attachments")
        .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).paginate(pagination);
      for (const row of page.page) {
        if (!siblings.length || !await messageExists(row.messageGuid)) await ctx.db.delete(row._id);
      }
      return next(page);
    }
    if (current === "scheduled") {
      const page = await ctx.db.query("comma_scheduled").paginate(pagination);
      for (const row of page.page) {
        if (row.conversationId === conversationId && (!siblings.length || row.chatGuid === args.chatGuid)) await ctx.db.delete(row._id);
      }
      return next(page);
    }
    if (current === "suggestions" || current === "events" || current === "open") {
      const table = current === "suggestions" ? "comma_suggestions" : current === "events" ? "comma_triage_events" : "comma_triage_open";
      const page = await ctx.db.query(table).withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).paginate(pagination);
      for (const row of page.page) {
        const guid = "anchorGuid" in row ? row.anchorGuid : row.messageGuid;
        if (!siblings.length || !await messageExists(guid)) await ctx.db.delete(row._id);
      }
      return next(page);
    }
    if (current === "state" || current === "drafts" || current === "presence") {
      const table = current === "state" ? "comma_conversation_state" : current === "drafts" ? "comma_drafts" : "comma_presence";
      const page = await ctx.db.query(table).withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).paginate(pagination);
      for (const row of page.page) {
        if (!siblings.length) await ctx.db.delete(row._id);
        else if ("pinned" in row) await ctx.db.patch(row._id, {
          ...(row.dismissedUnrespondedGuid && !await messageExists(row.dismissedUnrespondedGuid) ? { dismissedUnrespondedGuid: undefined } : {}),
          ...(row.dismissedWaitingGuid && !await messageExists(row.dismissedWaitingGuid) ? { dismissedWaitingGuid: undefined } : {}),
        });
      }
      return next(page);
    }

    const conversation = await ctx.db.get(conversationId);
    await ctx.db.delete(alias._id);
    if (!conversation) return { done: true };
    if (!siblings.length) {
      await ctx.db.delete(conversationId);
      return { done: true };
    }
    // Only a visible surviving message can become the conversation preview.
    const history = ctx.db.query("comma_messages")
      .withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId)).order("desc");
    let newest = null;
    for await (const row of history) {
      if (!row.isTapback && !row.retracted) { newest = row; break; }
    }
    const primaryChatGuid = newest?.chatGuid ?? choosePrimary(siblings.map((row) => ({ chatGuid: row.chatGuid, lastMessageAt: 0 })));
    await ctx.db.patch(conversationId, {
      primaryChatGuid, chatGuids: siblings.map((row) => row.chatGuid).sort(),
      lastMessage: newest ? { guid: newest.guid, text: newest.text, dateCreated: newest.dateCreated,
        isFromMe: newest.isFromMe, senderName: newest.sender?.name ?? null, hasAttachments: newest.attachmentGuids.length > 0 } : undefined,
      lastMessageAt: newest?.dateCreated ?? 0, updatedAt: Date.now(),
    });
    return { done: true };
  },
});
