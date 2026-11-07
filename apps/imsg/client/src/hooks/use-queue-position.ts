import type { ChatSummary, ConversationId } from "@shared/types";
import { useSyncExternalStore } from "react";

export { queueOrder } from "@/lib/inbox-model";

// The conversation list publishes the order it renders (age groups, refinements and all), so the
// thread's "2 of 41" and auto-advance follow what is on screen rather than re-deriving it.
let rendered: readonly ChatSummary[] | null = null;

/** Where auto-advance goes once `conversationId` is handled: the next conversation, else the previous. */
export function advanceTarget(order: readonly ChatSummary[], conversationId: ConversationId): ChatSummary | null {
  const list = rendered?.some((chat) => chat.conversationId === conversationId) ? rendered : order;
  const at = list.findIndex((chat) => chat.conversationId === conversationId);
  if (at === -1) return null;
  return list[at + 1] ?? list[at - 1] ?? null;
}

export interface QueuePosition {
  /** One-based. */
  readonly index: number;
  readonly total: number;
  readonly conversationId: ConversationId;
}

export function queuePosition(order: readonly ChatSummary[], conversationId: ConversationId | undefined): QueuePosition | null {
  const at = conversationId === undefined ? -1 : order.findIndex((chat) => chat.conversationId === conversationId);
  return at === -1 || conversationId === undefined ? null : { index: at + 1, total: order.length, conversationId };
}

// The messages workspace owns the selection; the thread top bar only reads where the open thread sits.
let published: QueuePosition | null = null;
let current: QueuePosition | null = null;
const listeners = new Set<() => void>();

function recompute(): void {
  const next = rendered && published ? queuePosition(rendered, published.conversationId) : published;
  if (current?.index === next?.index && current?.total === next?.total) return;
  current = next;
  for (const listener of listeners) listener();
}

export function publishQueuePosition(next: QueuePosition | null): void {
  published = next;
  recompute();
}

/** The list's rendered conversation order, without folded rows, or null when no list is mounted. */
export function publishRenderedOrder(order: readonly ChatSummary[] | null): void {
  rendered = order;
  // The list re-derives its rows on every parent render; only a changed sequence is news to subscribers.
  if (!sameGuids(order, renderedSnapshot)) {
    renderedSnapshot = order;
    for (const listener of orderListeners) listener();
  }
  recompute();
}

let renderedSnapshot: readonly ChatSummary[] | null = null;
const orderListeners = new Set<() => void>();

function sameGuids(a: readonly ChatSummary[] | null, b: readonly ChatSummary[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((chat, index) => chat.conversationId === b[index]?.conversationId);
}

function subscribeOrder(listener: () => void): () => void {
  orderListeners.add(listener);
  return () => void orderListeners.delete(listener);
}

/** The published rendered order, so auto-advance re-aims when a fold or reorder changes what is on screen. */
export function useRenderedOrder(): readonly ChatSummary[] | null {
  return useSyncExternalStore(subscribeOrder, () => renderedSnapshot, () => null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useQueuePosition(): QueuePosition | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
