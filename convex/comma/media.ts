import { v, type Infer } from "convex/values";

import { internalMutation, query, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { transcriptState as transcriptValidator, type CommaAttachmentDoc } from "../schema/comma/validators";

function visibleGuids(attachments: CommaAttachmentDoc[]): Set<string> {
  const groups = new Map<string, CommaAttachmentDoc[]>();
  const shown = attachments.filter((a) => a.guid && !a.hideAttachment);
  for (const a of shown) {
    const key = (a.transferName ?? a.filename ?? a.guid).toLowerCase().replace(/\.(heic|heif)\.jpe?g$/, ".$1");
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const dropped = new Set<string>();
  const rank = (a: CommaAttachmentDoc) => (a.isOnDisk ? 2 : 0) + (a.mimeType === "image/jpeg" ? 1 : 0);
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const keep = group.reduce((best, a) => rank(a) > rank(best) || (rank(a) === rank(best) && (a.width ?? 0) > (best.width ?? 0)) ? a : best);
    for (const a of group) {
      if (a !== keep && (/\.(heic|heif)$/.test(key) || !a.isOnDisk)) dropped.add(a.guid);
    }
  }
  return new Set(shown.filter((a) => !dropped.has(a.guid)).map((a) => a.guid));
}

const mediaUrls = { guid: v.string(), thumbUrl: v.union(v.string(), v.null()), originalUrl: v.union(v.string(), v.null()) };
async function urls(ctx: QueryCtx, attachment: CommaAttachmentDoc) {
  return {
    guid: attachment.guid,
    thumbUrl: attachment.thumbStorageId ? await ctx.storage.getUrl(attachment.thumbStorageId) : null,
    originalUrl: attachment.originalStorageId ? await ctx.storage.getUrl(attachment.originalStorageId) : null,
  };
}

export const attachmentMedia = query({
  args: { guid: v.string() },
  returns: v.union(v.object(mediaUrls), v.null()),
  handler: async (ctx, { guid }) => {
    await assertAllowed(ctx);
    const attachment = await ctx.db.query("comma_attachments").withIndex("by_guid", (q) => q.eq("guid", guid)).unique();
    return attachment && !attachment.hideAttachment ? urls(ctx, attachment) : null;
  },
});

export const attachmentChatGuid = query({
  args: { guid: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { guid }) => {
    await assertAllowed(ctx);
    const attachment = await ctx.db.query("comma_attachments").withIndex("by_guid", (q) => q.eq("guid", guid)).unique();
    if (!attachment) return null;
    const conversation = await ctx.db.get(attachment.conversationId);
    return conversation?.primaryChatGuid ?? null;
  },
});

export const gallery = query({
  args: { conversationId: v.id("comma_conversations"), limit: v.optional(v.number()) },
  returns: v.array(v.object({ ...mediaUrls, mimeType: v.union(v.string(), v.null()), filename: v.union(v.string(), v.null()), isImage: v.boolean(), isVideo: v.boolean(), dateCreated: v.number() })),
  handler: async (ctx, { conversationId, limit }) => {
    await assertAllowed(ctx);
    const cap = Math.max(0, Math.min(120, Math.floor(limit ?? 120)));
    if (!Number.isFinite(cap)) throw new Error("Invalid gallery limit");
    if (!cap) return [];
    const items = [];
    const seen = new Set<string>();
    for await (const message of ctx.db.query("comma_messages").withIndex("by_conversation_date", (q) => q.eq("conversationId", conversationId)).order("desc")) {
      if (message.isTapback || message.retracted) continue;
      const attachments = await ctx.db.query("comma_attachments").withIndex("by_messageGuid", (q) => q.eq("messageGuid", message.guid)).collect();
      const visible = visibleGuids(attachments);
      for (const attachment of attachments) {
        if (attachment.conversationId !== conversationId || !visible.has(attachment.guid) || seen.has(attachment.guid)) continue;
        const isImage = attachment.mimeType?.startsWith("image/") ?? false;
        const isVideo = attachment.mimeType?.startsWith("video/") ?? false;
        if (!isImage && !isVideo) continue;
        seen.add(attachment.guid);
        items.push({ ...await urls(ctx, attachment), mimeType: attachment.mimeType ?? null, filename: attachment.transferName ?? attachment.filename ?? null, isImage, isVideo, dateCreated: message.dateCreated });
        if (items.length === cap) return items;
      }
    }
    return items;
  },
});

export const transcriptState = query({
  args: { attachmentGuid: v.string() },
  returns: transcriptValidator,
  handler: async (ctx, { attachmentGuid }): Promise<Infer<typeof transcriptValidator>> => {
    await assertAllowed(ctx);
    const attachment = await ctx.db.query("comma_attachments").withIndex("by_guid", (q) => q.eq("guid", attachmentGuid)).unique();
    if (!attachment) return { state: "unavailable", detail: "Attachment is not mirrored yet" };
    if (attachment.transcript !== undefined) return { state: "ready", text: attachment.transcript };
    if (attachment.transcriptState === "working") return { state: "working" };
    if (attachment.transcriptState === "failed") return { state: "failed", error: attachment.transcriptError ?? "Transcription failed" };
    if (attachment.transcriptState === "unavailable") return { state: "unavailable", detail: attachment.transcriptDetail ?? "Transcription unavailable" };
    const bridge = await ctx.db.query("comma_bridge_state").withIndex("by_key", (q) => q.eq("key", "mini")).unique();
    if (bridge && !bridge.whisperAvailable) return { state: "unavailable", detail: bridge.whisperDetail ?? "Whisper unavailable" };
    return { state: "not-requested" };
  },
});

export const bridgeRequest = v.union(
  v.object({ kind: v.literal("upload"), commandId: v.id("comma_outbox"), storageId: v.id("_storage") }),
  v.object({ kind: v.literal("transcript"), attachmentGuid: v.string(), transcript: transcriptValidator, conversationId: v.optional(v.id("comma_conversations")) }),
);
export type MediaBridgeRequest = Infer<typeof bridgeRequest>;
export const bridgeMedia = internalMutation({
  args: { request: bridgeRequest },
  returns: v.union(v.string(), v.boolean()),
  handler: async (ctx, { request }) => {
    if (request.kind === "upload") {
      const command = await ctx.db.get(request.commandId);
      const upload = await ctx.db.query("comma_uploads").withIndex("by_storageId", (q) => q.eq("storageId", request.storageId)).unique();
      if (!upload || !command || command.payload.kind !== "sendAttachment" || command.payload.storageId !== request.storageId) throw new Error("Finalized upload not found for command");
      if (command.payload.filename !== upload.filename || command.payload.mimeType !== upload.mimeType) throw new Error("Upload metadata does not match command");
      if (upload.commandId && upload.commandId !== command._id) throw new Error("Upload is already linked to another command");
      const url = await ctx.storage.getUrl(request.storageId);
      if (!url) throw new Error("Uploaded file not found");
      await ctx.db.patch(upload._id, { commandId: command._id });
      return url;
    }
    const attachment = await ctx.db.query("comma_attachments").withIndex("by_guid", (q) => q.eq("guid", request.attachmentGuid)).unique();
    if (!attachment) return false;
    if (request.conversationId && attachment.conversationId !== request.conversationId) throw new Error("Attachment does not belong to conversation");
    // A late working notification must not overwrite a completed cached transcript.
    if (attachment.transcript !== undefined && request.transcript.state !== "ready") return true;
    const state = request.transcript;
    await ctx.db.patch(attachment._id, {
      transcriptState: state.state,
      transcript: state.state === "ready" ? state.text : undefined,
      transcriptError: state.state === "failed" ? state.error : undefined,
      transcriptDetail: state.state === "unavailable" ? state.detail : undefined,
    });
    return true;
  },
});
