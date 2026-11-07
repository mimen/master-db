import { useSyncExternalStore } from "react";
import type { MentionAnnotation } from "@shared/mentions";
import { conversationService } from "@shared/imessage";
import type { ChatSummary, ConversationId, Message } from "@shared/types";
import { settleTemp, upsertMessage } from "./message-window";

/**
 * This session's own sends per conversation, shown in the thread until the mirror owns them. The store
 * outlives any one thread, so the forward picker and the palette can put a bubble in a chat on
 * the frame of the click, before that chat's thread has mounted.
 */
let sends: ReadonlyMap<ConversationId, readonly Message[]> = new Map();
const listeners = new Set<() => void>();
const EMPTY: readonly Message[] = [];

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

export const localSends = {
  read: (conversationId: ConversationId | null): readonly Message[] => (conversationId ? sends.get(conversationId) : undefined) ?? EMPTY,
  upsert: (conversationId: ConversationId, message: Message) => update(conversationId, (current) => upsertMessage([...current], message)),
  settle: (conversationId: ConversationId, tempGuid: string, message: Message) => update(conversationId, (current) => settleTemp([...current], tempGuid, message)),
  /** Drops the sends `keep` rejects. */
  retain: (conversationId: ConversationId, keep: (message: Message) => boolean) =>
    update(conversationId, (current) => current.every(keep) ? current : current.filter(keep)),
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocalSends(conversationId: ConversationId | null): readonly Message[] {
  const read = () => localSends.read(conversationId);
  return useSyncExternalStore(subscribe, read, read);
}

export function resetLocalSendsForTests(): void {
  sends = new Map();
}

/**
 * A send that failed takes the time it failed. The thread keeps sends in flight below everything
 * else, so a failed one moves back among the messages around its attempt and stays there.
 */
export function failedSend(temp: Message): Message {
  return { ...temp, pending: false, failed: true, dateCreated: Date.now() };
}

/** An outgoing text message drawn before the send is queued; its guid doubles as the outbox clientKey. */
export function tempMessage(
  chat: Pick<ChatSummary, "imessage">,
  text: string,
  replyTo: Message | null = null,
  mentions: readonly MentionAnnotation[] = [],
): Message {
  const guid = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    guid,
    clientKey: guid,
    chatGuid: chat.imessage.chatGuid,
    text,
    dateCreated: Date.now(),
    dateRead: null,
    dateDelivered: null,
    isFromMe: true,
    service: conversationService(chat),
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
    pending: true,
  };
}
