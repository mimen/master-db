import { v, type Infer } from "convex/values";

import { internalMutation, query } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { commandSuggestions, suggestionDoc } from "../schema/comma/validators";

const suggestionModel = commandSuggestions.fields.selectedModel;

const CLEAR_KEY = "suggestion_learning_cleared";

export const shelfUpdate = v.union(
  v.object({
    kind: v.literal("publish"), conversationId: v.id("comma_conversations"),
    model: suggestionModel, suggestions: commandSuggestions, startedAt: v.number(),
  }),
  v.object({ kind: v.literal("clear"), clientKey: v.string(), clearedAt: v.number() }),
);
export type ShelfUpdate = Infer<typeof shelfUpdate>;

export const publish = internalMutation({
  args: { update: shelfUpdate },
  returns: v.boolean(),
  handler: async (ctx, { update }) => {
    const cleared = await ctx.db.query("comma_sync_state")
      .withIndex("by_key", (q) => q.eq("key", CLEAR_KEY)).unique();
    if (update.kind === "clear") {
      if (cleared?.cursor === update.clientKey) return true;
      for (const shelf of await ctx.db.query("comma_suggestions").collect()) await ctx.db.delete(shelf._id);
      const row = { key: CLEAR_KEY, cursor: update.clientKey, lastEventAt: update.clearedAt, updatedAt: Date.now() };
      if (cleared) await ctx.db.replace(cleared._id, row);
      else await ctx.db.insert("comma_sync_state", row);
      return true;
    }
    const { model, conversationId, suggestions, startedAt } = update;
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || suggestions.stale || !suggestions.basedOnMessageGuid ||
      suggestions.selectedModel !== model || conversation.lastMessage?.isFromMe ||
      conversation.lastMessage?.guid !== suggestions.basedOnMessageGuid ||
      (cleared?.lastEventAt !== undefined && startedAt <= cleared.lastEventAt)) return false;
    const { basedOnMessageGuid, generatedAt, stale: _stale, ...payload } = suggestions;
    const shelves = await ctx.db.query("comma_suggestions")
      .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).collect();
    const matching = shelves.filter((row) => (row.model ?? "opus") === model);
    if (matching.some((row) => row.createdAt > generatedAt)) return false;
    const row = { conversationId, model, anchorGuid: basedOnMessageGuid, payload, createdAt: generatedAt };
    if (matching[0]) await ctx.db.replace(matching[0]._id, row);
    else await ctx.db.insert("comma_suggestions", row);
    for (const duplicate of matching.slice(1)) await ctx.db.delete(duplicate._id);
    return true;
  },
});

export const getSuggestions = query({
  args: { chatGuid: v.string(), model: suggestionModel },
  returns: v.union(suggestionDoc, v.null()),
  handler: async (ctx, { chatGuid, model }) => {
    await assertAllowed(ctx);
    const alias = await ctx.db.query("comma_chat_aliases")
      .withIndex("by_chatGuid", (q) => q.eq("chatGuid", chatGuid)).unique();
    const conversation = alias ? await ctx.db.get(alias.conversationId) : null;
    if (!conversation?.lastMessage || conversation.lastMessage.isFromMe) return null;
    const row = await ctx.db.query("comma_suggestions")
      .withIndex("by_conversation_model", (q) => q.eq("conversationId", conversation._id).eq("model", model)).unique();
    const legacy = !row && model === "opus" ? await ctx.db.query("comma_suggestions")
      .withIndex("by_conversation_model", (q) => q.eq("conversationId", conversation._id).eq("model", undefined)).unique() : null;
    const shelf = row ?? legacy;
    return shelf?.anchorGuid === conversation.lastMessage.guid && shelf.payload.selectedModel === model ? shelf : null;
  },
});

export const aiStatus = query({
  args: {},
  returns: v.object({ suggestions: v.boolean(), reactionSuggestions: v.boolean() }),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    const state = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", "mini")).unique();
    return { suggestions: state?.suggestions ?? false, reactionSuggestions: state?.reactionSuggestions ?? false };
  },
});
