import type { GenericId } from "convex/values";
import type { Message } from "@shared/types";
import { mediaApi } from "./media-api";
import { runCommand, type CommandPayload } from "./convex-commands";

type AttachmentSource = { uri: string; blob?: never } | { blob: Blob; uri?: never };
export type AttachmentUpload = AttachmentSource & { filename: string; mimeType: string; caption?: string; isAudioMessage: boolean };
export interface AttachmentUploadDeps {
  generateUploadUrl(): Promise<string>;
  finalizeUpload(args: { storageId: GenericId<"_storage">; filename: string; mimeType: string }): Promise<unknown>;
  send(chatGuid: string, payload: Extract<CommandPayload, { kind: "sendAttachment" }>): Promise<{ message: Message }>;
  fetch(url: string, init?: RequestInit): Promise<Pick<Response, "ok" | "status" | "json">>;
  readUri(uri: string): Promise<Blob | ArrayBuffer>;
}

export async function uploadAndSendAttachmentVia(deps: AttachmentUploadDeps, chatGuid: string, attachment: AttachmentUpload): Promise<Message> {
  const source = attachment.blob ?? await deps.readUri(attachment.uri);
  const bytes = source instanceof ArrayBuffer ? source : source.slice(0, source.size, attachment.mimeType);
  const uploadUrl = await deps.generateUploadUrl();
  const response = await deps.fetch(uploadUrl, { method: "POST", headers: { "Content-Type": attachment.mimeType }, body: bytes });
  if (!response.ok) throw new Error(`Attachment upload HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("storageId" in result) || typeof result.storageId !== "string") throw new Error("Upload did not return a storage ID");
  const storageId = result.storageId as GenericId<"_storage">;
  await deps.finalizeUpload({ storageId, filename: attachment.filename, mimeType: attachment.mimeType });
  const sent = await deps.send(chatGuid, {
    kind: "sendAttachment", storageId, filename: attachment.filename, mimeType: attachment.mimeType,
    ...(attachment.caption !== undefined ? { caption: attachment.caption } : {}), isAudioMessage: attachment.isAudioMessage,
  });
  return sent.message;
}

export async function uploadAndSendAttachment(chatGuid: string, attachment: AttachmentUpload): Promise<Message> {
  const { convexClient } = await import("./identity");
  const { Platform } = await import("react-native");
  return uploadAndSendAttachmentVia({
    generateUploadUrl: () => convexClient.mutation(mediaApi.generateAttachmentUploadUrl, {}),
    finalizeUpload: (args) => convexClient.mutation(mediaApi.finalizeUpload, args),
    send: (chat, payload) => runCommand(chat, payload),
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
  }, chatGuid, attachment);
}
