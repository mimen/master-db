import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "../_generated/server";

import { SlackApiError } from "./slackApi";
import { slackToken } from "./slackAuth";
import type { SlackFile } from "./slackEvents";

/**
 * Files on Slack messages, as Comma attachments. Ingest writes a row per file from what Slack says about it, and a
 * scheduled download copies the file into storage with the user token, since Slack's file URLs need it and the client
 * has none. A file the token can't read keeps its row with no storage, and shows as a tile with its name.
 */

/** Larger files keep their row and tile, and are never fetched. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** An image this large also stores Slack's 720px thumbnail, which the bubble draws in place of the original. */
export const THUMB_FROM_BYTES = 1024 * 1024;

export const slackAttachmentGuid = (messageGuid: string, fileId: string) => `${messageGuid}:${fileId}`;

const download = v.object({
  attachmentId: v.id("comma_attachments"), url: v.optional(v.string()), thumbUrl: v.optional(v.string()),
  mimeType: v.optional(v.string()), size: v.optional(v.number()),
});

/** Writes a message's files as its attachments, hides any Slack no longer lists, and schedules the ones not yet stored. */
export async function writeSlackFiles(
  ctx: MutationCtx, accountId: Id<"comma_accounts">, conversationId: Id<"comma_conversations">, messageGuid: string, files: SlackFile[],
): Promise<void> {
  const existing = (await ctx.db.query("comma_attachments").withIndex("by_messageGuid", (q) => q.eq("messageGuid", messageGuid)).collect())
    .filter((row) => row.platform === "slack" && row.accountId === accountId);
  const downloads: (typeof download.type)[] = [];
  for (const file of files) {
    const guid = slackAttachmentGuid(messageGuid, file.id);
    const row = {
      platform: "slack" as const, accountId, guid, messageGuid, conversationId, hideAttachment: false, sourceVersion: 0,
      ...(file.name ? { filename: file.name } : {}), ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      ...(file.size !== undefined ? { totalBytes: file.size } : {}), ...(file.width ? { width: file.width } : {}), ...(file.height ? { height: file.height } : {}),
    };
    const stored = existing.find((attachment) => attachment.guid === guid);
    if (stored) await ctx.db.patch(stored._id, row);
    const attachmentId = stored?._id ?? await ctx.db.insert("comma_attachments", row);
    if (stored?.originalStorageId || stored?.thumbStorageId || (!file.url && !file.thumbUrl)) continue;
    downloads.push({ attachmentId, ...(file.url ? { url: file.url } : {}), ...(file.thumbUrl ? { thumbUrl: file.thumbUrl } : {}),
      ...(file.mimeType ? { mimeType: file.mimeType } : {}), ...(file.size !== undefined ? { size: file.size } : {}) });
  }
  const kept = new Set(files.map((file) => slackAttachmentGuid(messageGuid, file.id)));
  for (const row of existing) if (!kept.has(row.guid) && !row.hideAttachment) await ctx.db.patch(row._id, { hideAttachment: true });
  if (downloads.length) await ctx.scheduler.runAfter(0, internal.comma.slackFiles.downloadFiles, { accountId, downloads });
}

/** The file, or null when Slack won't give it: an error, a size over the cap, or its sign-in page in place of the file. */
async function fetchFile(url: string, token: string, mimeType: string | undefined): Promise<Blob | null> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 429) throw new SlackApiError("files", "ratelimited", Number(response.headers.get("Retry-After") ?? "30"));
  if (!response.ok || Number(response.headers.get("Content-Length") ?? 0) > MAX_FILE_BYTES) return null;
  if (response.headers.get("Content-Type")?.startsWith("text/html") && mimeType !== "text/html") return null;
  const blob = await response.blob();
  return blob.size > 0 && blob.size <= MAX_FILE_BYTES ? blob : null;
}

/** One file at a time, so a burst never hammers Slack. A rate limit hands the rest to a later run, after as long as Slack asks. */
export const downloadFiles = internalAction({
  args: { accountId: v.id("comma_accounts"), downloads: v.array(download) },
  returns: v.null(),
  handler: async (ctx, { accountId, downloads }) => {
    const token = await slackToken(ctx, accountId);
    if (!token) return null;
    for (const [index, item] of downloads.entries()) {
      try {
        const image = item.mimeType?.startsWith("image/") ?? false;
        const original = item.url && (item.size ?? 0) <= MAX_FILE_BYTES ? await fetchFile(item.url, token, item.mimeType) : null;
        const thumb = image && item.thumbUrl && (!original || original.size >= THUMB_FROM_BYTES) ? await fetchFile(item.thumbUrl, token, undefined) : null;
        if (!original && !thumb) continue;
        await ctx.runMutation(internal.comma.slackFiles.storeFile, {
          attachmentId: item.attachmentId,
          ...(original ? { originalStorageId: await ctx.storage.store(original) } : {}),
          ...(thumb ? { thumbStorageId: await ctx.storage.store(thumb) } : {}),
        });
      } catch (error) {
        // Any other failure leaves this file a tile, and the rest still download.
        if (!(error instanceof SlackApiError && error.code === "ratelimited")) continue;
        await ctx.scheduler.runAfter((error.retryAfterSeconds ?? 30) * 1000, internal.comma.slackFiles.downloadFiles, { accountId, downloads: downloads.slice(index) });
        return null;
      }
    }
    return null;
  },
});

/** Two downloads of one file race when a message is read twice at once; the first to land stays, the other's blobs go. */
export const storeFile = internalMutation({
  args: { attachmentId: v.id("comma_attachments"), originalStorageId: v.optional(v.id("_storage")), thumbStorageId: v.optional(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { attachmentId, originalStorageId, thumbStorageId }) => {
    const row = await ctx.db.get(attachmentId);
    if (row && !row.originalStorageId && !row.thumbStorageId) {
      await ctx.db.patch(attachmentId, { ...(originalStorageId ? { originalStorageId } : {}), ...(thumbStorageId ? { thumbStorageId } : {}) });
      return null;
    }
    for (const id of [originalStorageId, thumbStorageId]) if (id) await ctx.storage.delete(id);
    return null;
  },
});
