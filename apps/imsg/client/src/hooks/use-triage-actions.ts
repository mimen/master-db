import { settleActionFor } from "@shared/chat-state";
import type { ChatSummary } from "@shared/types";
import { useCallback } from "react";
import { beginUndoAction, commitUndoAction, runLatestUndo, runUndo } from "@/lib/action-undo";
import { conversationState } from "@/lib/conversation-state";
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

function unsettle(chat: ChatSummary): Promise<void> {
  return conversationState().then((state) => state.unsettle(chat));
}

function settleFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.includes("latest message changed") ? "Conversation changed. Review the newest message." : "Could not settle conversation";
}

/**
 * Forward triage on one conversation: clear whichever triage flags it carries, and its agent chats. The row leaves
 * in the frame of the gesture, through the write's optimistic update. Once Convex has the settle, hands `settled` the
 * write that reverses it. `pinned` overrides the live newest message as the anchor; `quiet` leaves failures to the
 * caller's toast.
 */
function settleWrite(chat: ChatSummary, settled: (reverse: () => Promise<void>) => void, opts: { pinned?: string; quiet?: boolean } = {}): Promise<TriageWriteOutcome> {
  return runExclusiveTriageWrite(chat.guid, async () => {
    if (settleActionFor(chat) !== "settle") return;

    const anchor = opts.pinned ?? settleAnchor(chat.lastMessage);
    // In Needs you only for its agent chats, it settles just those: a conversation settle's Undo would
    // undismiss both anchors and bring back a flag the user had already cleared.
    const agentsOnly = !chat.flags.unresponded && !chat.flags.waiting;
    const written = conversationState().then((state) => (agentsOnly ? state.settleAgents(chat) : state.settle(chat, anchor)));
    emit(settlingListeners, chat.guid);
    try {
      await written;
    } catch (error) {
      if (!opts.quiet) showToast(settleFailure(error));
      throw error;
    }
    emit(resolvedListeners, chat.guid);
    settled(() => conversationState().then((state) => (agentsOnly ? state.reopenAgents(chat) : state.unsettle(chat)))
      .then(() => emit(undoListeners, chat.guid)));
  });
}

/**
 * Forward triage: clear whichever triage flags the conversation carries, and its agent chats.
 *
 * Answers "busy" when this conversation already has a triage write outstanding,
 * so a caller never reports a settle that never happened.
 */
export function settleTriageChat(chat: ChatSummary): Promise<TriageWriteOutcome> {
  const undoToken = beginUndoAction();
  // The entry runs long after this write released the conversation, and it
  // takes no exclusion of its own. Undo must never be refused as busy.
  return settleWrite(chat, (reverse) => commitUndoAction(undoToken, () => {
    reverse().catch(() => showToast("Couldn't undo the settle. Try again."));
  }));
}

export interface SettleBatch {
  /** Settles Convex took; only these are reopened by the batch's Undo. */
  settled: number;
  /** Settles Convex rejected. */
  failed: number;
  undoToken: number;
}

/**
 * Settles every conversation it can as one action, each conditional on its `anchor`. Waits for every settle's
 * outcome, and one undo entry reopens only the ones Convex took.
 */
export async function settleTriageChats(targets: readonly { chat: ChatSummary; anchor: string }[]): Promise<SettleBatch> {
  const undoToken = beginUndoAction();
  const reversals: (() => Promise<void>)[] = [];
  const outcomes = await Promise.allSettled(targets.map(({ chat, anchor }) =>
    settleWrite(chat, (reverse) => reversals.push(reverse), { pinned: anchor, quiet: true })));
  if (reversals.length > 0) {
    commitUndoAction(undoToken, () => {
      void Promise.allSettled(reversals.map((reverse) => reverse())).then((results) => {
        if (results.some((result) => result.status === "rejected")) showToast("Couldn't undo every settle. Try again.");
      });
    });
  }
  return { settled: reversals.length, failed: outcomes.filter((outcome) => outcome.status === "rejected").length, undoToken };
}

const threads = (n: number) => `${n} ${n === 1 ? "thread" : "threads"}`;

/** Today's Settle all: settles the rows and answers with one toast whose Undo reopens exactly the ones it settled. */
export async function settleAllChats(targets: readonly { chat: ChatSummary; anchor: string }[]): Promise<void> {
  const { settled, failed, undoToken } = await settleTriageChats(targets);
  if (settled === 0) {
    showToast(failed > 0 ? `Couldn't settle ${threads(failed)}` : "Nothing left to settle here");
    return;
  }
  const failure = failed > 0 ? ` · ${failed} couldn't be settled` : "";
  showToast(`Settled ${threads(settled)}${failure}`, { label: "Undo", hint: "⌘Z", onPress: () => void runUndo(undoToken) });
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
    await unsettle(chat).catch((error: unknown) => {
      showToast("Couldn't un-settle the conversation. Try again.");
      throw error;
    });
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
      showToast(chat.lastMessage?.isFromMe ? "Un-settled — back in Waiting" : "Un-settled — back in Needs you");
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
