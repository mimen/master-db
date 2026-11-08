import { makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, query, type MutationCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { commandSuggestions, suggestionDoc } from "../schema/comma/validators";

import { aiExecutorStatus, imessageCapabilities } from "./bridgeState";
import { conversationPeople } from "./conversationInfo";
import { findConversation } from "./conversationLookup";
import { enqueueCommand } from "./enqueue";
import { resolveConversationNames } from "./names";

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

/**
 * Reply suggestions are ready before the user opens a DM with a known person: a fresh inbound message queues a
 * suggestions command for the AI lane once the thread has been quiet for `debounceMs`. A message older than
 * `freshMs` (history a backfill posts) never does. The AI process holds the daily cap.
 */
export const SUGGESTION_PRECOMPUTE = { debounceMs: 3000, freshMs: 10 * 60_000, aiFreshMs: 3 * 60_000 } as const;
const precomputeRef = makeFunctionReference<"mutation", { conversationId: Id<"comma_conversations">; messageGuid: string }, null>("comma/suggestions:precompute");

export async function schedulePrecompute(ctx: MutationCtx, messages: readonly Pick<Doc<"comma_messages">, "conversationId" | "guid" | "dateCreated" | "isFromMe">[]): Promise<void> {
  const newest = new Map<Id<"comma_conversations">, (typeof messages)[number]>();
  for (const message of messages) {
    if (message.isFromMe || message.dateCreated < Date.now() - SUGGESTION_PRECOMPUTE.freshMs) continue;
    if ((newest.get(message.conversationId)?.dateCreated ?? -Infinity) < message.dateCreated) newest.set(message.conversationId, message);
  }
  for (const { conversationId, guid } of newest.values()) {
    await ctx.scheduler.runAfter(SUGGESTION_PRECOMPUTE.debounceMs, precomputeRef, { conversationId, messageGuid: guid });
  }
}

export const precompute = internalMutation({
  args: { conversationId: v.id("comma_conversations"), messageGuid: v.string() },
  returns: v.null(),
  handler: async (ctx, { conversationId, messageGuid }) => {
    const conversation = await ctx.db.get(conversationId);
    // Only the conversation's newest message, still unanswered, gets a shelf.
    if (!conversation?.lastMessage || conversation.lastMessage.guid !== messageGuid || conversation.lastMessage.isFromMe) return null;
    if (conversation.isGroup || conversation.participants.length !== 1 || conversation.isSpam) return null;
    const ai = await aiExecutorStatus(ctx);
    // A stopped AI process never says so; without a recent heartbeat, precomputes would pile up for its return.
    if (!ai?.connected || !ai.capabilities.suggestions || ai.lastSeenAt < Date.now() - SUGGESTION_PRECOMPUTE.aiFreshMs) return null;
    if (!resolveConversationNames(conversation, (await conversationPeople(ctx, conversation)).map(({ person }) => person)).known) return null;
    const shelf = await ctx.db.query("comma_suggestions")
      .withIndex("by_conversation_model", (q) => q.eq("conversationId", conversationId).eq("model", "opus")).unique();
    if (shelf?.anchorGuid === messageGuid) return null;
    await enqueueCommand(ctx, { clientKey: `precompute:${conversationId}:${messageGuid}`, conversationId,
      payload: { kind: "suggestions", model: "opus", refresh: false, precompute: true } });
    return null;
  },
});

export const getSuggestions = query({
  args: { conversationId: v.optional(v.id("comma_conversations")), chatGuid: v.optional(v.string()), model: suggestionModel },
  returns: v.union(suggestionDoc, v.null()),
  handler: async (ctx, { model, ...ref }) => {
    await assertAllowed(ctx);
    const conversation = await findConversation(ctx, ref);
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
  returns: v.object({ suggestions: v.boolean(), reactionSuggestions: v.boolean(), agentHeartbeatAt: v.union(v.number(), v.null()) }),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    const ai = await aiExecutorStatus(ctx);
    const runner = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", "agent")).unique();
    const suggestions = (ai?.connected ?? false) && (ai?.capabilities.suggestions ?? false);
    return {
      suggestions,
      // Clients from before per-route reaction support read this; a current client asks the route.
      reactionSuggestions: suggestions && ((await imessageCapabilities(ctx, { platform: "imessage" }))?.privateApi ?? false),
      agentHeartbeatAt: runner && "updatedAt" in runner ? runner.updatedAt : null,
    };
  },
});
