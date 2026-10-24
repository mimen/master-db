import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import {
  agentAnswers, agentAttachment, agentChatState, agentChatSummary, agentDraftPlacement, agentEffort, agentEntry, agentItemDoc,
  pendingAgentCommand,
  type AgentChatSummary, type AgentCommand, type AgentDraftPlacement, type AgentEntry, type PendingAgentCommand, type PendingAgentCommandBody,
} from "../schema/comma/validators";

import { askTitle, chatPreview } from "./agentSummary";
import { sameSecret } from "./bridgeAuth";
import { recordedAttachments, writeAgentDraft } from "./drafts";
import { enqueueCommand } from "./outbox";

/**
 * The agent pane. The client asks, answers, and stops through the public mutations; the runner on
 * the Mini subscribes to pendingAgentCommands, claims them, and writes the transcript back through
 * the bridge ingest routes.
 */

async function requireChat(ctx: QueryCtx, chatId: Id<"comma_agent_chats">) {
  const chat = await ctx.db.get(chatId);
  if (!chat) throw new Error("Agent chat not found");
  return chat;
}

async function itemFor(ctx: QueryCtx, chatId: Id<"comma_agent_chats">, key: string) {
  return await ctx.db.query("comma_agent_items").withIndex("by_chat_key", (q) => q.eq("chatId", chatId).eq("key", key)).unique();
}

/** Existing keys are patched in place; new keys take the next ordinals in array order. A turn_end stamps the chat. */
async function upsertItems(ctx: MutationCtx, chatId: Id<"comma_agent_chats">, items: { key: string; entry: AgentEntry }[], now = Date.now()) {
  const last = await ctx.db.query("comma_agent_items").withIndex("by_chat_ordinal", (q) => q.eq("chatId", chatId)).order("desc").first();
  let ordinal = last?.ordinal ?? 0;
  for (const { key, entry } of items) {
    const existing = await itemFor(ctx, chatId, key);
    if (existing) await ctx.db.patch(existing._id, { entry, updatedAt: now });
    else await ctx.db.insert("comma_agent_items", { chatId, key, ordinal: ++ordinal, entry, createdAt: now, updatedAt: now });
  }
  if (items.some(({ entry }) => entry.kind === "turn_end")) await ctx.db.patch(chatId, { lastTurnEndedAt: now });
}

async function insertCommand(ctx: MutationCtx, chatId: Id<"comma_agent_chats">, command: AgentCommand) {
  await ctx.db.insert("comma_agent_commands", { chatId, command, status: "pending", createdAt: Date.now() });
}

const REOPENED = { settledAt: undefined, settledWithConversation: undefined };

/**
 * Settles a chat by what it is doing: an open question is dismissed and its turn stopped, a
 * finished chat's session closes, and a running turn carries on until it ends on its own.
 */
async function settleChat(ctx: MutationCtx, chat: Doc<"comma_agent_chats">, { withConversation }: { withConversation: boolean }) {
  const now = Date.now();
  await ctx.db.patch(chat._id, { settledAt: now, settledWithConversation: withConversation });
  switch (chat.state) {
    case "waiting_input":
      for await (const item of ctx.db.query("comma_agent_items").withIndex("by_chat_ordinal", (q) => q.eq("chatId", chat._id))) {
        if (item.entry.kind === "question" && item.entry.status === "pending") {
          await ctx.db.patch(item._id, { entry: { ...item.entry, status: "cancelled" }, updatedAt: now });
        }
      }
      await insertCommand(ctx, chat._id, { kind: "stop" });
      return;
    case "idle":
    case "interrupted":
    case "failed":
      if (chat.sessionId) await insertCommand(ctx, chat._id, { kind: "close" });
      return;
    case "pending":
    case "running":
      return;
  }
}

/**
 * A conversation settle settles every unsettled chat, marked so un-settle reopens them. Only this
 * settle's chats keep the mark: undoing a settle that closed nothing must not reopen an older one's.
 */
export async function settleConversationChats(ctx: MutationCtx, conversationId: Id<"comma_conversations">) {
  for (const chat of await chatsOf(ctx, conversationId)) {
    if (chat.settledAt === undefined) await settleChat(ctx, chat, { withConversation: true });
    else if (chat.settledWithConversation) await ctx.db.patch(chat._id, { settledWithConversation: false });
  }
}

/** Un-settle reopens the chats the latest conversation settle closed, the only ones still marked. */
export async function reopenConversationChats(ctx: MutationCtx, conversationId: Id<"comma_conversations">) {
  for (const chat of await chatsOf(ctx, conversationId)) {
    if (chat.settledWithConversation === true && chat.settledAt !== undefined) await ctx.db.patch(chat._id, REOPENED);
  }
}

/** Sending the draft a chat wrote settles that chat, edited or not. */
export async function settleDraftChat(ctx: MutationCtx, draft: Doc<"comma_drafts">) {
  const chat = draft.agentChatId ? await ctx.db.get(draft.agentChatId) : null;
  if (chat && chat.settledAt === undefined) await settleChat(ctx, chat, { withConversation: false });
}

async function chatsOf(ctx: QueryCtx, conversationId: Id<"comma_conversations">) {
  return await ctx.db.query("comma_agent_chats").withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).collect();
}

const PREVIEW_ITEMS = 40;

async function summarize(ctx: QueryCtx, chat: Doc<"comma_agent_chats">): Promise<AgentChatSummary> {
  const byOrdinal = () => ctx.db.query("comma_agent_items").withIndex("by_chat_ordinal", (q) => q.eq("chatId", chat._id));
  const newest = await byOrdinal().order("desc").take(PREVIEW_ITEMS);
  const first = chat.title === undefined ? (await byOrdinal().first())?.entry : undefined;
  const { _id, conversationId, state, model, effort, settledAt, seenAt, lastTurnEndedAt, createdAt, updatedAt } = chat;
  return {
    _id, conversationId, state, model, effort, settledAt, seenAt, lastTurnEndedAt, createdAt, updatedAt,
    title: chat.title ?? askTitle(first?.kind === "user" ? first.text : ""),
    preview: chatPreview(newest.map(({ entry }) => entry), state),
  };
}

async function summaries(ctx: QueryCtx, chats: Doc<"comma_agent_chats">[]) {
  return await Promise.all(chats.sort((a, b) => b.updatedAt - a.updatedAt).map((chat) => summarize(ctx, chat)));
}

/** The runner downloads a message's files, so it gets each one's URL instead of its storage id. */
async function withLinks(ctx: QueryCtx, command: AgentCommand): Promise<PendingAgentCommandBody> {
  if (command.kind !== "message") return command;
  const { attachments, ...rest } = command;
  if (!attachments) return rest;
  const links = await Promise.all(attachments.map(async ({ storageId, filename, mimeType, size }) =>
    ({ url: await ctx.storage.getUrl(storageId), filename, mimeType, size })));
  return { ...rest, attachments: links };
}

async function withChat(ctx: QueryCtx, row: Doc<"comma_agent_commands">): Promise<PendingAgentCommand> {
  const { conversationId, sessionId, model, effort, state, seenThroughMessageAt, title } = await requireChat(ctx, row.chatId);
  return {
    _id: row._id, chatId: row.chatId, command: await withLinks(ctx, row.command), createdAt: row.createdAt,
    chat: { conversationId, sessionId, model, effort, state, seenThroughMessageAt, title },
  };
}

/** Every unsettled chat across conversations, most recent activity first. */
export const listAgentChats = query({
  args: {},
  returns: v.array(agentChatSummary),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    // ponytail: the 100 newest open chats by creation; index updatedAt if that many ever stay open.
    const open = await ctx.db.query("comma_agent_chats").withIndex("by_settledAt", (q) => q.eq("settledAt", undefined)).order("desc").take(100);
    return await summaries(ctx, open);
  },
});

/** One conversation's chats, open and settled, most recent activity first. */
export const chatsFor = query({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.array(agentChatSummary),
  handler: async (ctx, { conversationId }) => {
    await assertAllowed(ctx);
    const chats = await ctx.db.query("comma_agent_chats").withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).order("desc").take(50);
    return await summaries(ctx, chats);
  },
});

export const listItems = query({
  args: { chatId: v.id("comma_agent_chats") },
  returns: v.array(agentItemDoc),
  handler: async (ctx, { chatId }) => {
    await assertAllowed(ctx);
    const newest = await ctx.db.query("comma_agent_items").withIndex("by_chat_ordinal", (q) => q.eq("chatId", chatId)).order("desc").take(400);
    return newest.reverse();
  },
});

/**
 * Asks in the chat named, reopening it if it was settled, or starts a new chat. Idempotent on the
 * client's key across every chat, so a retried send never asks twice or starts a second chat.
 * Each message carries its own model and effort, and the chat keeps the last ask's. Attachments
 * are uploads recorded by finalizeUpload; their name, type and size come from that record.
 */
export const ask = mutation({
  args: {
    conversationId: v.id("comma_conversations"), chatId: v.optional(v.id("comma_agent_chats")), key: v.string(), text: v.string(),
    steer: v.boolean(), model: v.string(), effort: agentEffort, attachments: v.optional(v.array(agentAttachment)),
  },
  returns: v.id("comma_agent_chats"),
  handler: async (ctx, { conversationId, chatId: named, key, text, steer, model, effort, attachments: sent = [] }) => {
    await assertAllowed(ctx);
    if (!await ctx.db.get(conversationId)) throw new Error("Conversation not found");
    const asked = await ctx.db.query("comma_agent_items").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (asked) return asked.chatId;
    const chat = named ? await requireChat(ctx, named) : null;
    if (chat && chat.conversationId !== conversationId) throw new Error("The agent chat belongs to another conversation");
    const now = Date.now();
    const chatId = chat?._id ?? await ctx.db.insert("comma_agent_chats", {
      conversationId, model, effort, state: "pending", createdAt: now, updatedAt: now,
    });
    const attachments = await recordedAttachments(ctx, sent.map(({ storageId }) => storageId));
    const shown = attachments.map(({ filename, mimeType, size }) => ({ filename, mimeType, size }));
    await upsertItems(ctx, chatId, [{ key, entry: { kind: "user", text, steer, ...(shown.length ? { attachments: shown } : {}) } }], now);
    await insertCommand(ctx, chatId, { kind: "message", text, steer, model, effort, ...(attachments.length ? { attachments } : {}) });
    const busy = chat?.state === "running" || chat?.state === "waiting_input";
    await ctx.db.patch(chatId, { model, effort, state: busy ? chat.state : "pending", updatedAt: now, ...REOPENED });
    return chatId;
  },
});

export const answer = mutation({
  args: { chatId: v.id("comma_agent_chats"), requestId: v.string(), answers: agentAnswers },
  returns: v.null(),
  handler: async (ctx, { chatId, requestId, answers }) => {
    await assertAllowed(ctx);
    await requireChat(ctx, chatId);
    for await (const item of ctx.db.query("comma_agent_items").withIndex("by_chat_ordinal", (q) => q.eq("chatId", chatId)).order("desc")) {
      const { entry } = item;
      if (entry.kind !== "question" || entry.requestId !== requestId) continue;
      if (entry.status !== "pending") return null;
      await ctx.db.patch(item._id, { entry: { ...entry, status: "resolved", answers }, updatedAt: Date.now() });
      await insertCommand(ctx, chatId, { kind: "answer", requestId, answers });
      return null;
    }
    return null;
  },
});

export const stop = mutation({
  args: { chatId: v.id("comma_agent_chats") },
  returns: v.null(),
  handler: async (ctx, { chatId }) => {
    await assertAllowed(ctx);
    await requireChat(ctx, chatId);
    await insertCommand(ctx, chatId, { kind: "stop" });
    return null;
  },
});

/** The pane's Settle: this chat only. */
export const settle = mutation({
  args: { chatId: v.id("comma_agent_chats") },
  returns: v.null(),
  handler: async (ctx, { chatId }) => {
    await assertAllowed(ctx);
    const chat = await requireChat(ctx, chatId);
    if (chat.settledAt === undefined) await settleChat(ctx, chat, { withConversation: false });
    return null;
  },
});

export const reopen = mutation({
  args: { chatId: v.id("comma_agent_chats") },
  returns: v.null(),
  handler: async (ctx, { chatId }) => {
    await assertAllowed(ctx);
    await requireChat(ctx, chatId);
    await ctx.db.patch(chatId, REOPENED);
    return null;
  },
});

/**
 * Settles a conversation in Needs reply only for its agent chats. Its triage flags are already
 * clear, so there is nothing for the bridge to do, and a bridge un-settle on Undo would bring back
 * a flag the user cleared.
 */
export const settleConversationAgents = mutation({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    await assertAllowed(ctx);
    await settleConversationChats(ctx, conversationId);
    return null;
  },
});

/** Undo of settleConversationAgents. */
export const reopenConversationAgents = mutation({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    await assertAllowed(ctx);
    await reopenConversationChats(ctx, conversationId);
    return null;
  },
});

/** The pane calls this while it shows the chat; it writes only when a turn ended since the last look. */
export const markSeen = mutation({
  args: { chatId: v.id("comma_agent_chats") },
  returns: v.null(),
  handler: async (ctx, { chatId }) => {
    await assertAllowed(ctx);
    const chat = await requireChat(ctx, chatId);
    if ((chat.lastTurnEndedAt ?? 0) > (chat.seenAt ?? 0)) await ctx.db.patch(chatId, { seenAt: Date.now() });
    return null;
  },
});

/** Puts a draft the agent left in the pane into the composer, over whatever the user typed. */
export const useDraft = mutation({
  args: { itemId: v.id("comma_agent_items") },
  returns: v.null(),
  handler: async (ctx, { itemId }) => {
    await assertAllowed(ctx);
    const item = await ctx.db.get(itemId);
    if (item?.entry.kind !== "draft" || item.entry.placed !== "pane") throw new Error("Not a draft waiting in the pane");
    const { conversationId } = await requireChat(ctx, item.chatId);
    const { text, note, attachments = [] } = item.entry;
    await writeAgentDraft(ctx, conversationId, { text, note, attachments, force: true, chatId: item.chatId });
    await ctx.db.patch(itemId, { entry: { ...item.entry, used: true }, updatedAt: Date.now() });
    return null;
  },
});

/**
 * The runner subscribes to this with ConvexClient, so like pendingOutbox it is public and gated
 * by the bridge secret instead of Convex Auth.
 */
export const pendingAgentCommands = query({
  args: { bridgeKey: v.string() },
  returns: v.array(pendingAgentCommand),
  handler: async (ctx, { bridgeKey }) => {
    if (!sameSecret(bridgeKey)) throw new Error("Unauthorized");
    const rows = await ctx.db.query("comma_agent_commands").withIndex("by_status_createdAt", (q) => q.eq("status", "pending")).order("asc").take(50);
    return await Promise.all(rows.map((row) => withChat(ctx, row)));
  },
});

/** Returns only the rows this call took, so two claimers never act on one command. */
export const agentClaim = internalMutation({
  args: { ids: v.array(v.id("comma_agent_commands")) },
  returns: v.array(pendingAgentCommand),
  handler: async (ctx, { ids }) => {
    const claimed = [];
    for (const id of ids) {
      const row = await ctx.db.get(id);
      if (row?.status !== "pending") continue;
      await ctx.db.patch(id, { status: "taken", takenAt: Date.now() });
      claimed.push(await withChat(ctx, row));
    }
    return claimed;
  },
});

/**
 * Runner boot: no turn survives a restart, so open turns end as interrupted, their questions close
 * and their tool steps fail. A pending chat with no pending command lost its command to a dead runner.
 */
export const agentRecover = internalMutation({
  args: { now: v.number() },
  returns: v.object({ chatIds: v.array(v.id("comma_agent_chats")) }),
  handler: async (ctx, { now }) => {
    const queued = new Set((await ctx.db.query("comma_agent_commands").withIndex("by_status_createdAt", (q) => q.eq("status", "pending")).collect())
      .map(({ chatId }) => chatId));
    const open = (await ctx.db.query("comma_agent_chats")
      .filter((q) => q.or(q.eq(q.field("state"), "running"), q.eq(q.field("state"), "waiting_input"), q.eq(q.field("state"), "pending")))
      .collect())
      .filter((chat) => chat.state !== "pending" || !queued.has(chat._id));
    for (const chat of open) {
      for await (const item of ctx.db.query("comma_agent_items").withIndex("by_chat_ordinal", (q) => q.eq("chatId", chat._id))) {
        const { entry } = item;
        if (entry.kind === "question" && entry.status === "pending") {
          await ctx.db.patch(item._id, { entry: { ...entry, status: "cancelled" }, updatedAt: now });
        } else if (entry.kind === "tool" && entry.status === "running") {
          await ctx.db.patch(item._id, { entry: { ...entry, status: "failed" }, updatedAt: now });
        }
      }
      await upsertItems(ctx, chat._id, [{ key: `recover-${now}`, entry: { kind: "turn_end", outcome: "interrupted" } }], now);
      await ctx.db.patch(chat._id, { state: "interrupted", updatedAt: now });
    }
    return { chatIds: open.map(({ _id }) => _id) };
  },
});

export const agentChat = internalMutation({
  args: {
    chatId: v.id("comma_agent_chats"), sessionId: v.optional(v.string()), state: v.optional(agentChatState),
    seenThroughMessageAt: v.optional(v.number()), title: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { chatId, ...patch }) => {
    const chat = await requireChat(ctx, chatId);
    // A settled chat that asks a question wants the user again.
    const reopened = patch.state === "waiting_input" && chat.settledAt !== undefined ? REOPENED : {};
    // A title is not activity: bumping updatedAt would reorder the lists and restart a working chat's timer.
    const active = Object.keys(patch).some((key) => key !== "title") ? { updatedAt: Date.now() } : {};
    await ctx.db.patch(chatId, { ...patch, ...reopened, ...active });
    return null;
  },
});

export const agentItems = internalMutation({
  args: { chatId: v.id("comma_agent_chats"), items: v.array(v.object({ key: v.string(), entry: agentEntry })) },
  returns: v.null(),
  handler: async (ctx, { chatId, items }) => {
    await requireChat(ctx, chatId);
    await upsertItems(ctx, chatId, items);
    return null;
  },
});

export const agentHeartbeat = internalMutation({
  args: { now: v.number() },
  returns: v.null(),
  handler: async (ctx, { now }) => {
    const row = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", "agent")).unique();
    if (row?.key === "agent") await ctx.db.patch(row._id, { updatedAt: now });
    else await ctx.db.insert("comma_bridge_state", { key: "agent", updatedAt: now });
    return null;
  },
});

/**
 * The agent's draft lands in the composer unless the user has typed there; then it waits in the
 * pane for useDraft. Idempotent on itemKey, so a retried post keeps its first placement.
 */
export const agentDraft = internalMutation({
  args: {
    chatId: v.id("comma_agent_chats"), conversationId: v.id("comma_conversations"), itemKey: v.string(), text: v.string(),
    note: v.optional(v.string()), attachments: v.optional(v.array(v.id("_storage"))),
  },
  returns: v.object({ placed: agentDraftPlacement }),
  handler: async (ctx, { chatId, conversationId, itemKey, text, note, attachments: storageIds = [] }) => {
    const chat = await requireChat(ctx, chatId);
    if (chat.conversationId !== conversationId) throw new Error("The agent chat belongs to another conversation");
    const existing = await itemFor(ctx, chatId, itemKey);
    if (existing?.entry.kind === "draft") return { placed: existing.entry.placed };
    if (!text.trim() && storageIds.length === 0) throw new Error("A draft needs text or an attachment");
    const attachments = await recordedAttachments(ctx, storageIds);
    const placed: AgentDraftPlacement = await writeAgentDraft(ctx, conversationId, { text, note, attachments, chatId }) ? "composer" : "pane";
    const entry = { kind: "draft" as const, text, note, attachments: attachments.length ? attachments : undefined, placed, used: false };
    await upsertItems(ctx, chatId, [{ key: itemKey, entry }]);
    return { placed };
  },
});

export const agentSend = internalMutation({
  args: { conversationId: v.id("comma_conversations"), clientKey: v.string(), text: v.string() },
  returns: v.id("comma_outbox"),
  handler: async (ctx, { conversationId, clientKey, text }) => (await enqueueCommand(ctx, { conversationId, clientKey, payload: { kind: "send", text } })).id,
});
