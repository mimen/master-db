import { beginUndoAction, commitUndoAction, runLatestUndo } from "@/lib/action-undo";
import { conversationState } from "@/lib/conversation-state";
import { runCommand } from "@/lib/convex-commands";
import { pendRename } from "@/lib/pending-renames";
import { showToast } from "@/lib/toast";
import type { ChatSummary } from "@shared/types";

export function undoLastAction(): boolean {
  return runLatestUndo();
}

/** Shows the new name at once and rolls it back before rejecting when the Mini cannot rename the group. */
export async function renameChat(chatGuid: string, name: string): Promise<void> {
  const pending = pendRename(chatGuid, name);
  try {
    await runCommand(chatGuid, { kind: "rename", name });
    pending.confirm();
  } catch (error) {
    pending.rollback();
    throw error;
  }
}

export function pinChat(chat: ChatSummary, pinned: boolean): void {
  conversationState().then((state) => state.pin(chat, pinned))
    .catch(() => showToast("Couldn't pin the conversation. Try again."));
}

/** Reads the conversation; rejects only if iMessage's read receipt could not be sent. */
export async function readChat(chatGuid: string): Promise<void> {
  await (await conversationState()).read({ guid: chatGuid });
}

export function markChatRead(chat: ChatSummary): void {
  conversationState().then((state) => state.read(chat)).catch(() => showToast("Couldn't mark as read. Try again."));
}

export function markChatUnread(chat: ChatSummary, onSuccess?: () => void): void {
  const undoToken = beginUndoAction();
  conversationState().then((state) => state.markUnread(chat)).then(() => {
    commitUndoAction(undoToken, () => markChatRead(chat));
    onSuccess?.();
  }).catch(() => showToast("Couldn't mark as unread. Try again."));
}
