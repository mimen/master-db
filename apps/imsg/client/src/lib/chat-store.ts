import { applyMessage } from "@shared/chat-state";
import type { ChatFlags, ChatSummary, Message } from "@shared/types";

/**
 * Module-level conversation store. Server fetches replace the list; known
 * messages (send responses, SSE payloads) patch it instantly so the sidebar
 * never waits on a round trip.
 */
let all: ChatSummary[] | null = null;
const listeners = new Set<(chats: ChatSummary[]) => void>();

export type FlagPatch = Partial<ChatFlags> & { unreadCount?: number };

/** Bumped on every optimistic flag patch. A fetch that started at an older
 * epoch must not revert those flags — that's the archive bounce. */
let mutationEpoch = 0;
const pending = new Map<string, { epoch: number; patch: FlagPatch; inFlight: boolean }>();

export function mutationEpochNow(): number {
  return mutationEpoch;
}

function emit(): void {
  if (!all) return;
  for (const listener of listeners) listener(all);
}

export function getChats(): ChatSummary[] | null {
  return all;
}

export function subscribeChats(listener: (chats: ChatSummary[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyPatch(chat: ChatSummary, patch: FlagPatch): ChatSummary {
  const { unreadCount, ...flags } = patch;
  return {
    ...chat,
    unreadCount: unreadCount ?? chat.unreadCount,
    firstUnreadAt: flags.unread === false || unreadCount === 0 ? null : chat.firstUnreadAt,
    flags: { ...chat.flags, ...flags },
  };
}

function patchMatches(chat: ChatSummary, patch: FlagPatch): boolean {
  if (patch.unreadCount !== undefined && chat.unreadCount !== patch.unreadCount) return false;
  const { unreadCount: _count, ...flags } = patch;
  for (const key of Object.keys(flags) as (keyof ChatFlags)[]) {
    if (chat.flags[key] !== flags[key]) return false;
  }
  return true;
}

function overlayPending(incoming: ChatSummary, fetchEpoch: number): ChatSummary {
  const hold = pending.get(incoming.guid);
  if (!hold) return incoming;
  if (hold.inFlight) return applyPatch(incoming, hold.patch);
  if (patchMatches(incoming, hold.patch)) {
    pending.delete(incoming.guid);
    return incoming;
  }
  if (fetchEpoch >= hold.epoch) {
    // Mutation settled and this snapshot started after it — auto-unarchive, etc.
    pending.delete(incoming.guid);
    return incoming;
  }
  return applyPatch(incoming, hold.patch);
}

/**
 * Replace the list, but keep the PREVIOUS object for any conversation that came
 * back unchanged. A refetch fires on a short debounce whenever anything happens
 * server-side, and handing back 500 fresh-but-identical objects invalidates
 * every row memo and every FlashList cell — the recycler then rebuilds rows
 * that did not change, including a new image source for each avatar.
 *
 * `fetchEpoch` is `mutationEpochNow()` captured when the request started. A
 * snapshot from before an optimistic archive must not resurrect the row.
 */
export function setChats(next: ChatSummary[], fetchEpoch = mutationEpoch): void {
  const overlaid = next.map((incoming) => overlayPending(incoming, fetchEpoch));
  const previous = all;
  if (previous) {
    const byGuid = new Map(previous.map((c) => [c.guid, c]));
    let changed = overlaid.length !== previous.length;
    const reconciled = overlaid.map((incoming, i) => {
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
    all = overlaid;
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
  pending.delete(chatGuid);
  all = result;
  emit();
}

/** Local flag tweak (e.g. clearing unread when a chat is opened). */
export function patchChatFlags(chatGuid: string, patch: FlagPatch): void {
  if (!all) return;
  const index = all.findIndex((c) => c.guid === chatGuid);
  const chat = index >= 0 ? all[index] : undefined;
  if (!chat) return;
  mutationEpoch += 1;
  const prior = pending.get(chatGuid)?.patch ?? {};
  pending.set(chatGuid, { epoch: mutationEpoch, patch: { ...prior, ...patch }, inFlight: true });
  const next = [...all];
  next[index] = applyPatch(chat, patch);
  all = next;
  emit();
}

/** POST settled — keep overlaying until a later fetch agrees. */
export function settlePendingFlags(chatGuid: string): void {
  const hold = pending.get(chatGuid);
  if (hold) hold.inFlight = false;
}

/** Mutation failed: drop the hold and restore the pre-patch flags. */
export function revertChatFlags(chatGuid: string, patch: FlagPatch): void {
  pending.delete(chatGuid);
  if (!all) return;
  const index = all.findIndex((c) => c.guid === chatGuid);
  if (index < 0) return;
  const next = [...all];
  next[index] = applyPatch(all[index]!, patch);
  all = next;
  emit();
}

/** Test-only: drop store + pending so cases don't leak across files. */
export function resetChatStore(): void {
  all = null;
  pending.clear();
  mutationEpoch = 0;
}
