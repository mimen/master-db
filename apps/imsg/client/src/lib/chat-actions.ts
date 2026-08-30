import { beginUndoAction, commitUndoAction, runLatestUndo } from "@/lib/action-undo";
import { api } from "@/lib/api";
import { patchChatFlags, revertChatFlags, settlePendingFlags } from "@/lib/chat-store";
import { showToast } from "@/lib/toast";
import type { ChatSummary } from "@shared/types";

/**
 * Optimistic conversation actions: patch the shared store immediately so every
 * surface updates at once, then fire the API and roll back on failure. This is
 * the single path for archive/pin/read/dismiss/mute across the whole app.
 */

function run(chatGuid: string, patch: Parameters<typeof patchChatFlags>[1], call: Promise<unknown>, failMsg: string, rollback: Parameters<typeof patchChatFlags>[1], onSuccess?: () => void): void {
  patchChatFlags(chatGuid, patch);
  void call.then(
    () => {
      settlePendingFlags(chatGuid);
      onSuccess?.();
    },
    () => {
      revertChatFlags(chatGuid, rollback);
      showToast(failMsg);
    },
  );
}

export function undoLastAction(): boolean {
  return runLatestUndo();
}

export function archiveChat(chat: ChatSummary, archived: boolean): void {
  const prev = chat.flags.archived;
  const undoToken = beginUndoAction();
  run(
    chat.guid,
    { archived },
    api.setArchived(chat.guid, archived),
    archived ? "Archive failed" : "Unarchive failed",
    { archived: prev },
    () => commitUndoAction(undoToken, () => archiveChat({ ...chat, flags: { ...chat.flags, archived } }, prev)),
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

export function markChatUnread(chat: ChatSummary, onSuccess?: () => void): void {
  const undoToken = beginUndoAction();
  run(
    chat.guid,
    { unread: true, unreadCount: Math.max(1, chat.unreadCount) },
    api.markUnread(chat.guid),
    "Failed",
    { unread: chat.flags.unread, unreadCount: chat.unreadCount },
    () => {
      commitUndoAction(undoToken, () => markChatRead({ ...chat, flags: { ...chat.flags, unread: true } }));
      onSuccess?.();
    },
  );
}
