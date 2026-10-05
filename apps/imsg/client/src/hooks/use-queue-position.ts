import type { ChatSummary } from "@shared/types";
import { useSyncExternalStore } from "react";

export { queueOrder } from "@/lib/inbox-model";

// The conversation list publishes the order it renders (age groups, refinements and all), so the
// thread's "2 of 41" and auto-advance follow what is on screen rather than re-deriving it.
let rendered: readonly ChatSummary[] | null = null;

/** Where auto-advance goes once `guid` is handled: the next conversation, else the previous. */
export function advanceTarget(order: readonly ChatSummary[], guid: string): ChatSummary | null {
  const list = rendered?.some((chat) => chat.guid === guid) ? rendered : order;
  const at = list.findIndex((chat) => chat.guid === guid);
  if (at === -1) return null;
  return list[at + 1] ?? list[at - 1] ?? null;
}

export interface QueuePosition {
  /** One-based. */
  readonly index: number;
  readonly total: number;
  readonly guid: string;
}

export function queuePosition(order: readonly ChatSummary[], guid: string | undefined): QueuePosition | null {
  const at = guid === undefined ? -1 : order.findIndex((chat) => chat.guid === guid);
  return at === -1 || guid === undefined ? null : { index: at + 1, total: order.length, guid };
}

// The messages workspace owns the selection; the thread top bar only reads where the open thread sits.
let published: QueuePosition | null = null;
let current: QueuePosition | null = null;
const listeners = new Set<() => void>();

function recompute(): void {
  const next = rendered && published ? queuePosition(rendered, published.guid) : published;
  if (current?.index === next?.index && current?.total === next?.total) return;
  current = next;
  for (const listener of listeners) listener();
}

export function publishQueuePosition(next: QueuePosition | null): void {
  published = next;
  recompute();
}

/** The list's rendered conversation order, or null when no list is mounted. */
export function publishRenderedOrder(order: readonly ChatSummary[] | null): void {
  rendered = order;
  recompute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useQueuePosition(): QueuePosition | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
