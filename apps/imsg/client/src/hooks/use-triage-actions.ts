import { settleActionFor } from "@shared/chat-state";
import type { ChatSummary } from "@shared/types";
import type { GenericId } from "convex/values";
import { useCallback } from "react";
import { beginUndoAction, commitUndoAction, runLatestUndo, runUndo } from "@/lib/action-undo";
import { agentApi } from "@/lib/agent-api";
import { pendWhile, writeFlags } from "@/lib/chat-actions";
import type { FlagIntent } from "@/lib/pending-flags";
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

/** Settles or reopens the conversation's agent chats alone, through Convex. */
async function conversationAgents(chat: ChatSummary, ref: typeof agentApi.settleConversationAgents): Promise<void> {
  if (!chat.conversationId) throw new Error("Conversation is not mirrored yet");
  const { convexClient } = await import("@/lib/identity");
  await convexClient.mutation(ref, { conversationId: chat.conversationId as GenericId<"comma_conversations"> });
}

/**
 * Resolves once the command is queued, as the gesture did before it waited on the bridge, so the
 * exclusion, the undo entry and the toast keep their timing. A failure at any point toasts, unless
 * `failure` is null; the flags have already rolled back.
 */
function untilQueued(write: (onQueued: () => void) => Promise<void>, failure: ((error: unknown) => string) | null): Promise<void> {
  return new Promise((resolve, reject) => {
    write(resolve).catch((error: unknown) => {
      if (failure) showToast(failure(error));
      reject(error);
    });
  });
}

function settleFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.includes("latest message changed") ? "Conversation changed. Review the newest message." : "Could not settle conversation";
}

type Settled = (reverse: () => Promise<void>, written: Promise<void>) => void;

/**
 * Forward triage on one conversation: clear whichever triage flags it carries, and its agent chats. Once the
 * settle is queued, hands `settled` the write that reverses it and the settle's own terminal outcome.
 * `pinned` overrides the live newest message as the anchor; `quiet` leaves failures to the caller's toast.
 */
function settleWrite(chat: ChatSummary, settled: Settled, opts: { pinned?: string; quiet?: boolean } = {}): Promise<TriageWriteOutcome> {
  return runExclusiveTriageWrite(chat.guid, async () => {
    if (settleActionFor(chat) !== "settle") return;

    const anchor = opts.pinned ?? settleAnchor(chat.lastMessage);
    const intent: FlagIntent = { change: "settle", chatGuid: chat.guid, seen: anchor };
    // In Needs you only for its agent chats, it settles just those: a bridge settle's Undo would
    // undismiss both anchors and bring back a flag the user had already cleared.
    const agentsOnly = !chat.flags.unresponded && !chat.flags.waiting;
    let written: Promise<void> = Promise.resolve();
    const queued = untilQueued((onQueued) => (written = agentsOnly
      ? pendWhile(intent, () => conversationAgents(chat, agentApi.settleConversationAgents)).then(onQueued)
      : writeFlags(intent, { kind: "settle", ...(anchor !== undefined ? { messageGuid: anchor } : {}) }, onQueued)), opts.quiet ? null : settleFailure);
    emit(settlingListeners, chat.guid);
    await queued;
    emit(resolvedListeners, chat.guid);
    settled(() => (agentsOnly ? conversationAgents(chat, agentApi.reopenConversationAgents) : unsettle(chat))
      .then(() => emit(undoListeners, chat.guid)), written);
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
  /** Settles the bridge confirmed; only these are reopened by the batch's Undo. */
  settled: number;
  /** Settles that failed to queue or that the bridge rejected. */
  failed: number;
  undoToken: number;
}

/**
 * Settles every conversation it can as one action, each conditional on its `anchor`. Waits for every settle's
 * terminal outcome, and one undo entry reopens only the confirmed ones.
 */
export async function settleTriageChats(targets: readonly { chat: ChatSummary; anchor: string }[]): Promise<SettleBatch> {
  const undoToken = beginUndoAction();
  const reversals: (() => Promise<void>)[] = [];
  const outcomes = await Promise.allSettled(targets.map(async ({ chat, anchor }) => {
    let confirmed: Promise<void> = Promise.resolve();
    await settleWrite(chat, (reverse, written) => {
      confirmed = written.then(() => { reversals.push(reverse); });
    }, { pinned: anchor, quiet: true });
    await confirmed;
  }));
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
