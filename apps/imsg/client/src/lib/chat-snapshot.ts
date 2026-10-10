import type { ChatSummary } from "@shared/types";

/**
 * The last conversation list this device saw, so a cold start paints real rows and
 * names before Convex answers (about 1.3 s on the tailnet). The live query replaces it.
 */
const KEY = "imsg.chatSnapshot.v1";
const VERSION = 1;
export const SNAPSHOT_MAX = 300;

type Store = Pick<Storage, "getItem" | "setItem">;

export function webStore(): Store | undefined {
  try {
    return typeof globalThis.localStorage === "undefined" ? undefined : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readChatSnapshot(store: Store | undefined): ChatSummary[] | null {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || parsed.version !== VERSION
      || !("chats" in parsed) || !Array.isArray(parsed.chats)) return null;
    return parsed.chats as ChatSummary[];
  } catch {
    return null;
  }
}

export function writeChatSnapshot(store: Store | undefined, chats: readonly ChatSummary[]): void {
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ version: VERSION, chats: chats.slice(0, SNAPSHOT_MAX) }));
  } catch {
    // Quota or private mode: the next cold start just waits for Convex.
  }
}

/**
 * The list while live pages are still arriving: every live row, then the snapshot's rows older than
 * the oldest live one. Without the tail, the first live page (25 rows) replaces up to 300 snapshot
 * rows and lens counts drop, then climb back page by page.
 */
export function bridgeSnapshot(live: readonly ChatSummary[], snapshot: readonly ChatSummary[]): ChatSummary[] {
  if (live.length === 0) return [...snapshot];
  const seen = new Set(live.map((chat) => chat.guid));
  const oldest = Math.min(...live.map((chat) => chat.lastMessage?.dateCreated ?? 0));
  return [...live, ...snapshot.filter((chat) => !seen.has(chat.guid) && (chat.lastMessage?.dateCreated ?? 0) < oldest)];
}
