import { beginUndoAction, commitUndoAction, runLatestUndo } from "@/lib/action-undo";
import { api } from "@/lib/api";
import { showToast } from "@/lib/toast";
import type { ChatSummary } from "@shared/types";

export function undoLastAction(): boolean {
  return runLatestUndo();
}

export function pinChat(chat: ChatSummary, pinned: boolean): void {
  void api.setPinned(chat.guid, pinned).catch(() => showToast("Pin failed"));
}

export function markChatRead(chat: ChatSummary): void {
  void api.markRead(chat.guid).catch(() => showToast("Failed"));
}

export function markChatUnread(chat: ChatSummary, onSuccess?: () => void): void {
  const undoToken = beginUndoAction();
  void api.markUnread(chat.guid).then(() => {
    commitUndoAction(undoToken, () => markChatRead(chat));
    onSuccess?.();
  }).catch(() => showToast("Failed"));
}
