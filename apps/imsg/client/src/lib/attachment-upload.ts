import type { GenericId } from "convex/values";
import type { Message } from "@shared/types";
import { mediaApi } from "./media-api";
import { runCommand, type CommandPayload } from "./convex-commands";

/** A storageId is an attachment already stored and finalized, such as one an agent drafted. */
type AttachmentSource =
  | { uri: string; blob?: never; storageId?: never }
  | { blob: Blob; uri?: never; storageId?: never }
  | { storageId: GenericId<"_storage">; uri?: never; blob?: never };
type UnstoredSource = Exclude<AttachmentSource, { storageId: GenericId<"_storage"> }>;
export type AttachmentUpload = AttachmentSource & { filename: string; mimeType: string; caption?: string; isAudioMessage: boolean };
export type AttachmentFile = UnstoredSource & { filename: string; mimeType: string };
export interface StoreDeps {
  generateUploadUrl(): Promise<string>;
  finalizeUpload(args: { storageId: GenericId<"_storage">; filename: string; mimeType: string }): Promise<unknown>;
  fetch(url: string, init?: RequestInit): Promise<Pick<Response, "ok" | "status" | "json">>;
  readUri(uri: string): Promise<Blob | ArrayBuffer>;
}
export interface AttachmentUploadDeps extends StoreDeps {
  send(chatGuid: string, payload: Extract<CommandPayload, { kind: "sendAttachment" }>): Promise<{ message: Message }>;
}
export interface StoredAttachment { storageId: GenericId<"_storage">; size: number }

export async function uploadAndSendAttachmentVia(deps: AttachmentUploadDeps, chatGuid: string, attachment: AttachmentUpload): Promise<Message> {
  const storageId = attachment.storageId ?? (await storeAttachmentVia(deps, attachment as AttachmentFile)).storageId;
  const sent = await deps.send(chatGuid, {
    kind: "sendAttachment", storageId, filename: attachment.filename, mimeType: attachment.mimeType,
    ...(attachment.caption !== undefined ? { caption: attachment.caption } : {}), isAudioMessage: attachment.isAudioMessage,
  });
  return sent.message;
}

/** Uploads and finalizes the bytes without sending them, as an agent ask needs. */
export async function storeAttachmentVia(deps: StoreDeps, attachment: AttachmentFile): Promise<StoredAttachment> {
  const source = attachment.blob ?? await deps.readUri(attachment.uri ?? "");
  const bytes = source instanceof ArrayBuffer ? source : source.slice(0, source.size, attachment.mimeType);
  const uploadUrl = await deps.generateUploadUrl();
  const response = await deps.fetch(uploadUrl, { method: "POST", headers: { "Content-Type": attachment.mimeType }, body: bytes });
  if (!response.ok) throw new Error(`Attachment upload HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("storageId" in result) || typeof result.storageId !== "string") throw new Error("Upload did not return a storage ID");
  const storageId = result.storageId as GenericId<"_storage">;
  await deps.finalizeUpload({ storageId, filename: attachment.filename, mimeType: attachment.mimeType });
  return { storageId, size: bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.size };
}

async function productionDeps(): Promise<StoreDeps> {
  const { convexClient } = await import("./identity");
  const { Platform } = await import("react-native");
  return {
    generateUploadUrl: () => convexClient.mutation(mediaApi.generateAttachmentUploadUrl, {}),
    finalizeUpload: (args) => convexClient.mutation(mediaApi.finalizeUpload, args),
    fetch: async (url, init) => Platform.OS === "web" ? fetch(url, init) : (await import("expo/fetch")).fetch(url, init),
    readUri: async (uri) => {
      if (Platform.OS !== "web") {
        const { File } = await import("expo-file-system");
        return new File(uri).arrayBuffer();
      }
      const response = await fetch(uri);
      if (!response.ok) throw new Error(`Attachment read HTTP ${response.status}`);
      return response.blob();
    },
  };
}

export async function uploadAndSendAttachment(chatGuid: string, attachment: AttachmentUpload): Promise<Message> {
  return uploadAndSendAttachmentVia({ ...await productionDeps(), send: (chat, payload) => runCommand(chat, payload) }, chatGuid, attachment);
}

export async function storeAttachment(attachment: AttachmentFile): Promise<StoredAttachment> {
  return storeAttachmentVia(await productionDeps(), attachment);
}
