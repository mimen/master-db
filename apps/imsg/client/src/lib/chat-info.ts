import type { ConversationId } from "@shared/types";

/** Tiny bus so the thread-pane info button (wide/desktop) can open the details
 * as a right-hand pane instead of navigating to the full-screen route. */
type Listener = (conversationId: ConversationId) => void;
const listeners = new Set<Listener>();

export function openChatInfo(conversationId: ConversationId): void {
  for (const l of listeners) l(conversationId);
}

export function onOpenChatInfo(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
