import type { GenericId } from "convex/values";
import type { TranscriptState } from "../../../shared/types";
import { UnknownSendError } from "../../commands";
import { mapMessage } from "../../map";
import { WhisperService } from "../../whisper";
import type { ConvexIngest } from "../convex-ingest";
import { requireChat, type CommandContext, type HandlerMap } from "./types";

type MediaBridgeRequest =
  | { kind: "upload"; commandId: GenericId<"comma_outbox">; storageId: GenericId<"_storage"> }
  | { kind: "transcript"; attachmentGuid: string; transcript: TranscriptState; conversationId?: GenericId<"comma_conversations"> };

export async function postMedia(ingest: Pick<ConvexIngest, "post">, request: MediaBridgeRequest): Promise<string | boolean> {
  const post = ingest.post as unknown as (kind: "media", body: { request: MediaBridgeRequest }) => Promise<string | boolean>;
  return post.call(ingest, "media", { request });
}

export function createMediaHandlers(deps: {
  fetch: typeof fetch;
  whisper: (ctx: CommandContext) => Pick<WhisperService, "transcribe"> | undefined;
  post: typeof postMedia;
} = { fetch, whisper: (ctx) => WhisperService.forCache(ctx.writer.deps.db), post: postMedia }) {
  return {
    sendAttachment: { longRunning: true, execute: async (ctx, payload) => {
      const chatGuid = requireChat(ctx);
      const url = await deps.post(ctx.writer.deps.ingest, { kind: "upload", commandId: ctx.row._id, storageId: payload.storageId });
      if (typeof url !== "string") throw new Error("Upload URL is unavailable");
      const response = await deps.fetch(url, { signal: ctx.signal });
      if (!response.ok) throw new Error(`Attachment download HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      ctx.signal.throwIfAborted();
      const bb = ctx.commands.bb;
      let sent;
      try {
        sent = payload.isAudioMessage
          ? await bb.sendAudio(chatGuid, payload.filename, bytes)
          : await bb.sendAttachmentWithCaption(chatGuid, payload.filename, bytes, payload.caption);
        if (sent.ok && payload.isAudioMessage && payload.caption) {
          const caption = await bb.sendText(chatGuid, payload.caption);
          if (!caption.ok) throw new Error(caption.error);
        }
      } catch (error) {
        throw new UnknownSendError(String(error));
      }
      if (!sent.ok) throw new Error(sent.error);
      const message = mapMessage(sent.value, chatGuid, ctx.writer.deps.names ?? { lookup: () => null, searchTerms: () => [], available: false, chatCrm: () => undefined, personCrm: () => undefined });
      ctx.commands.directory.applyKnownMessage(chatGuid, message);
      // Sending already succeeded. A failed mirror must never turn into a second send.
      try { await ctx.writer.exclusive(() => ctx.writer.postMessages([{ ...sent.value, chats: [{ guid: chatGuid }] }])); }
      catch (error) { console.error(`comma attachment mirror: ${String(error)}`); }
      return { kind: "sendAttachment", message };
    } },
    transcribe: { longRunning: true, execute: async (ctx, payload) => {
      requireChat(ctx);
      const publish = async (transcript: TranscriptState) => {
        const found = await deps.post(ctx.writer.deps.ingest, { kind: "transcript", attachmentGuid: payload.attachmentGuid, conversationId: ctx.row.conversationId, transcript });
        if (!found) throw new Error("Attachment is not mirrored yet");
      };
      await publish({ state: "working" });
      const whisper = deps.whisper(ctx);
      let transcript: TranscriptState;
      try {
        transcript = whisper ? await whisper.transcribe(payload.attachmentGuid) : { state: "unavailable", detail: "Whisper service is unavailable" };
      } catch (error) {
        transcript = { state: "failed", error: error instanceof Error ? error.message : String(error) };
      }
      await publish(transcript);
      return { kind: "transcribe", transcript };
    } },
  } satisfies Partial<HandlerMap>;
}
export const mediaHandlers = createMediaHandlers();
