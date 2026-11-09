import { v, type Infer } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type MutationCtx } from "../_generated/server";
import type { gmailMessageValue } from "../schema/comma/validators";

import { GMAIL_API, googleApi, GoogleApiError } from "./gmailApi";
import { findPart, type Part } from "./gmailMessage";
import { gmailToken } from "./googleAuth";
import { MAX_FILE_BYTES } from "./slackFiles";

/**
 * Attachments on Gmail messages, as Comma attachments. Ingest writes a row per attachment part from a full read, and a
 * scheduled download copies each into storage with users.messages.attachments.get. Gmail's attachment ids change
 * between reads, so the download re-reads the message and finds each part by its partId. A part over the cap, or one
 * Gmail won't serve, keeps its row with no storage and shows as a tile with its name. A sent message's parts are the
 * stored files it was built from, so they need no download.
 */

type GmailMessageValue = Infer<typeof gmailMessageValue>;

export const gmailAttachmentGuid = (messageId: string, partId: string) => `${messageId}:${partId}`;

const part = v.object({ attachmentId: v.id("comma_attachments"), partId: v.string(), mimeType: v.string() });

/** Writes a message's attachment parts it has no row for, and schedules the download of each one under the cap. Returns their guids. */
export async function writeGmailFiles(
  ctx: MutationCtx, accountId: Id<"comma_accounts">, conversationId: Id<"comma_conversations">, message: GmailMessageValue,
): Promise<string[]> {
  const attachments = message.attachments ?? [];
  if (!attachments.length) return [];
  const existing = new Set((await ctx.db.query("comma_attachments").withIndex("by_messageGuid", (q) => q.eq("messageGuid", message.id)).collect())
    .filter((row) => row.platform === "gmail" && row.accountId === accountId).map((row) => row.guid));
  const downloads: (typeof part.type)[] = [];
  for (const file of attachments) {
    const guid = gmailAttachmentGuid(message.id, file.partId);
    if (existing.has(guid)) continue;
    const attachmentId = await ctx.db.insert("comma_attachments", {
      platform: "gmail", accountId, guid, messageGuid: message.id, conversationId, hideAttachment: false, sourceVersion: 0,
      filename: file.filename, mimeType: file.mimeType, totalBytes: file.size,
      gmail: { partId: file.partId, inline: file.inline, ...(file.contentId ? { contentId: file.contentId } : {}) },
      ...(file.storageId ? { originalStorageId: file.storageId } : {}),
    });
    if (!file.storageId && file.size <= MAX_FILE_BYTES) downloads.push({ attachmentId, partId: file.partId, mimeType: file.mimeType });
  }
  if (downloads.length) await ctx.scheduler.runAfter(0, internal.comma.gmailFiles.downloadFiles, { accountId, messageId: message.id, parts: downloads });
  return attachments.map((file) => gmailAttachmentGuid(message.id, file.partId));
}

function bytesOf(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** One message's parts, one at a time. A rate limit hands the rest to a later run, 30 seconds on. */
export const downloadFiles = internalAction({
  args: { accountId: v.id("comma_accounts"), messageId: v.string(), parts: v.array(part) },
  returns: v.null(),
  handler: async (ctx, { accountId, messageId, parts }) => {
    const token = await gmailToken(ctx, accountId).catch(() => null);
    if (!token) return null;
    const path = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}`;
    let payload: Part | undefined;
    for (const [index, item] of parts.entries()) {
      try {
        payload ??= (await googleApi<{ payload?: Part }>(`${path}?format=full`, { token })).payload;
        const found = findPart(payload, item.partId);
        const data = found?.body?.data ?? (found?.body?.attachmentId
          ? (await googleApi<{ data?: string }>(`${path}/attachments/${encodeURIComponent(found.body.attachmentId)}`, { token })).data
          : undefined);
        if (!data) continue;
        const bytes = bytesOf(data);
        if (!bytes.length || bytes.length > MAX_FILE_BYTES) continue;
        const originalStorageId = await ctx.storage.store(new Blob([bytes], { type: item.mimeType }));
        await ctx.runMutation(internal.comma.slackFiles.storeFile, { attachmentId: item.attachmentId, originalStorageId });
      } catch (error) {
        // Any other failure leaves this part a tile, and the rest still download.
        if (!(error instanceof GoogleApiError && error.rateLimited)) continue;
        await ctx.scheduler.runAfter(30_000, internal.comma.gmailFiles.downloadFiles, { accountId, messageId, parts: parts.slice(index) });
        return null;
      }
    }
    return null;
  },
});
