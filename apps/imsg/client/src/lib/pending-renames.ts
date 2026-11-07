import type { ChatSummary, ConversationId } from "@shared/types";
import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * A group rename is the one conversation write the Mini runs, through iMessage, so the directory carries the new
 * name only after it. Until then the name the user saved shows. Only a rename the Mini confirmed can retire.
 */
interface PendingRename { readonly name: string; readonly confirmed: boolean }

/** One pending rename per conversation; a newer one replaces the older. */
export type PendingRenames = ReadonlyMap<ConversationId, PendingRename>;

/** The directory with each pending name shown. Returns `chats` itself when no row changes. */
export function applyRenames(chats: ChatSummary[], pending: PendingRenames): ChatSummary[] {
  if (pending.size === 0) return chats;
  const shown = chats.map((chat) => {
    const name = pending.get(chat.conversationId)?.name;
    return name === undefined || name === chat.displayName ? chat : { ...chat, displayName: name };
  });
  return shown.every((chat, index) => chat === chats[index]) ? chats : shown;
}

/** Drops confirmed renames the directory already shows. Returns `pending` itself when none retire. */
export function retireRenames(pending: PendingRenames, chats: readonly ChatSummary[]): PendingRenames {
  if (pending.size === 0) return pending;
  const names = new Map(chats.map((chat) => [chat.conversationId, chat.displayName]));
  const done = [...pending].filter(([id, rename]) => rename.confirmed && names.get(id) === rename.name);
  if (done.length === 0) return pending;
  const next = new Map(pending);
  for (const [id] of done) next.delete(id);
  return next;
}

let pending: PendingRenames = new Map();
const listeners = new Set<() => void>();

function publish(next: PendingRenames): void {
  if (next === pending) return;
  pending = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows `name` at once. Confirm and rollback act only while no newer rename of the chat has replaced it. */
export function pendRename(conversationId: ConversationId, name: string): { confirm(): void; rollback(): void } {
  const rename: PendingRename = { name, confirmed: false };
  publish(new Map(pending).set(conversationId, rename));
  const settle = (keep: boolean) => {
    if (pending.get(conversationId) !== rename) return;
    const next = new Map(pending);
    if (keep) next.set(conversationId, { name, confirmed: true });
    else next.delete(conversationId);
    publish(next);
  };
  return { confirm: () => settle(true), rollback: () => settle(false) };
}

/** The directory with pending renames applied. Only ChatDirectoryProvider calls this. */
export function usePendingRenames(chats: ChatSummary[] | null): ChatSummary[] | null {
  const current = useSyncExternalStore(subscribe, () => pending, () => pending);
  useEffect(() => {
    if (chats) publish(retireRenames(pending, chats));
  }, [chats, current]);
  return useMemo(() => chats && applyRenames(chats, current), [chats, current]);
}

export function resetPendingRenamesForTests(): void {
  pending = new Map();
}
