import type { BBChat, BBMessage } from "./bb-types";
import type { BlueBubbles } from "./bluebubbles";
import type { ContactBook } from "./contacts";
import type { OverlayDb } from "./db";
import {
  applyMessage as applyMessageToSummaries,
  computeFlags,
  type ChatState,
} from "../shared/chat-state";
import { associatedMessageTargetGuid, mapChat, mapMessage, type UnreadSummary } from "./map";
import type { ChatSummary, Message } from "../shared/types";

/** Emitted whenever a mutation invalidates the directory; clients refetch. */
export type DirectoryEvent = { kind: "changed" };

const SUMMARY_TTL_MS = 15_000;
const UNREAD_TTL_MS = 30_000;
const UNREAD_PAGE_SIZE = 1000;
const LAST_REAL_PAGE_SIZE = 20;
const LAST_REAL_MAX_PAGES = 3;
const LAST_REAL_CONCURRENCY = 8;

interface RealtimeSpamOverride {
  messageGuid: string;
  dateCreated: number;
  isSpam: boolean;
}

interface ResolvedLastMessage {
  rawLastGuid: string;
  rawLastDate: number;
  message: BBMessage;
}

/**
 * The chat directory: the cached, Overlay-aware view of every conversation.
 * Owns the summary cache (with the socket fast path), the recent-unread scan,
 * and the local mark-read overrides, and emits a `changed` event whenever a
 * mutation invalidates that view.
 */
export class ChatDirectory {
  private summaryCache: { at: number; chats: ChatSummary[] } | null = null;
  private resolvedLastMessages = new Map<string, ResolvedLastMessage>();
  private lastMessageResolutions = new Map<string, Promise<BBMessage | null>>();
  private realtimeLastMessages = new Map<string, Message>();
  private realtimeSpam = new Map<string, RealtimeSpamOverride>();
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
    private now: () => number = Date.now,
  ) {
    this.contacts.onAvailabilityChange(() => this.invalidate());
  }

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
    while (this.now() - this.unreadScan.at >= UNREAD_TTL_MS && attempts < 2) {
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
    this.unreadScan = { at: this.now(), summaries };
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

  private rememberRealtimeLastMessage(chatGuid: string, message: Message): void {
    const current = this.realtimeLastMessages.get(chatGuid);
    if (!current || current.dateCreated <= message.dateCreated) {
      this.realtimeLastMessages.set(chatGuid, message);
    }
  }

  private applyRealtimeLastMessages(
    chats: ChatSummary[],
    states: Map<string, ChatState>,
  ): ChatSummary[] {
    let changed = false;
    const result = chats.map((chat) => {
      const message = this.realtimeLastMessages.get(chat.guid);
      const current = chat.lastMessage;
      if (!message) return chat;
      if (current && (current.guid === message.guid || current.dateCreated > message.dateCreated)) {
        this.realtimeLastMessages.delete(chat.guid);
        return chat;
      }
      changed = true;
      return {
        ...chat,
        isSpam: message.isSpam === true,
        lastMessage: {
          guid: message.guid,
          text: message.text || (message.attachments.length > 0 ? "Attachment" : ""),
          dateCreated: message.dateCreated,
          isFromMe: message.isFromMe,
          senderName: message.sender?.name ?? message.sender?.address ?? null,
          hasAttachments: message.attachments.length > 0,
        },
        flags: computeFlags(states.get(chat.guid), message, chat.unreadCount),
      };
    });
    return changed
      ? result.sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0))
      : chats;
  }

  private rememberRealtimeSpam(chatGuid: string, message: Message): void {
    const current = this.realtimeSpam.get(chatGuid);
    if (!current || current.dateCreated <= message.dateCreated) {
      this.realtimeSpam.set(chatGuid, {
        messageGuid: message.guid,
        dateCreated: message.dateCreated,
        isSpam: message.isSpam === true,
      });
    }
  }

  private applyRealtimeSpam(chats: ChatSummary[]): ChatSummary[] {
    return chats.map((chat) => {
      const override = this.realtimeSpam.get(chat.guid);
      const last = chat.lastMessage;
      if (!override || !last) return chat;
      if (last.dateCreated > override.dateCreated) return chat;
      if (last.guid === override.messageGuid && chat.isSpam === override.isSpam) return chat;
      return { ...chat, isSpam: override.isSpam };
    });
  }

  /**
   * Applies a message we already know about directly to the cached summaries.
   * Correct data immediately, even if BlueBubbles' own DB lags behind the
   * socket event; the next TTL rebuild reconciles fully.
   */
  private patchSummaries(chatGuid: string, m: Message): void {
    this.rememberRealtimeLastMessage(chatGuid, m);
    this.rememberRealtimeSpam(chatGuid, m);
    if (!this.summaryCache) return;
    const result = applyMessageToSummaries(this.summaryCache.chats, chatGuid, m);
    if (result === null) {
      this.clearCache();
      return;
    }
    if (result === this.summaryCache.chats) return; // stale message — nothing changed
    this.summaryCache = { at: this.summaryCache.at, chats: result };
  }

  private forgetResolvedMessage(messageGuid: string): void {
    for (const [chatGuid, resolved] of this.resolvedLastMessages) {
      if (resolved.message.guid === messageGuid) this.resolvedLastMessages.delete(chatGuid);
    }
  }

  private async findLastRealMessage(chatGuid: string): Promise<BBMessage | null> {
    try {
      let before: number | undefined;
      for (let page = 0; page < LAST_REAL_MAX_PAGES; page++) {
        const result = await this.bb.chatMessages(chatGuid, {
          before,
          limit: LAST_REAL_PAGE_SIZE,
          sort: "DESC",
        });
        if (!result.ok) return null;
        const resolved = result.value.find(
          (message) => !associatedMessageTargetGuid(message) && !message.dateRetracted,
        );
        if (resolved) return resolved;
        if (result.value.length < LAST_REAL_PAGE_SIZE) break;
        const dates = result.value
          .map((message) => message.dateCreated ?? 0)
          .filter((date) => date > 0);
        if (dates.length === 0) break;
        before = Math.min(...dates);
      }
      return null;
    } catch {
      return null;
    }
  }

  private async resolveLastMessage(chat: BBChat): Promise<BBChat> {
    const rawLast = chat.lastMessage;
    if (!rawLast || !associatedMessageTargetGuid(rawLast)) return chat;

    const cached = this.resolvedLastMessages.get(chat.guid);
    if (cached?.rawLastGuid === rawLast.guid) return { ...chat, lastMessage: cached.message };

    let resolution = this.lastMessageResolutions.get(rawLast.guid);
    if (!resolution) {
      resolution = this.findLastRealMessage(chat.guid);
      this.lastMessageResolutions.set(rawLast.guid, resolution);
      void resolution.finally(() => {
        if (this.lastMessageResolutions.get(rawLast.guid) === resolution) {
          this.lastMessageResolutions.delete(rawLast.guid);
        }
      });
    }
    const resolved = await resolution;
    if (!resolved) return chat;

    const rawLastDate = rawLast.dateCreated ?? 0;
    const current = this.resolvedLastMessages.get(chat.guid);
    if (!current || current.rawLastDate <= rawLastDate) {
      this.resolvedLastMessages.set(chat.guid, {
        rawLastGuid: rawLast.guid,
        rawLastDate,
        message: resolved,
      });
    }
    return { ...chat, lastMessage: resolved };
  }

  private async resolveLastMessages(chats: BBChat[]): Promise<BBChat[]> {
    const resolved = [...chats];
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(LAST_REAL_CONCURRENCY, chats.length) },
      async () => {
        while (nextIndex < chats.length) {
          const index = nextIndex++;
          const chat = chats[index];
          if (chat) resolved[index] = await this.resolveLastMessage(chat);
        }
      },
    );
    await Promise.all(workers);
    return resolved;
  }

  async summaries(): Promise<{ ok: true; chats: ChatSummary[] } | { ok: false; error: string }> {
    if (this.summaryCache && this.now() - this.summaryCache.at < SUMMARY_TTL_MS) {
      return { ok: true, chats: this.summaryCache.chats };
    }
    const result = await this.bb.queryChats();
    if (!result.ok) return { ok: false, error: result.error };
    await this.contacts.refresh();
    const unread = await this.unreadCounts();
    const sourceChats = await this.resolveLastMessages(result.value);
    const overlay = this.db.getAll();
    let chats = sourceChats
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
    chats = this.applyRealtimeLastMessages(chats, overlay);
    chats = this.applyRealtimeSpam(chats);
    this.summaryCache = { at: this.now(), chats };
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
    if (associatedMessageTargetGuid(message)) return null;
    const mapped = mapMessage(message, chatGuid, this.contacts);
    this.patchUnreadSummary(chatGuid, mapped);
    this.patchSummaries(chatGuid, mapped);
    return mapped;
  }

  /** Updated messages can remove unread eligibility, so rebuild instead of guessing. */
  applyUpdatedMessage(chatGuid: string | null, message: BBMessage): Message | null {
    if (associatedMessageTargetGuid(message)) return null;
    this.forgetResolvedMessage(message.guid);
    this.resetUnreadScan();
    this.clearCache();
    if (!chatGuid) return null;
    const mapped = mapMessage(message, chatGuid, this.contacts);
    this.rememberRealtimeSpam(chatGuid, mapped);
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
      this.localReadAt.set(guid, this.now());
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
