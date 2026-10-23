import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { draftListItem, type DraftAttachment } from "../schema/comma/validators";

import { conversationKey } from "./conversationKey";

async function draftFor(ctx: QueryCtx, conversationId: Id<"comma_conversations">): Promise<Doc<"comma_drafts"> | null> {
  return await ctx.db
    .query("comma_drafts")
    .withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId))
    .unique();
}

export async function deleteConversationDraft(ctx: MutationCtx, conversationId: Id<"comma_conversations">): Promise<null> {
  const draft = await draftFor(ctx, conversationId);
  if (draft) await ctx.db.delete(draft._id);
  return null;
}

/** The composer's text. Editing an agent draft makes it the user's; attachments stay until sent or removed. */
export const setDraft = mutation({
  args: { conversationId: v.id("comma_conversations"), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { conversationId, text }) => {
    await assertAllowed(ctx);
    const draft = await draftFor(ctx, conversationId);
    if (!text && !draft?.attachments?.length) return await deleteConversationDraft(ctx, conversationId);
    // The composer echoes a loaded draft back; that is not an edit.
    if (draft?.text === text) return null;
    const updatedAt = Date.now();
    if (draft) await ctx.db.patch(draft._id, { text, updatedAt, source: "user" });
    else await ctx.db.insert("comma_drafts", { conversationId, text, updatedAt, source: "user" });
    return null;
  },
});

export const clearDraft = mutation({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    await assertAllowed(ctx);
    return await deleteConversationDraft(ctx, conversationId);
  },
});

export const removeDraftAttachment = mutation({
  args: { conversationId: v.id("comma_conversations"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { conversationId, storageId }) => {
    await assertAllowed(ctx);
    const draft = await draftFor(ctx, conversationId);
    if (!draft?.attachments) return null;
    const attachments = draft.attachments.filter((a) => a.storageId !== storageId);
    if (!draft.text && attachments.length === 0) await ctx.db.delete(draft._id);
    else await ctx.db.patch(draft._id, { attachments, updatedAt: Date.now() });
    return null;
  },
});

async function resolveConversation(ctx: QueryCtx, to: { conversationId?: Id<"comma_conversations">; chatGuid?: string; address?: string }) {
  if (to.conversationId) return await ctx.db.get(to.conversationId);
  if (to.chatGuid) {
    const chatGuid = to.chatGuid;
    const alias = await ctx.db.query("comma_chat_aliases").withIndex("by_chatGuid", (q) => q.eq("chatGuid", chatGuid)).unique();
    return alias ? await ctx.db.get(alias.conversationId) : null;
  }
  if (to.address) {
    const key = conversationKey({ isGroup: false, primaryChatGuid: "", participants: [{ address: to.address, name: null }] });
    return await ctx.db.query("comma_conversations").withIndex("by_conversationKey", (q) => q.eq("conversationKey", key)).unique();
  }
  return null;
}

/**
 * The agent's write path (Convex CLI, admin key). Replaces an earlier agent draft, but never a
 * draft the user typed unless forced. Attachments must come from storeAttachment so the normal
 * sendAttachment command finds their finalized upload.
 */
export const prepareDraft = internalMutation({
  args: {
    conversationId: v.optional(v.id("comma_conversations")),
    chatGuid: v.optional(v.string()),
    address: v.optional(v.string()),
    text: v.string(),
    note: v.optional(v.string()),
    attachments: v.optional(v.array(v.id("_storage"))),
    force: v.optional(v.boolean()),
  },
  returns: v.object({ conversationId: v.id("comma_conversations"), draftId: v.id("comma_drafts"), replaced: v.boolean() }),
  handler: async (ctx, { text, note, attachments = [], force, ...to }) => {
    if ([to.conversationId, to.chatGuid, to.address].filter((x) => x !== undefined).length !== 1) {
      throw new Error("Pass exactly one of conversationId, chatGuid, address");
    }
    if (!text.trim() && attachments.length === 0) throw new Error("A draft needs text or an attachment");
    const conversation = await resolveConversation(ctx, to);
    if (!conversation) throw new Error(`No conversation for ${to.conversationId ?? to.chatGuid ?? to.address}`);
    const written = await writeAgentDraft(ctx, conversation._id, { text, note, attachments: await recordedAttachments(ctx, attachments), force });
    if (!written) throw new Error("The conversation has an unsent draft the user wrote. Pass force to replace it.");
    return { conversationId: conversation._id, ...written };
  },
});

/** The composer attachment for each upload recorded by recordUpload, so sendAttachment accepts it. */
export async function recordedAttachments(ctx: QueryCtx, storageIds: Id<"_storage">[]): Promise<DraftAttachment[]> {
  const stored = [];
  for (const storageId of storageIds) {
    const upload = await ctx.db.query("comma_uploads").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique();
    if (!upload) throw new Error(`Attachment ${storageId} was not stored through storeAttachment`);
    stored.push({ storageId, filename: upload.filename, mimeType: upload.mimeType, size: upload.totalBytes });
  }
  return stored;
}

/**
 * Writes an agent draft into the composer. Replaces an earlier agent draft, but never text the
 * user typed unless forced; that case writes nothing and returns null. chatId names the agent
 * chat that wrote it; a draft from the CLI has none.
 */
export async function writeAgentDraft(ctx: MutationCtx, conversationId: Id<"comma_conversations">, { text, note, attachments, force, chatId }: {
  text: string; note?: string; attachments: DraftAttachment[]; force?: boolean; chatId?: Id<"comma_agent_chats">;
}): Promise<{ draftId: Id<"comma_drafts">; replaced: boolean } | null> {
  const existing = await draftFor(ctx, conversationId);
  if (existing && existing.source !== "agent" && existing.text.trim() && !force) return null;
  const fields = {
    text, updatedAt: Date.now(), source: "agent" as const, note, attachments: attachments.length ? attachments : undefined, agentChatId: chatId,
  };
  if (existing) await ctx.db.patch(existing._id, fields);
  const draftId = existing?._id ?? await ctx.db.insert("comma_drafts", { conversationId, ...fields });
  return { draftId, replaced: existing !== null };
}

/** Large files skip base64: the CLI posts bytes to this URL, then records the upload. */
export const generateUploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

/** Finalizes stored bytes the way the composer's finalizeUpload does, so sendAttachment accepts them. */
export const recordUpload = internalMutation({
  args: { storageId: v.id("_storage"), filename: v.string(), mimeType: v.string() },
  returns: v.object({ storageId: v.id("_storage"), size: v.number() }),
  handler: async (ctx, upload) => {
    if (!upload.filename.trim() || !upload.mimeType.trim()) throw new Error("Filename and MIME type are required");
    const stored = await ctx.db.system.get(upload.storageId);
    if (!stored || stored.size === 0) throw new Error("Stored file is missing or empty");
    await ctx.db.insert("comma_uploads", { ...upload, totalBytes: stored.size, createdAt: Date.now() });
    return { storageId: upload.storageId, size: stored.size };
  },
});

/** Stores an agent's attachment bytes and finalizes the upload the way the composer's upload does. */
export const storeAttachment = internalAction({
  args: { filename: v.string(), mimeType: v.string(), base64: v.string() },
  returns: v.object({ storageId: v.id("_storage"), size: v.number() }),
  handler: async (ctx, { filename, mimeType, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    if (bytes.length === 0) throw new Error("Attachment is empty");
    const storageId = await ctx.storage.store(new Blob([bytes], { type: mimeType }));
    return await ctx.runMutation(internal.comma.drafts.recordUpload, { storageId, filename, mimeType });
  },
});

export const listAgentDrafts = internalQuery({
  args: {},
  returns: v.array(draftListItem),
  handler: async (ctx) => {
    const drafts = await ctx.db.query("comma_drafts").withIndex("by_updatedAt").order("desc").take(500);
    return drafts.filter((d) => d.source === "agent").map((d) => ({
      conversationId: d.conversationId, text: d.text, updatedAt: d.updatedAt, source: "agent" as const,
      ...(d.note !== undefined ? { note: d.note } : {}), attachmentCount: d.attachments?.length ?? 0,
    }));
  },
});

/** Agent housekeeping. Deletes only agent drafts, with their never-sent attachment bytes. */
export const deleteAgentDraft = internalMutation({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.boolean(),
  handler: async (ctx, { conversationId }) => {
    const draft = await draftFor(ctx, conversationId);
    if (draft?.source !== "agent") return false;
    for (const { storageId } of draft.attachments ?? []) {
      const upload = await ctx.db.query("comma_uploads").withIndex("by_storageId", (q) => q.eq("storageId", storageId)).unique();
      if (upload?.commandId) continue;
      if (upload) await ctx.db.delete(upload._id);
      await ctx.storage.delete(storageId);
    }
    await ctx.db.delete(draft._id);
    return true;
  },
});
