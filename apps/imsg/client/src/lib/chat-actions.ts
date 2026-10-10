import { beginUndoAction, commitUndoAction, runLatestUndo } from "@/lib/action-undo";
import { runCommand, type CommandPayload } from "@/lib/convex-commands";
import { pendFlags, type FlagIntent } from "@/lib/pending-flags";
import { showToast } from "@/lib/toast";
import type { ChatSummary } from "@shared/types";

export function undoLastAction(): boolean {
  return runLatestUndo();
}

/**
 * Shows the intent on the directory at once and runs the command through the bridge. Rolls the
 * intent back before rejecting when the enqueue or the bridge fails, so callers only toast.
 */
export async function writeFlags(intent: FlagIntent, payload: CommandPayload, onQueued?: () => void): Promise<void> {
  const pending = pendFlags(intent);
  try {
    await runCommand(intent.chatGuid, payload, { onQueued });
    pending.confirm();
  } catch (error) {
    pending.rollback();
    throw error;
  }
}

export function pinChat(chat: ChatSummary, pinned: boolean): void {
  writeFlags({ change: "pin", chatGuid: chat.guid, value: pinned }, { kind: "pin", value: pinned })
    .catch(() => showToast("Couldn't pin the conversation. Try again."));
}

export function readChat(chatGuid: string): Promise<void> {
  return writeFlags({ change: "read", chatGuid, at: Date.now() }, { kind: "markRead" });
}

export function markChatRead(chat: ChatSummary): void {
  readChat(chat.guid).catch(() => showToast("Couldn't mark as read. Try again."));
}

export function markChatUnread(chat: ChatSummary, onSuccess?: () => void): void {
  const undoToken = beginUndoAction();
  writeFlags({ change: "unread", chatGuid: chat.guid }, { kind: "markUnread" }, () => {
    commitUndoAction(undoToken, () => markChatRead(chat));
    onSuccess?.();
  }).catch(() => showToast("Couldn't mark as unread. Try again."));
}
