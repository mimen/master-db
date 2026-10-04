import type { BlueBubbles } from "./bluebubbles";
import type { ChatDirectory } from "./chat-directory";
import type { NameSource } from "./name-resolver";
import { tapbackReactionEvent } from "./map";

/** Keeps the directory and persisted triage state current with BlueBubbles. */
export function wireLiveEvents(
  bb: Pick<BlueBubbles, "onEvent">,
  directory: ChatDirectory,
  names: NameSource,
): () => void {
  let streamEverConnected = false;
  return bb.onEvent((event) => {
    switch (event.kind) {
      case "new-message":
      case "updated-message": {
        const rawChatGuid = event.message.chats?.[0]?.guid ?? null;
        const tapback = tapbackReactionEvent(event.message, names,
          rawChatGuid ? directory.participantHandlesFor(rawChatGuid) : []);
        if (event.kind === "new-message" || tapback) directory.applyMessage(rawChatGuid, event.message);
        else directory.applyUpdatedMessage(rawChatGuid, event.message);
        return;
      }
      case "chat-read-status-changed":
        directory.invalidate(true);
        return;
      case "group-changed":
        directory.invalidate();
        return;
      case "stream-connected":
        if (!streamEverConnected) {
          streamEverConnected = true;
          return;
        }
        // BlueBubbles does not replay events missed while disconnected.
        directory.invalidate(true);
        void directory.reconcileState().catch((error: Error) => console.error("Directory reconciliation failed", error));
        return;
    }
  });
}
