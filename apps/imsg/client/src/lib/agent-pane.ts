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

export function onOpenAgentPane(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
