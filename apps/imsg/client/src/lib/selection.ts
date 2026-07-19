import type { JumpTarget } from "@/hooks/use-messages";

/**
 * Wide-layout selection bus: modals (search, new chat) publish the chat to
 * open; the split-pane index screen subscribes instead of route navigation.
 */
export interface Selection {
  guid: string;
  name?: string;
  isGroup?: boolean;
  jumpTarget?: JumpTarget | null;
}

type Listener = (selection: Selection) => void;
const listeners = new Set<Listener>();

export function selectChat(selection: Selection): boolean {
  if (listeners.size === 0) return false;
  for (const listener of listeners) listener(selection);
  return true;
}

export function onSelectChat(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
