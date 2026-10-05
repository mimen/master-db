import type { ChatSummary } from "@shared/types";
import { useSyncExternalStore } from "react";

/**
 * The desktop lens order: pinned, then CRM priority 1-2, then newest first.
 * TODO(signal-settle): conversation-list-pane's deskChats sorts the same way inline; it should
 * import this so the "2 of 41" count and the rendered list cannot drift.
 */
export function queueOrder(chats: readonly ChatSummary[]): ChatSummary[] {
  const rank = (chat: ChatSummary): number =>
    chat.flags.pinned ? 0 : chat.crm?.priority !== undefined && chat.crm.priority <= 2 ? 1 : 2;
  return [...chats].sort((a, b) =>
    rank(a) - rank(b) || (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0));
}

/** Where auto-advance goes once `guid` is handled: the next conversation, else the previous. */
export function advanceTarget(order: readonly ChatSummary[], guid: string): ChatSummary | null {
  const at = order.findIndex((chat) => chat.guid === guid);
  if (at === -1) return null;
  return order[at + 1] ?? order[at - 1] ?? null;
}

export interface QueuePosition {
  /** One-based. */
  readonly index: number;
  readonly total: number;
}

export function queuePosition(order: readonly ChatSummary[], guid: string | undefined): QueuePosition | null {
  const at = guid === undefined ? -1 : order.findIndex((chat) => chat.guid === guid);
  return at === -1 ? null : { index: at + 1, total: order.length };
}

// The messages workspace owns the lens; the thread top bar only reads where the open thread sits.
let current: QueuePosition | null = null;
const listeners = new Set<() => void>();

export function publishQueuePosition(next: QueuePosition | null): void {
  if (current?.index === next?.index && current?.total === next?.total) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useQueuePosition(): QueuePosition | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
