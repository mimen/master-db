import { beginUndoAction, commitUndoAction, runLatestUndo } from "@/lib/action-undo";
import { runCommand, type CommandPayload } from "@/lib/convex-commands";
import { pendFlags, type FlagIntent } from "@/lib/pending-flags";
import { showToast } from "@/lib/toast";
import type { ChatSummary } from "@shared/types";

export function undoLastAction(): boolean {
  return runLatestUndo();
}

/**
 * Shows the intent on the directory at once while `write` runs. Rolls the intent back before
 * rejecting when the write fails, so callers only toast.
 */
export async function pendWhile(intent: FlagIntent, write: () => Promise<unknown>): Promise<void> {
  const pending = pendFlags(intent);
  try {
    await write();
    pending.confirm();
  } catch (error) {
    pending.rollback();
    throw error;
  }
}

/** pendWhile for a command the bridge runs. */
export function writeFlags(intent: FlagIntent, payload: CommandPayload, onQueued?: () => void): Promise<void> {
  return pendWhile(intent, () => runCommand(intent.chatGuid, payload, { onQueued }));
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
