import type { ChatSummary } from "@shared/types";
import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * A group rename is the one conversation write the Mini runs, through iMessage, so the directory carries the new
 * name only after it. Until then the name the user saved shows. Only a rename the Mini confirmed can retire.
 */
interface PendingRename { readonly name: string; readonly confirmed: boolean }

/** One pending rename per chat guid; a newer one replaces the older. */
export type PendingRenames = ReadonlyMap<string, PendingRename>;

/** The directory with each pending name shown. Returns `chats` itself when no row changes. */
export function applyRenames(chats: ChatSummary[], pending: PendingRenames): ChatSummary[] {
  if (pending.size === 0) return chats;
  const shown = chats.map((chat) => {
    const name = pending.get(chat.guid)?.name;
    return name === undefined || name === chat.displayName ? chat : { ...chat, displayName: name };
  });
  return shown.every((chat, index) => chat === chats[index]) ? chats : shown;
}

/** Drops confirmed renames the directory already shows. Returns `pending` itself when none retire. */
export function retireRenames(pending: PendingRenames, chats: readonly ChatSummary[]): PendingRenames {
  if (pending.size === 0) return pending;
  const names = new Map(chats.map((chat) => [chat.guid, chat.displayName]));
  const done = [...pending].filter(([guid, rename]) => rename.confirmed && names.get(guid) === rename.name);
  if (done.length === 0) return pending;
  const next = new Map(pending);
  for (const [guid] of done) next.delete(guid);
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
export function pendRename(chatGuid: string, name: string): { confirm(): void; rollback(): void } {
  const rename: PendingRename = { name, confirmed: false };
  publish(new Map(pending).set(chatGuid, rename));
  const settle = (keep: boolean) => {
    if (pending.get(chatGuid) !== rename) return;
    const next = new Map(pending);
    if (keep) next.set(chatGuid, { name, confirmed: true });
    else next.delete(chatGuid);
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
