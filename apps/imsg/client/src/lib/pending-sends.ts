import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useConvexConnectionState } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import type { GenericId } from "convex/values";
import { conversationRoute } from "@shared/imessage";
import type { MentionAnnotation } from "@shared/mentions";
import { messageService } from "@shared/platform-profile";
import { NOT_SENT_AFTER_MS, NOT_SENT_ERROR, pendingClientKey, pendingGuid, type PendingSendState } from "@shared/pending-send";
import type { ChatSummary, ConversationId, Message } from "@shared/types";
import { pendingSendsApi } from "./convex-api";
import { runCommandVia, watchCommandVia, type ResultCommandClient } from "./convex-commands";
import { settleTemp, upsertMessage } from "./message-window";
import { useBridgeState } from "./presence-api";

/**
 * Every message this session sent that has not landed yet, per conversation, on any platform. A send draws its
 * bubble on the frame of the gesture, waits while Convex is unreachable, and goes out when it reconnects. One that
 * waits NOT_SENT_AFTER_MS gives up as Not sent, the same deadline Convex holds a queued send to, so nothing goes out
 * after the user was told it did not. The store outlives any one thread, so the forward picker and the palette can
 * put a bubble in a chat before that chat's thread has mounted.
 */

let sends: ReadonlyMap<ConversationId, readonly Message[]> = new Map();
const listeners = new Set<() => void>();
const EMPTY: readonly Message[] = [];

/** Sends this session is holding until Convex is reachable; calling one gives up the wait. */
const holding = new Map<string, () => void>();
/** Sends that gave up while held, so Convex never saw them and a retry reuses their key. */
const neverQueued = new Set<string>();
const cancelled = new Set<string>();

function update(conversationId: ConversationId, change: (current: readonly Message[]) => readonly Message[]): void {
  const current = sends.get(conversationId) ?? EMPTY;
  const next = change(current);
  if (next === current) return;
  const copy = new Map(sends);
  if (next.length === 0) copy.delete(conversationId);
  else copy.set(conversationId, next);
  sends = copy;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface SendClient extends ResultCommandClient {
  mutation<Ref extends FunctionReference<"mutation">>(ref: Ref, args: FunctionArgs<Ref>): Promise<FunctionReturnType<Ref>>;
  connectionState(): { isWebSocketConnected: boolean };
  subscribeToConnectionState(callback: () => void): () => void;
}

export interface SendDraft {
  text: string;
  replyTo?: Pick<Message, "guid" | "text" | "isFromMe"> | null;
  mentions?: readonly MentionAnnotation[];
}

/** The user gave up the send, so it never went out. Callers show nothing. */
export class SendCancelledError extends Error {
  constructor() {
    super("Send cancelled");
    this.name = "SendCancelledError";
  }
}

const inFlight = (message: Message) => message.sendState === "queued" || message.sendState === "sending";

async function defaultClient(): Promise<SendClient> {
  return (await import("./identity")).convexClient as unknown as SendClient;
}

function newSendKey(): string {
  return `send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** An outgoing message drawn before it is queued, under the guid Convex gives its pending row. */
export function draftBubble(chat: Pick<ChatSummary, "imessage" | "isGroup">, draft: SendDraft, clientKey = newSendKey()): Message {
  const { replyTo = null, mentions = [] } = draft;
  return {
    guid: pendingGuid(clientKey),
    clientKey,
    chatGuid: chat.imessage.chatGuid,
    text: draft.text,
    dateCreated: Date.now(),
    dateRead: null,
    dateDelivered: null,
    isFromMe: true,
    service: messageService(conversationRoute(chat).service),
    sender: null,
    attachments: [],
    mentions: [...mentions],
    special: null,
    sendEffect: null,
    reactions: [],
    replyToGuid: replyTo?.guid ?? null,
    replyToPreview: replyTo ? replyTo.text.slice(0, 120) : null,
    replyToFromMe: replyTo?.isFromMe ?? null,
    isGroupEvent: false,
    error: 0,
    edited: false,
    retracted: false,
    sendState: "queued",
  };
}

/** A send that did not go out takes the time it stopped, so it sorts among the messages around its attempt. */
function stranded(bubble: Message, sendState: Extract<PendingSendState, "failed" | "notSent">): Message {
  return { ...bubble, sendState, error: 1, dateCreated: Date.now() };
}

/** Resolves true once Convex is reachable, false at the deadline or when the wait is given up. */
function reachable(client: SendClient, clientKey: string, deadline: number): Promise<boolean> {
  if (client.connectionState().isWebSocketConnected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      unsubscribe();
      clearTimeout(timer);
      holding.delete(clientKey);
      resolve(ok);
    };
    const unsubscribe = client.subscribeToConnectionState(() => {
      if (client.connectionState().isWebSocketConnected) done(true);
    });
    const timer = setTimeout(() => done(false), Math.max(0, deadline - Date.now()));
    holding.set(clientKey, () => done(false));
  });
}

/**
 * The landed copy keeps what the user drew where the platform's echo lags: BlueBubbles can report a fresh SMS as
 * iMessage before it reclassifies, and can drop mention runs. The mirrored row replaces it once it arrives.
 */
function landedAs(bubble: Message, message: Message): Message {
  return {
    ...message,
    service: bubble.service,
    ...((bubble.mentions ?? []).length > 0 && (message.mentions ?? []).length === 0 ? { mentions: bubble.mentions } : {}),
  };
}

/** Waits for Convex, runs `queue`, and settles the bubble with what the platform made of it. */
async function deliver(conversationId: ConversationId, bubble: Message, client: SendClient,
  queue: () => Promise<{ message: Message }>): Promise<Message> {
  const clientKey = bubble.clientKey!;
  const ok = await reachable(client, clientKey, Date.now() + NOT_SENT_AFTER_MS);
  if (cancelled.has(clientKey)) throw new SendCancelledError();
  if (!ok) {
    neverQueued.add(clientKey);
    pendingSends.settle(conversationId, bubble.guid, stranded(bubble, "notSent"));
    throw new Error(NOT_SENT_ERROR);
  }
  try {
    const landed = landedAs(bubble, (await queue()).message);
    pendingSends.settle(conversationId, bubble.guid, landed);
    return landed;
  } catch (error) {
    if (cancelled.has(clientKey)) throw new SendCancelledError();
    pendingSends.settle(conversationId, bubble.guid, stranded(bubble, error instanceof Error && error.message === NOT_SENT_ERROR ? "notSent" : "failed"));
    throw error;
  }
}

const payloadOf = (bubble: Message) => ({
  kind: "send" as const,
  text: bubble.text,
  ...(bubble.replyToGuid ? { replyToGuid: bubble.replyToGuid } : {}),
  ...(bubble.mentions?.length ? { mentions: bubble.mentions } : {}),
});

export const pendingSends = {
  read: (conversationId: ConversationId | null): readonly Message[] => (conversationId ? sends.get(conversationId) : undefined) ?? EMPTY,
  /** A bubble only this session draws, such as an attachment on its way. */
  upsert: (conversationId: ConversationId, message: Message) => update(conversationId, (current) => upsertMessage([...current], message)),
  settle: (conversationId: ConversationId, guid: string, message: Message) => update(conversationId, (current) =>
    current.some((m) => m.guid === guid) ? settleTemp([...current], guid, message) : current),
  /** A bubble this session drew for work that is not a queued send (a new chat's first message) did not go out. Retry sends it. */
  strand: (conversationId: ConversationId, bubble: Message) => {
    neverQueued.add(bubble.clientKey!);
    pendingSends.settle(conversationId, bubble.guid, stranded(bubble, "failed"));
  },
  /** Drops the sends `keep` rejects. */
  retain: (conversationId: ConversationId, keep: (message: Message) => boolean) =>
    update(conversationId, (current) => current.every(keep) ? current : current.filter(keep)),

  /** Draws the bubble now and sends it once Convex is reachable. Resolves with the landed message, rejects when it did not go out. */
  async send(chat: Pick<ChatSummary, "conversationId" | "imessage" | "isGroup">, draft: SendDraft, client?: SendClient): Promise<Message> {
    const bubble = draftBubble(chat, draft);
    pendingSends.upsert(chat.conversationId, bubble);
    const via = client ?? await defaultClient();
    return deliver(chat.conversationId, bubble, via,
      () => runCommandVia(via, chat.conversationId, payloadOf(bubble), { clientKey: bubble.clientKey }));
  },

  /** Removes a send that has not gone out, so it never will. False once the platform has it. */
  async cancel(conversationId: ConversationId, message: Message, client?: SendClient): Promise<boolean> {
    const clientKey = message.clientKey ?? pendingClientKey(message.guid);
    if (!clientKey) return false;
    cancelled.add(clientKey);
    const held = holding.get(clientKey);
    held?.();
    const ok = held ? true : await (client ?? await defaultClient()).mutation(pendingSendsApi.cancelSend, { clientKey });
    if (ok) pendingSends.retain(conversationId, (m) => m.guid !== message.guid);
    else cancelled.delete(clientKey);
    return ok;
  },

  /** Sends a send that did not go out again, in the same bubble. Only the user's tap gets here. */
  async retry(conversationId: ConversationId, message: Message, client?: SendClient): Promise<Message> {
    const clientKey = message.clientKey ?? pendingClientKey(message.guid);
    if (!clientKey) throw new Error("Only a pending send can be retried");
    const via = client ?? await defaultClient();
    const local = neverQueued.delete(clientKey);
    const revived: Message = { ...message, clientKey: local ? clientKey : newSendKey(), sendState: "queued", error: 0, dateCreated: Date.now() };
    pendingSends.retain(conversationId, (m) => m.guid !== message.guid);
    pendingSends.upsert(conversationId, revived);
    const retryKey = revived.clientKey!;
    return deliver(conversationId, revived, via, local
      ? () => runCommandVia(via, conversationId, payloadOf(revived), { clientKey })
      : async () => {
        const commandId = await via.mutation(pendingSendsApi.retrySend, { clientKey, retryKey }) as GenericId<"comma_outbox">;
        return watchCommandVia(via, commandId, "send");
      });
  },
};

export function usePendingSends(conversationId: ConversationId | null): readonly Message[] {
  const read = () => pendingSends.read(conversationId);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The directory with each conversation moved by the newest send still on its way, the moment it is sent and
 * while it waits to reach Convex. A newer message in the directory, or the send itself, takes over.
 */
export function withPendingSends(chats: ChatSummary[], pending: ReadonlyMap<ConversationId, readonly Message[]>): ChatSummary[] {
  if (pending.size === 0) return chats;
  const shown = chats.map((chat) => {
    const send = pending.get(chat.conversationId)?.filter(inFlight).at(-1);
    const last = chat.lastMessage;
    if (!send || last?.guid === send.guid || (last && last.dateCreated > send.dateCreated)) return chat;
    return {
      ...chat,
      lastMessage: { guid: send.guid, text: send.text, dateCreated: send.dateCreated, isFromMe: true, senderName: null, hasAttachments: false },
      flags: { ...chat.flags, unresponded: false, waiting: true },
    };
  });
  return shown.every((chat, index) => chat === chats[index]) ? chats : shown;
}

/** Only ChatDirectoryProvider calls this. */
export function useDirectoryWithPendingSends(chats: ChatSummary[] | null): ChatSummary[] | null {
  const current = useSyncExternalStore(subscribe, () => sends, () => sends);
  return useMemo(() => chats && withPendingSends(chats, current), [chats, current]);
}

/** A queued send says it is waiting at once when Convex or the Mini is out of reach, and otherwise once it has waited this long. */
const WAITING_AFTER_MS = 4000;
/** Three missed bridge heartbeats (one a minute) mean the Mini is down. */
const MINI_GONE_MS = 3 * 60_000;

export function useSendWaiting(queued: boolean): boolean {
  const { isWebSocketConnected } = useConvexConnectionState();
  const lastSeenAt = useBridgeState()?.lastSeenAt;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!queued) return;
    const timer = setTimeout(() => setSlow(true), WAITING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [queued]);
  const miniGone = lastSeenAt !== undefined && Date.now() - lastSeenAt > MINI_GONE_MS;
  return queued && (!isWebSocketConnected || miniGone || slow);
}

export function resetPendingSendsForTests(): void {
  sends = new Map();
  holding.clear();
  neverQueued.clear();
  cancelled.clear();
}
