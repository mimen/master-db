import { useEffect, useState } from "react";
import type { ChatSummary, SmartCloser } from "@shared/types";
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

export function laterOptions(): Array<{ label: string; until: number }> {
  const now = new Date();
  const tonight = new Date(now); tonight.setHours(18, 0, 0, 0);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date(now); monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7)); monday.setHours(9, 0, 0, 0);
  return [
    { label: "In 1 hour", until: now.getTime() + 3_600_000 },
    { label: "Later today", until: Math.max(tonight.getTime(), now.getTime() + 3_600_000) },
    { label: "Tomorrow morning", until: tomorrow.getTime() },
    { label: "Next Monday", until: monday.getTime() },
  ];
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

export async function setTriageLater(chat: ChatSummary, until: number | null): Promise<void> {
  const undoToken = beginUndoAction();
  await api.setChatLater(chat.guid, until);
  emit(resolvedListeners, chat.guid);
  commitUndoAction(undoToken, () => {
    void api.setChatLater(chat.guid, null)
      .then(() => emit(undoListeners, chat.guid))
      .catch(() => showToast("Could not undo Later"));
  });
}

export function useSmartCloser(chatGuid: string, enabled: boolean): { closer: SmartCloser | null; loading: boolean } {
  const [closer, setCloser] = useState<SmartCloser | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) { setCloser(null); return; }
    let cancelled = false;
    setLoading(true);
    void api.getSmartCloser(chatGuid).then((result) => { if (!cancelled) setCloser(result); }, () => { if (!cancelled) setCloser(null); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chatGuid, enabled]);
  return { closer, loading };
}
