import type { GenericId } from "convex/values";
import type { TranscriptState } from "../../../shared/types";
import { UnknownSendError } from "../../commands";
import { mapMessage } from "../../map";
import type { ConvexIngest } from "../convex-ingest";
import { unnamed } from "../mapper";
import { requireChat, type HandlerMap } from "./types";

type MediaBridgeRequest =
  | { kind: "upload"; commandId: GenericId<"comma_outbox">; storageId: GenericId<"_storage"> }
  | { kind: "transcript"; attachmentGuid: string; transcript: TranscriptState; conversationId?: GenericId<"comma_conversations"> };

export async function postMedia(ingest: Pick<ConvexIngest, "post">, request: MediaBridgeRequest): Promise<string | boolean> {
  const post = ingest.post as unknown as (kind: "media", body: { request: MediaBridgeRequest }) => Promise<string | boolean>;
  return post.call(ingest, "media", { request });
}

export function createMediaHandlers(deps: { fetch: typeof fetch; post: typeof postMedia } = { fetch, post: postMedia }) {
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
      const message = mapMessage(sent.value, chatGuid, unnamed);
      // Sending already succeeded. A failed mirror must never turn into a second send.
      try { await ctx.writer.exclusive(() => ctx.writer.postMessages([{ ...sent.value, chats: [{ guid: chatGuid }] }])); }
      catch (error) { console.error(`comma attachment mirror: ${String(error)}`); }
      return { kind: "sendAttachment", message };
    } },
  } satisfies Partial<HandlerMap>;
}
export const mediaHandlers = createMediaHandlers();
