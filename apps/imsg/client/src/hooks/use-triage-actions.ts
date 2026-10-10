import { settleActionFor } from "@shared/chat-state";
import type { ChatSummary } from "@shared/types";
import { useCallback } from "react";
import { beginUndoAction, commitUndoAction, runLatestUndo } from "@/lib/action-undo";
import { writeFlags } from "@/lib/chat-actions";
import { showToast } from "@/lib/toast";
import { runExclusiveTriageWrite, settleAnchor, type TriageWriteOutcome } from "@/lib/triage-writes";

type TriageListener = (chatGuid: string) => void;
const resolvedListeners = new Set<TriageListener>();
const undoListeners = new Set<TriageListener>();
const settlingListeners = new Set<TriageListener>();

export function onTriageResolved(listener: TriageListener): () => void {
  resolvedListeners.add(listener);
  return () => resolvedListeners.delete(listener);
}

/**
 * Fires the moment a settle starts, before its write resolves, so auto-advance
 * can move on without waiting a round trip. A failed write toasts on its own.
 */
export function onTriageSettling(listener: TriageListener): () => void {
  settlingListeners.add(listener);
  return () => settlingListeners.delete(listener);
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

function unsettle(chat: ChatSummary, onQueued?: () => void): Promise<void> {
  return writeFlags({ change: "unsettle", chatGuid: chat.guid }, { kind: "unsettle" }, onQueued);
}

/**
 * Resolves once the command is queued, as the gesture did before it waited on the bridge, so the
 * exclusion, the undo entry and the toast keep their timing. A failure at any point toasts; the
 * flags have already rolled back.
 */
function untilQueued(write: (onQueued: () => void) => Promise<void>, failure: (error: unknown) => string): Promise<void> {
  return new Promise((resolve, reject) => {
    write(resolve).catch((error: unknown) => {
      showToast(failure(error));
      reject(error);
    });
  });
}

function settleFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.includes("latest message changed") ? "Conversation changed. Review the newest message." : "Could not settle conversation";
}

/**
 * Forward triage: clear whichever triage flags the conversation carries.
 *
 * Answers "busy" when this conversation already has a triage write outstanding,
 * so a caller never reports a settle that never happened.
 */
export function settleTriageChat(chat: ChatSummary): Promise<TriageWriteOutcome> {
  return runExclusiveTriageWrite(chat.guid, async () => {
    const last = chat.lastMessage;
    if (!last || (!chat.flags.unresponded && !chat.flags.waiting)) return;

    const undoToken = beginUndoAction();
    const anchor = settleAnchor(last);
    const queued = untilQueued((onQueued) => writeFlags({ change: "settle", chatGuid: chat.guid, seen: anchor },
      { kind: "settle", ...(anchor !== undefined ? { messageGuid: anchor } : {}) }, onQueued), settleFailure);
    emit(settlingListeners, chat.guid);
    await queued;
    emit(resolvedListeners, chat.guid);
    // The entry runs long after this write released the conversation, and it
    // takes no exclusion of its own. Undo must never be refused as busy.
    commitUndoAction(undoToken, () => {
      unsettle(chat)
        .then(() => emit(undoListeners, chat.guid))
        .catch(() => showToast("Couldn't undo the settle. Try again."));
    });
  });
}

/**
 * The other half of the toggle, private because it is only ever correct behind
 * toggleSettleChat's state check. Undismisses BOTH kinds rather than only the
 * one the last message implies: the opposite anchor can still hold a stale
 * dismissal, and leaving it there would stop that flag coming back later.
 *
 * Deliberately not undoable. Undo only ever restores a flag, so it can never
 * hide a message the user has not seen; an un-settle that landed on the undo
 * stack would break that.
 */
function unsettleTriageChat(chat: ChatSummary): Promise<TriageWriteOutcome> {
  return runExclusiveTriageWrite(chat.guid, async () => {
    const last = chat.lastMessage;
    if (!last) return;
    // Un-settling returns the conversation to the queue its last message implies,
    // which is exactly what computeFlags derives once the anchors are cleared.
    await untilQueued((onQueued) => unsettle(chat, onQueued), () => "Couldn't un-settle the conversation. Try again.");
    emit(undoListeners, chat.guid);
  });
}

/**
 * THE triage gesture: one toggle behind the ⌘E chord, the row chip and the
 * swipe alike, keyed to the conversation's own state and never to the lens on
 * screen. Always answers visibly — a keypress that did nothing and said nothing
 * is the defect this replaced — so callers need no toast of their own.
 */
export async function toggleSettleChat(chat: ChatSummary): Promise<void> {
  const action = settleActionFor(chat);
  if (action === "none") {
    showToast("Nothing to settle — no messages yet");
    return;
  }
  try {
    // The action above was read off flags that a still-outstanding write may
    // already have patched, so a second press inside that window would compute
    // the opposite action. Rejected there, and it has to say so. A press that
    // does nothing and reports nothing is the defect this gesture replaced.
    const outcome =
      action === "settle" ? await settleTriageChat(chat) : await unsettleTriageChat(chat);
    if (outcome === "busy") {
      showToast("Still saving that change — try again in a moment");
    } else if (action === "settle") {
      showToast(`Settled ${chat.displayName}`, { label: "Undo", hint: "⌘Z", onPress: () => void undoLastTriageAction() });
    } else {
      showToast(chat.lastMessage?.isFromMe ? "Un-settled — back in Waiting" : "Un-settled — back in Needs Reply");
    }
  } catch {
    // The write that failed already surfaced its own toast.
  }
}

/**
 * The row's hover Settle. chat-row calls it in place of its onSettle prop:
 * `const settle = useRowSettle(chat);` then `onPress={settle}`.
 */
export function useRowSettle(chat: ChatSummary): () => void {
  return useCallback(() => void toggleSettleChat(chat), [chat]);
}
