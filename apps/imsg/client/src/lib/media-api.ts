import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";
import type { GalleryItem, TranscriptState } from "@shared/types";

export interface AttachmentMedia {
  guid: string;
  thumbUrl: string | null;
  originalUrl: string | null;
}
export type GalleryAttachment = GalleryItem & AttachmentMedia;
export const mediaApi = {
  gallery: makeFunctionReference<"query", { conversationId: GenericId<"comma_conversations">; limit?: number }, GalleryAttachment[]>("comma/media:gallery"),
  attachmentMedia: makeFunctionReference<"query", { guid: string }, AttachmentMedia | null>("comma/media:attachmentMedia"),
  attachmentChatGuid: makeFunctionReference<"query", { guid: string }, string | null>("comma/media:attachmentChatGuid"),
  transcriptState: makeFunctionReference<"query", { attachmentGuid: string }, TranscriptState>("comma/media:transcriptState"),
  generateAttachmentUploadUrl: makeFunctionReference<"mutation", Record<string, never>, string>("comma/uploads:generateAttachmentUploadUrl"),
  finalizeUpload: makeFunctionReference<"mutation", { storageId: GenericId<"_storage">; filename: string; mimeType: string }, GenericId<"comma_uploads">>("comma/uploads:finalizeUpload"),
};

export function storedAttachmentUrl(attachment: string | { originalUrl?: string | null }): string | null {
  return typeof attachment === "string" ? null : attachment.originalUrl ?? null;
}
export function storedAttachmentThumbnailUrl(attachment: string | { thumbUrl?: string | null; originalUrl?: string | null }): string | null {
  return typeof attachment === "string" ? null : attachment.thumbUrl ?? attachment.originalUrl ?? null;
}
