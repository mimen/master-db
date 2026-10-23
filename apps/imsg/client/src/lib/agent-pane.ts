import { router } from "expo-router";

import { requestFocus } from "./keyboard/controller";

/** Same bus shape as scheduled-pane.ts: the wide shell claims the open, else the phone's modal route takes it. */
type Listener = () => void;
const listeners = new Set<Listener>();
/** The chat a toast, the Agents tab or the switcher asked the wide pane to show, per conversation. */
const requested = new Map<string, string>();

/** Opens the pane on chatId when given, else on the conversation's most urgent chat. */
export function openAgentPane(chatGuid: string, chatId?: string): void {
  requestFocus("agent-input");
  if (listeners.size === 0) {
    router.push({ pathname: "/agent", params: chatId ? { guid: chatGuid, chat: chatId } : { guid: chatGuid } });
    return;
  }
  if (chatId) requested.set(chatGuid, chatId);
  for (const listener of listeners) listener();
}

/** The chat last requested for this conversation, once; the phone route carries its own as the `chat` param. */
export function takeRequestedAgentChat(chatGuid: string): string | undefined {
  const chatId = requested.get(chatGuid);
  requested.delete(chatGuid);
  return chatId;
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
