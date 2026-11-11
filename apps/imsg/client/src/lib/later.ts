import type { ChatSummary } from "@shared/types";
import { ConvexError } from "convex/values";
import { beginUndoAction, commitUndoAction, runUndo } from "@/lib/action-undo";
import type { PopoverAnchor, SheetAction } from "@/lib/action-sheet";
import { conversationState } from "@/lib/conversation-state";
import { formatScheduledWhen } from "@/lib/scheduled";
import { canFollowUp, deferOptions, skipTodayAt, type DeferKind } from "@/lib/later-times";
import { showToast } from "@/lib/toast";

/** One write with its reversal on the undo stack, answered by a toast. */
function deferWrite(write: () => Promise<void>, reverse: () => Promise<void>, done: string, failed: string): void {
  const undoToken = beginUndoAction();
  write().then(() => {
    commitUndoAction(undoToken, () => void reverse().catch(() => showToast("Couldn't undo. Try again.")));
    showToast(done, { label: "Undo", hint: "⌘Z", onPress: () => void runUndo(undoToken) });
  }).catch((error: unknown) => {
    showToast(error instanceof ConvexError && typeof error.data === "string" ? error.data : failed);
  });
}

export function deferChat(chat: ChatSummary, kind: DeferKind, when: number): void {
  const id = chat.conversationId;
  const label = formatScheduledWhen(when);
  if (kind === "later") {
    deferWrite(() => conversationState().then((s) => s.snooze(id, when)), () => conversationState().then((s) => s.unsnooze(id)),
      `Snoozed until ${label}`, "Couldn't snooze. Try again.");
  } else {
    deferWrite(() => conversationState().then((s) => s.followUp(id, when)), () => conversationState().then((s) => s.clearFollowUp(id)),
      `Follow up ${label} if no reply`, "Couldn't set the follow-up. Try again.");
  }
}

/** Skip today: out of every queue until tomorrow morning, in one gesture. */
export const skipToday = (chat: ChatSummary): void => deferChat(chat, "later", skipTodayAt());

export function unsnoozeChat(chat: ChatSummary): void {
  conversationState().then((s) => s.unsnooze(chat.conversationId)).then(() => showToast("Unsnoozed"))
    .catch(() => showToast("Couldn't unsnooze. Try again."));
}

export function clearFollowUpChat(chat: ChatSummary): void {
  conversationState().then((s) => s.clearFollowUp(chat.conversationId)).then(() => showToast("Follow-up cleared"))
    .catch(() => showToast("Couldn't clear the follow-up. Try again."));
}

/** The Pick date card's request, served by components/later-picker.tsx. */
export interface PickRequest {
  chat: ChatSummary;
  kind: DeferKind;
  onPicked?: () => void;
}
type PickListener = (request: PickRequest) => void;
const pickListeners = new Set<PickListener>();

export function onPickRequest(listener: PickListener): () => void {
  pickListeners.add(listener);
  return () => pickListeners.delete(listener);
}

type ShowSheet = (request: { title?: string; actions: SheetAction[]; anchor?: PopoverAnchor }) => void;

/** The Later… or Follow up… menu. `onPicked` runs once a time is chosen, before its write lands. */
export function openDeferMenu(showSheet: ShowSheet, chat: ChatSummary, kind: DeferKind, opts: { anchor?: PopoverAnchor; onPicked?: () => void } = {}): void {
  if (kind === "followUp" && !canFollowUp(chat)) {
    showToast("Follow up waits on your own message. Reply first.");
    return;
  }
  const pick = (when: number) => {
    deferChat(chat, kind, when);
    opts.onPicked?.();
  };
  const now = new Date();
  const actions: SheetAction[] = [
    ...deferOptions(kind, now).map((option) => ({ label: option.label, note: formatScheduledWhen(option.at, now), icon: "time-outline" as const, onPress: () => pick(option.at) })),
    { label: "Pick date…", icon: "calendar-outline", onPress: () => { for (const listener of pickListeners) listener({ chat, kind, onPicked: opts.onPicked }); } },
  ];
  if (kind === "later" && chat.later?.snoozedUntil !== undefined) actions.push({ label: "Unsnooze", separatorBefore: true, onPress: () => unsnoozeChat(chat) });
  if (kind === "followUp" && chat.later?.followUp) actions.push({ label: "Clear follow-up", separatorBefore: true, onPress: () => clearFollowUpChat(chat) });
  showSheet({ title: kind === "later" ? "Later" : "Follow up if no reply", actions, anchor: opts.anchor });
}
