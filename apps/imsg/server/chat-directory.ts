import type { BBMessage } from "./bb-types";
import type { BlueBubbles } from "./bluebubbles";
import type { ContactBook } from "./contacts";
import type { OverlayDb } from "./db";
import { applyMessage as applyMessageToSummaries } from "../shared/chat-state";
import { mapChat, mapMessage } from "./map";
import type { ChatSummary, Message } from "../shared/types";

/** Emitted whenever a mutation invalidates the directory; clients refetch. */
export type DirectoryEvent = { kind: "changed" };

const SUMMARY_TTL_MS = 15_000;
const UNREAD_TTL_MS = 30_000;

/**
 * The chat directory: the cached, Overlay-aware view of every conversation.
 * Owns the summary cache (with the socket fast path), the recent-unread scan,
 * and the local mark-read overrides, and emits a `changed` event whenever a
 * mutation invalidates that view.
 */
export class ChatDirectory {
  private summaryCache: { at: number; chats: ChatSummary[] } | null = null;
  private unreadScan: { at: number; counts: Map<string, number> } = { at: 0, counts: new Map() };
  // Chats we've marked read, ahead of BlueBubbles' DB reflecting it.
  private localReadAt = new Map<string, number>();
  private listeners = new Set<(event: DirectoryEvent) => void>();

  constructor(
    private bb: BlueBubbles,
    private db: OverlayDb,
    private contacts: ContactBook,
  ) {}

  onEvent(cb: (event: DirectoryEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emitChanged(): void {
    for (const listener of this.listeners) listener({ kind: "changed" });
  }

  /** Clears the summary cache without emitting; the next build reconciles. */
  private clearCache(): void {
    this.summaryCache = null;
  }

  /** Drops the cache and notifies listeners; optionally forces an unread rescan. */
  invalidate(resetUnreadScan = false): void {
    this.clearCache();
    if (resetUnreadScan) this.unreadScan.at = 0;
    this.emitChanged();
  }

  private async unreadCounts(): Promise<Map<string, number>> {
    if (Date.now() - this.unreadScan.at < UNREAD_TTL_MS) return this.unreadScan.counts;
    const counts = new Map<string, number>();
    const batch = await this.bb.queryMessages({ limit: 1000, offset: 0 });
    if (batch.ok) {
      for (const message of batch.value) {
        if (message.isFromMe === true || message.dateRead) continue;
        if (message.associatedMessageGuid && message.associatedMessageType) continue;
        if ((message.itemType ?? 0) !== 0 || (message.groupActionType ?? 0) !== 0) continue;
        const chatGuid = message.chats?.[0]?.guid;
        if (!chatGuid) continue;
        counts.set(chatGuid, (counts.get(chatGuid) ?? 0) + 1);
      }
      this.unreadScan = { at: Date.now(), counts };
    }
    return counts;
  }

  /**
   * Applies a message we already know about directly to the cached summaries.
   * Correct data immediately, even if BlueBubbles' own DB lags behind the
   * socket event; the next TTL rebuild reconciles fully.
   */
  private patchSummaries(chatGuid: string, m: Message): void {
    if (!this.summaryCache) return;
    const result = applyMessageToSummaries(this.summaryCache.chats, chatGuid, m);
    if (result === null) {
      this.clearCache();
      return;
    }
    if (result === this.summaryCache.chats) return; // stale message — nothing changed
    this.summaryCache = { at: this.summaryCache.at, chats: result };
  }

  async summaries(): Promise<{ ok: true; chats: ChatSummary[] } | { ok: false; error: string }> {
    if (this.summaryCache && Date.now() - this.summaryCache.at < SUMMARY_TTL_MS) {
      return { ok: true, chats: this.summaryCache.chats };
    }
    const result = await this.bb.queryChats();
    if (!result.ok) return { ok: false, error: result.error };
    await this.contacts.refresh();
    const unread = await this.unreadCounts();
    const overlay = this.db.getAll();
    const chats = result.value
      .map((chat) => {
        const summary = mapChat(chat, overlay.get(chat.guid), this.contacts, unread.get(chat.guid));
        // Mark-read override: trust our own recent mark-read over BB's lagging DB.
        const readAt = this.localReadAt.get(chat.guid);
        if (readAt && (summary.lastMessage?.dateCreated ?? 0) <= readAt) {
          summary.unreadCount = 0;
          summary.flags.unread = false;
        }
        return summary;
      })
      .filter((chat) => chat.lastMessage !== null)
      .sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0));
    this.summaryCache = { at: Date.now(), chats };
    return { ok: true, chats };
  }

  /**
   * Socket fast path: resets the unread scan, then patches the cache. A null
   * chatGuid (or a chat missing from the cache) invalidates instead. Returns
   * the mapped message so the caller can broadcast it, or null when it only
   * invalidated (no chat to attribute the message to).
   */
  applyMessage(chatGuid: string | null, message: BBMessage): Message | null {
    this.unreadScan.at = 0;
    if (!chatGuid) {
      this.clearCache();
      return null;
    }
    const mapped = mapMessage(message, chatGuid, this.contacts);
    this.patchSummaries(chatGuid, mapped);
    return mapped;
  }

  /** Applies an already-mapped message (send/attachment responses) to the cache. */
  applyKnownMessage(chatGuid: string, message: Message): void {
    this.patchSummaries(chatGuid, message);
  }

  async markRead(guid: string): Promise<boolean> {
    const result = await this.bb.markRead(guid);
    if (result.ok) {
      this.clearCache();
      this.localReadAt.set(guid, Date.now());
      this.unreadScan.counts.set(guid, 0);
      this.db.setMarkedUnread(guid, false);
      this.emitChanged();
    }
    return result.ok;
  }

  markUnread(guid: string): void {
    this.db.setMarkedUnread(guid, true);
    this.localReadAt.delete(guid);
    this.emitChanged();
  }

  setArchived(guid: string, archived: boolean): void {
    this.db.setArchived(guid, archived);
    this.invalidate();
  }

  setPinned(guid: string, pinned: boolean): void {
    this.db.setPinned(guid, pinned);
    this.invalidate();
  }

  setMutedUnresponded(guid: string, muted: boolean): void {
    this.db.setMutedUnresponded(guid, muted);
    this.invalidate();
  }

  async dismiss(
    guid: string,
    kind: "unresponded" | "waiting",
  ): Promise<{ ok: boolean; error?: string; status?: 404 | 502 }> {
    const result = await this.summaries();
    if (!result.ok) return { ok: false, error: result.error, status: 502 };
    const chat = result.chats.find((x) => x.guid === guid);
    const lastGuid = chat?.lastMessage?.guid;
    if (!lastGuid) return { ok: false, error: "chat has no last message", status: 404 };
    if (kind === "unresponded") this.db.dismissUnresponded(guid, lastGuid);
    else this.db.dismissWaiting(guid, lastGuid);
    this.invalidate();
    return { ok: true };
  }

  async findByAddress(address: string): Promise<string | null> {
    const result = await this.summaries();
    if (!result.ok) return null;
    const digits = address.replace(/\D/g, "");
    const matches = (candidate: string) => {
      if (candidate === address || candidate.toLowerCase() === address.toLowerCase()) return true;
      const candidateDigits = candidate.replace(/\D/g, "");
      return (
        digits.length >= 7 && candidateDigits.length >= 7 && candidateDigits.slice(-10) === digits.slice(-10)
      );
    };
    const chat = result.chats.find(
      (x) => !x.isGroup && x.participants.some((p) => matches(p.address)),
    );
    return chat ? chat.guid : null;
  }
}
