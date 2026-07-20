import { api } from "@/lib/api";
import { patchChatFlags } from "@/lib/chat-store";
import { showToast } from "@/lib/toast";
import type { ChatSummary } from "@shared/types";

/**
 * Optimistic conversation actions: patch the shared store immediately so every
 * surface updates at once, then fire the API and roll back on failure. This is
 * the single path for archive/pin/read/dismiss/mute across the whole app.
 */

function run(chatGuid: string, patch: Parameters<typeof patchChatFlags>[1], call: Promise<unknown>, failMsg: string, rollback: Parameters<typeof patchChatFlags>[1]): void {
  patchChatFlags(chatGuid, patch);
  void call.catch(() => {
    patchChatFlags(chatGuid, rollback);
    showToast(failMsg);
  });
}

export function archiveChat(chat: ChatSummary, archived: boolean): void {
  run(
    chat.guid,
    { archived },
    api.setArchived(chat.guid, archived),
    archived ? "Archive failed" : "Unarchive failed",
    { archived: chat.flags.archived },
  );
}

export function pinChat(chat: ChatSummary, pinned: boolean): void {
  run(chat.guid, { pinned }, api.setPinned(chat.guid, pinned), "Pin failed", {
    pinned: chat.flags.pinned,
  });
}

export function markChatRead(chat: ChatSummary): void {
  run(
    chat.guid,
    { unread: false, unreadCount: 0 },
    api.markRead(chat.guid),
    "Failed",
    { unread: chat.flags.unread, unreadCount: chat.unreadCount },
  );
}

export function markChatUnread(chat: ChatSummary): void {
  run(
    chat.guid,
    { unread: true, unreadCount: Math.max(1, chat.unreadCount) },
    api.markUnread(chat.guid),
    "Failed",
    { unread: chat.flags.unread, unreadCount: chat.unreadCount },
  );
}

export function dismissChat(chat: ChatSummary, kind: "unresponded" | "waiting"): void {
  run(
    chat.guid,
    kind === "unresponded" ? { unresponded: false } : { waiting: false },
    api.dismiss(chat.guid, kind),
    "Failed",
    kind === "unresponded" ? { unresponded: chat.flags.unresponded } : { waiting: chat.flags.waiting },
  );
}

export function muteChat(chat: ChatSummary, muted: boolean): void {
  run(chat.guid, { mutedUnresponded: muted }, api.setMuted(chat.guid, muted), "Failed", {
    mutedUnresponded: chat.flags.mutedUnresponded,
  });
}
