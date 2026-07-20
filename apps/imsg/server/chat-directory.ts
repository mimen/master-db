import type { BBMessage } from "./bb-types";
import type { BlueBubbles } from "./bluebubbles";
import type { ContactBook } from "./contacts";
import type { OverlayDb } from "./db";
import { applyMessage as applyMessageToSummaries } from "../shared/chat-state";
import { mapChat, mapMessage, type UnreadSummary } from "./map";
import type { ChatSummary, Message } from "../shared/types";

/** Emitted whenever a mutation invalidates the directory; clients refetch. */
export type DirectoryEvent = { kind: "changed" };

const SUMMARY_TTL_MS = 15_000;
const UNREAD_TTL_MS = 30_000;
const UNREAD_PAGE_SIZE = 1000;

/**
 * The chat directory: the cached, Overlay-aware view of every conversation.
 * Owns the summary cache (with the socket fast path), the recent-unread scan,
 * and the local mark-read overrides, and emits a `changed` event whenever a
 * mutation invalidates that view.
 */
export class ChatDirectory {
  private summaryCache: { at: number; chats: ChatSummary[] } | null = null;
  private unreadScan: { at: number; summaries: Map<string, UnreadSummary> } = {
    at: 0,
    summaries: new Map(),
  };
  private unreadScanInFlight: { version: number; promise: Promise<boolean> } | null = null;
  private unreadScanVersion = 0;
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
    if (resetUnreadScan) this.resetUnreadScan();
    this.emitChanged();
  }

  private resetUnreadScan(): void {
    this.unreadScan.at = 0;
    this.unreadScanVersion++;
  }

  private async unreadCounts(): Promise<Map<string, UnreadSummary>> {
    let attempts = 0;
    while (Date.now() - this.unreadScan.at >= UNREAD_TTL_MS && attempts < 2) {
      attempts++;
      const inFlight =
        this.unreadScanInFlight ??
        (() => {
          const version = this.unreadScanVersion;
          const pending = { version, promise: this.scanUnreadCounts(version) };
          this.unreadScanInFlight = pending;
          return pending;
        })();
      const complete = await inFlight.promise;
      if (this.unreadScanInFlight === inFlight) this.unreadScanInFlight = null;
      if (complete) break;
      // An invalidation during the scan requires a fresh pass. A transport
      // failure keeps the previous complete result rather than retry-looping.
      if (inFlight.version === this.unreadScanVersion) break;
    }
    return this.unreadScan.summaries;
  }

  /** Scans every global-message page and atomically replaces a complete result. */
  private async scanUnreadCounts(scanVersion: number): Promise<boolean> {
    const summaries = new Map<string, UnreadSummary>();
    for (let offset = 0; ; offset += UNREAD_PAGE_SIZE) {
      const batch = await this.bb.queryMessages({
        limit: UNREAD_PAGE_SIZE,
        offset,
        unreadInboundOnly: true,
      });
      if (!batch.ok) return false;
      for (const message of batch.value) {
        const dateCreated = message.dateCreated ?? 0;
        if (
          message.isFromMe === true ||
          message.dateRead ||
          message.dateRetracted ||
          dateCreated <= 0 ||
          (message.associatedMessageGuid && message.associatedMessageType) ||
          (message.itemType ?? 0) !== 0 ||
          (message.groupActionType ?? 0) !== 0 ||
          (this.localReadAt.get(message.chats?.[0]?.guid ?? "") ?? 0) >= dateCreated
        ) {
          continue;
        }
        const chatGuid = message.chats?.[0]?.guid;
        if (!chatGuid) continue;
        const current = summaries.get(chatGuid);
        summaries.set(chatGuid, {
          count: (current?.count ?? 0) + 1,
          firstUnreadAt: Math.min(current?.firstUnreadAt ?? dateCreated, dateCreated),
        });
      }
      if (batch.value.length < UNREAD_PAGE_SIZE) break;
    }
    if (scanVersion !== this.unreadScanVersion) return false;
    this.unreadScan = { at: Date.now(), summaries };
    return true;
  }

  /** Extends a complete unread scan with a qualifying realtime message. */
  private patchUnreadSummary(chatGuid: string, message: Message): void {
    if (
      message.isFromMe ||
      message.dateRead !== null ||
      message.retracted ||
      message.isGroupEvent ||
      message.isAssociatedMessage === true ||
      message.dateCreated <= (this.localReadAt.get(chatGuid) ?? 0)
    ) {
      return;
    }
    const current = this.unreadScan.summaries.get(chatGuid);
    this.unreadScan.summaries.set(chatGuid, {
      count: (current?.count ?? 0) + 1,
      firstUnreadAt: Math.min(current?.firstUnreadAt ?? message.dateCreated, message.dateCreated),
    });
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
        const state = overlay.get(chat.guid);
        const summary = mapChat(chat, state, this.contacts, unread.get(chat.guid));
        // Mark-read override: trust our own recent mark-read over BB's lagging DB.
        const readAt = this.localReadAt.get(chat.guid);
        if (readAt && (summary.lastMessage?.dateCreated ?? 0) <= readAt) {
          summary.unreadCount = 0;
          summary.firstUnreadAt = null;
          summary.flags.unread = state?.markedUnread === 1;
        }
        return summary;
      })
      .filter((chat) => chat.lastMessage !== null)
      .sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0));
    this.summaryCache = { at: Date.now(), chats };
    return { ok: true, chats };
  }

  /**
   * Socket fast path: patches both unread and summary caches. A null chatGuid
   * (or a chat missing from the cache) invalidates instead. Returns
   * the mapped message so the caller can broadcast it, or null when it only
   * invalidated (no chat to attribute the message to).
   */
  applyMessage(chatGuid: string | null, message: BBMessage): Message | null {
    if (!chatGuid) {
      this.clearCache();
      return null;
    }
    const mapped = mapMessage(message, chatGuid, this.contacts);
    this.patchUnreadSummary(chatGuid, mapped);
    this.patchSummaries(chatGuid, mapped);
    return mapped;
  }

  /** Updated messages can remove unread eligibility, so rebuild instead of guessing. */
  applyUpdatedMessage(chatGuid: string | null, message: BBMessage): Message | null {
    this.resetUnreadScan();
    this.clearCache();
    return chatGuid ? mapMessage(message, chatGuid, this.contacts) : null;
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
      this.resetUnreadScan();
      this.unreadScan.summaries.set(guid, { count: 0, firstUnreadAt: null });
      this.db.setMarkedUnread(guid, false);
      this.emitChanged();
    }
    return result.ok;
  }

  markUnread(guid: string): void {
    this.db.setMarkedUnread(guid, true);
    // Keep localReadAt: manual unread is an overlay flag, not evidence that
    // BlueBubbles' lagging unread rows became genuinely unread again.
    this.clearCache();
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
