import { useSyncExternalStore } from "react";
import type { ConversationId } from "@shared/types";

/** The thread open in Mail's reader, which the wide shell's agent pane follows while Mail is in front. */
let selected: ConversationId | null = null;
const listeners = new Set<() => void>();

export function setMailSelection(conversationId: ConversationId | null): void {
  if (selected === conversationId) return;
  selected = conversationId;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useMailSelection(): ConversationId | null {
  return useSyncExternalStore(subscribe, () => selected, () => null);
}
