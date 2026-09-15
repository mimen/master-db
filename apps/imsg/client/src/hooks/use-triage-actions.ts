import type { ChatSummary } from "@shared/types";
import { beginUndoAction, commitUndoAction, runLatestUndo } from "@/lib/action-undo";
import { api } from "@/lib/api";
import { patchChatFlags, revertChatFlags } from "@/lib/chat-store";
import { showToast } from "@/lib/toast";

type TriageListener = (chatGuid: string) => void;
const resolvedListeners = new Set<TriageListener>();
const undoListeners = new Set<TriageListener>();

export function onTriageResolved(listener: TriageListener): () => void {
  resolvedListeners.add(listener);
  return () => resolvedListeners.delete(listener);
}

export function onTriageUndo(listener: TriageListener): () => void {
  undoListeners.add(listener);
  return () => undoListeners.delete(listener);
}

function emit(listeners: Set<TriageListener>, chatGuid: string): void {
  for (const listener of listeners) listener(chatGuid);
}

export function undoLastTriageAction(): boolean {
  return runLatestUndo();
}

async function dismissOne(chat: ChatSummary, kind: "unresponded" | "waiting"): Promise<void> {
  const patch = kind === "unresponded" ? { unresponded: false } : { waiting: false };
  patchChatFlags(chat.guid, patch);
  try {
    await api.dismiss(chat.guid, kind, chat.lastMessage?.guid);
  } catch (error) {
    revertChatFlags(chat.guid, kind === "unresponded" ? { unresponded: true } : { waiting: true });
    const message = error instanceof Error ? error.message : "";
    showToast(message.startsWith("409:") ? "Conversation changed. Review the newest message." : "Could not settle conversation");
    throw error;
  }
}

export async function settleTriageChat(chat: ChatSummary): Promise<void> {
  const kinds: Array<"unresponded" | "waiting"> = [];
  if (chat.flags.unresponded) kinds.push("unresponded");
  if (chat.flags.waiting) kinds.push("waiting");
  if (kinds.length === 0) return;

  const undoToken = beginUndoAction();
  await Promise.all(kinds.map((kind) => dismissOne(chat, kind)));
  emit(resolvedListeners, chat.guid);
  commitUndoAction(undoToken, () => {
    for (const kind of kinds) {
      patchChatFlags(chat.guid, kind === "unresponded" ? { unresponded: true } : { waiting: true });
    }
    void Promise.all(kinds.map((kind) => api.undismiss(chat.guid, kind)))
      .then(() => emit(undoListeners, chat.guid))
      .catch(() => showToast("Could not undo Settle"));
  });
}
