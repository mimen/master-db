import { router } from "expo-router";

import { requestFocus } from "./keyboard/controller";

/** Same bus shape as scheduled-pane.ts: the wide shell claims the open, else the phone's modal route takes it. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function openAgentPane(chatGuid: string): void {
  requestFocus("agent-input");
  if (listeners.size === 0) {
    router.push({ pathname: "/agent", params: { guid: chatGuid } });
    return;
  }
  for (const listener of listeners) listener();
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
