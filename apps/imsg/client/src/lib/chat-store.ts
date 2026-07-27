import AsyncStorage from "@react-native-async-storage/async-storage";
import { applyMessage } from "@shared/chat-state";
import type { ChatSummary, Message } from "@shared/types";

/**
 * Module-level conversation store. Server fetches replace the list; known
 * messages (send responses, SSE payloads) patch it instantly so the sidebar
 * never waits on a round trip.
 */
let all: ChatSummary[] | null = null;
const listeners = new Set<(chats: ChatSummary[]) => void>();

// ------------------------------------------------------------- persistence
// Cold start used to be skeleton -> full round trip to the Mini -> paint, every
// single launch. Mirroring the list to disk lets the app open on real content.
// Only the head of the list: it is what fits on screen, and writing all ~500
// on every change costs more than it saves.
const CACHE_KEY = "imsg.chats.v1";
const CACHE_LIMIT = 60;
let hydrated = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const snapshot = all?.slice(0, CACHE_LIMIT);
    if (!snapshot) return;
    void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(snapshot)).catch(() => undefined);
  }, 1000);
}

/**
 * Seed from disk. Returns without doing anything once a real fetch has landed,
 * so a slow read can never overwrite fresher server data.
 */
export async function hydrateChats(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw || all !== null) return;
    const cached = JSON.parse(raw) as ChatSummary[];
    if (!Array.isArray(cached) || cached.length === 0) return;
    all = cached;
    emit();
  } catch {
    // unreadable cache — fall back to the network path
  }
}

function emit(): void {
  if (!all) return;
  for (const listener of listeners) listener(all);
  // Flush here rather than at each call site so no mutation path can forget it.
  scheduleFlush();
}

export function getChats(): ChatSummary[] | null {
  return all;
}

/** Test-only: this module is deliberately module-scoped singleton state. */
export function resetStoreForTest(): void {
  all = null;
  hydrated = false;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function subscribeChats(listener: (chats: ChatSummary[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Replace the list, but keep the PREVIOUS object for any conversation that came
 * back unchanged. A refetch fires on a short debounce whenever anything happens
 * server-side, and handing back 500 fresh-but-identical objects invalidates
 * every row memo and every FlashList cell — the recycler then rebuilds rows
 * that did not change, including a new image source for each avatar.
 */
export function setChats(next: ChatSummary[]): void {
  const previous = all;
  if (previous) {
    const byGuid = new Map(previous.map((c) => [c.guid, c]));
    let changed = next.length !== previous.length;
    const reconciled = next.map((incoming, i) => {
      const old = byGuid.get(incoming.guid);
      if (old && sameChat(old, incoming)) {
        if (previous[i] !== old) changed = true; // same object, new position
        return old;
      }
      changed = true;
      return incoming;
    });
    if (!changed) return; // nothing moved and nothing differs — skip the emit
    all = reconciled;
  } else {
    all = next;
  }
  emit();
}

/**
 * Structural equality. Compared by serialisation rather than a field list so a
 * new ChatSummary field can never silently fall out of the check. Measured at
 * 0.95ms for a full 520-conversation refetch, which is nothing next to the
 * re-render of every visible row that it avoids.
 */
function sameChat(a: ChatSummary, b: ChatSummary): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Instantly reflect a known message in the sidebar; the next fetch reconciles. */
export function patchChatWithMessage(chatGuid: string, message: Message): void {
  if (!all) return;
  const result = applyMessage(all, chatGuid, message);
  if (!result) return; // unknown chat: ignore client-side
  if (result === all) return; // stale message: same reference, no change
  all = result;
  emit();
}

/** Local flag tweak (e.g. clearing unread when a chat is opened). */
export function patchChatFlags(
  chatGuid: string,
  patch: Partial<ChatSummary["flags"]> & { unreadCount?: number },
): void {
  if (!all) return;
  const index = all.findIndex((c) => c.guid === chatGuid);
  const chat = index >= 0 ? all[index] : undefined;
  if (!chat) return;
  const { unreadCount, ...flags } = patch;
  const next = [...all];
  next[index] = {
    ...chat,
    unreadCount: unreadCount ?? chat.unreadCount,
    firstUnreadAt: flags.unread === false || unreadCount === 0 ? null : chat.firstUnreadAt,
    flags: { ...chat.flags, ...flags },
  };
  all = next;
  emit();
}
