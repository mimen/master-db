import { useEffect, useState } from "react";
import type { ChatSummary, SmartCloser } from "@shared/types";
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

let undoTriage: (() => void) | null = null;
export function undoLastTriageAction(): boolean {
  const undo = undoTriage;
  if (!undo) return false;
  undoTriage = null;
  undo();
  return true;
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
    showToast(message.startsWith("409:") ? "Conversation changed. Review the newest message." : "Could not mark conversation done");
    throw error;
  }
}

export async function finishTriageChat(chat: ChatSummary): Promise<void> {
  const kinds: Array<"unresponded" | "waiting"> = [];
  if (chat.flags.unresponded) kinds.push("unresponded");
  if (chat.flags.waiting) kinds.push("waiting");
  if (kinds.length === 0) return;

  await Promise.all(kinds.map((kind) => dismissOne(chat, kind)));
  emit(resolvedListeners, chat.guid);
  undoTriage = () => {
    for (const kind of kinds) {
      patchChatFlags(chat.guid, kind === "unresponded" ? { unresponded: true } : { waiting: true });
    }
    void Promise.all(kinds.map((kind) => api.undismiss(chat.guid, kind)))
      .then(() => emit(undoListeners, chat.guid))
      .catch(() => showToast("Could not undo Done"));
  };
}

export async function setTriageLater(chat: ChatSummary, until: number | null): Promise<void> {
  await api.setChatLater(chat.guid, until);
  emit(resolvedListeners, chat.guid);
  undoTriage = () => {
    void api.setChatLater(chat.guid, null)
      .then(() => emit(undoListeners, chat.guid))
      .catch(() => showToast("Could not undo Later"));
  };
}

export function useRowDraft(chatGuid: string, enabled: boolean): string | null {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) { setDraft(null); return; }
    let cancelled = false;
    void api.aiSuggestions(chatGuid).then(
      (result) => { if (!cancelled) setDraft(result.suggestions[0]?.trim() || null); },
      () => { if (!cancelled) setDraft(null); },
    );
    return () => { cancelled = true; };
  }, [chatGuid, enabled]);
  return draft;
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
