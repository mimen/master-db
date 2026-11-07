import { router } from "expo-router";
import type { ConversationId } from "@shared/types";

import { requestFocus } from "./keyboard/controller";

/** Same bus shape as scheduled-pane.ts: the wide shell claims the open, else the phone's modal route takes it. */
type Listener = () => void;
const listeners = new Set<Listener>();
/** The chat a toast, the Agents tab or the switcher asked the wide pane to show, per conversation. */
const requested = new Map<ConversationId, string>();

/** Opens the pane on chatId when given, else on the conversation's most urgent chat. */
export function openAgentPane(conversationId: ConversationId, chatId?: string): void {
  requestFocus("agent-input");
  if (listeners.size === 0) {
    router.push({ pathname: "/agent", params: chatId ? { conversation: conversationId, chat: chatId } : { conversation: conversationId } });
    return;
  }
  if (chatId) requested.set(conversationId, chatId);
  for (const listener of listeners) listener();
}

/** The chat last requested for this conversation, once; the phone route carries its own as the `chat` param. */
export function takeRequestedAgentChat(conversationId: ConversationId): string | undefined {
  const chatId = requested.get(conversationId);
  requested.delete(conversationId);
  return chatId;
}

/** The chat the mounted pane shows, so a toast never announces the chat the user is watching. */
let shown: string | undefined;

/** The pane calls this while it shows `chatId`; the returned cleanup clears it. */
export function showAgentChat(chatId: string): () => void {
  shown = chatId;
  return () => {
    if (shown === chatId) shown = undefined;
  };
}

export function shownAgentChat(): string | undefined {
  return shown;
}

/**
 * Local previews of what an ask carried, by item key. The stored user entry names its files but
 * holds no URL, so a thumbnail lasts as long as this session; after a reload it reads as a chip.
 */
export const attachmentPreviews = new Map<string, readonly (string | undefined)[]>();

export function onOpenAgentPane(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
