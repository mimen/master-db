import type { BBMessage } from "./bb-types";
import type { BlueBubbles } from "./bluebubbles";
import type { ChatDirectory } from "./chat-directory";
import type { NameSource } from "./name-resolver";
import { tapbackReactionEvent } from "./map";
import type { ServerEvent } from "../shared/types";

function chatGuidOf(message: BBMessage): string | null {
  return message.chats?.[0]?.guid ?? null;
}

/**
 * Bridges the BlueBubbles event stream onto the Chat Directory and the SSE
 * fanout. Returns the unsubscribe handle.
 */
export function wireLiveEvents(
  bb: Pick<BlueBubbles, "onEvent">,
  directory: ChatDirectory,
  names: NameSource,
  broadcast: (event: ServerEvent) => void,
): () => void {
  let streamEverConnected = false;
  return bb.onEvent((event) => {
    switch (event.kind) {
      case "new-message":
      case "updated-message": {
        // Resolve sender data against the raw per-service chat, then broadcast
        // under the merged conversation's canonical guid.
        const rawChatGuid = chatGuidOf(event.message);
        const chatGuid = rawChatGuid ? directory.canonicalGuid(rawChatGuid) : null;
        // Tapbacks are reactions, not messages: patch the target message's
        // reactions live instead of injecting a "Loved …" bubble (reload folds
        // them via buildThread; this keeps realtime consistent with that).
        const tapback = tapbackReactionEvent(
          event.message,
          names,
          rawChatGuid ? directory.participantHandlesFor(rawChatGuid) : [],
        );
        if (tapback && rawChatGuid && chatGuid) {
          directory.applyMessage(rawChatGuid, event.message); // sidebar preview verb
          broadcast({ kind: "reaction", chatGuid, ...tapback });
          broadcast({ kind: "chats-changed" });
          return;
        }
        const mapped =
          event.kind === "new-message"
            ? directory.applyMessage(rawChatGuid, event.message)
            : directory.applyUpdatedMessage(rawChatGuid, event.message);
        if (!chatGuid || mapped === null) {
          broadcast({ kind: "chats-changed" });
          return;
        }
        broadcast({ kind: event.kind, chatGuid, message: mapped });
        return;
      }
      case "chat-read-status-changed":
        directory.invalidate(true);
        return;
      case "typing":
        broadcast({
          kind: "typing",
          chatGuid: directory.canonicalGuid(event.chatGuid),
          display: event.display,
        });
        return;
      case "group-changed":
        directory.invalidate();
        return;
      case "stream-connected":
        // First connect is boot, nothing was missed yet. Any later connect
        // means the socket was down: BlueBubbles does not replay events, so
        // the directory must rebuild and every client must refetch what it
        // renders — open threads included, which chats-changed alone never
        // reaches.
        if (!streamEverConnected) {
          streamEverConnected = true;
          return;
        }
        directory.invalidate(true);
        broadcast({ kind: "resync" });
        return;
    }
  });
}
