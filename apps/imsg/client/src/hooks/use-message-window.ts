import type { Message } from "@shared/types";
import { useConvex, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { JumpTarget, UseMessagesResult } from "./use-messages";

import { messageToMessage } from "@/lib/convex-adapters";
import { messageWindow, type MessageWindowArgs } from "@/lib/history-api";
import { mergeWindow, reconcileWindow, settleTemp, upsertMessage } from "@/lib/message-window";
import { afterPaint, markOpenRendered, markOpenStart } from "@/lib/open-timing";

export function useMessageWindow(conversationId: string | null, chatGuid: string | null, target: JumpTarget | null): UseMessagesResult {
  const convexClient = useConvex();
  const around = target?.dateCreated;
  const targetGuid = target?.guid;
  const batch = useQuery(messageWindow, conversationId && around !== undefined
    ? { conversationId: conversationId as MessageWindowArgs["conversationId"], around } : "skip");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const generation = useRef(0);
  const previousBatch = useRef<Message[] | undefined>(undefined);
  const pagingOlder = useRef(false);
  const pagingNewer = useRef(false);
  const loadedOlder = useRef(false);
  const loadedNewer = useRef(false);

  useEffect(() => {
    generation.current++;
    pagingOlder.current = false;
    pagingNewer.current = false;
    previousBatch.current = undefined;
    loadedOlder.current = false;
    loadedNewer.current = false;
    setMessages([]);
    setHasMore(false);
    setHasNewer(false);
    if (chatGuid) markOpenStart(chatGuid);
  }, [conversationId, chatGuid, around, targetGuid]);

  useEffect(() => {
    if (!batch || !chatGuid || around === undefined) return;
    const remote = batch.map(messageToMessage);
    const fetched = new Set(remote.map((message) => message.guid));
    const removed = new Set((previousBatch.current ?? []).filter((message) => !fetched.has(message.guid)).map((message) => message.guid));
    const initial = previousBatch.current === undefined;
    setMessages((current) => initial ? mergeWindow(current, remote)
      : reconcileWindow(current.filter((message) => !removed.has(message.guid)), remote));
    previousBatch.current = remote;
    if (!loadedOlder.current) setHasMore(remote.filter((message) => message.dateCreated <= around).length >= 40);
    if (!loadedNewer.current) setHasNewer(remote.filter((message) => message.dateCreated > around).length >= 40);
    afterPaint(() => markOpenRendered(chatGuid, true));
  }, [batch, chatGuid, around, targetGuid]);

  const load = useCallback((direction: "before" | "after") => {
    const latch = direction === "before" ? pagingOlder : pagingNewer;
    const edge = direction === "before" ? messages[0] : messages.at(-1);
    if (!conversationId || !edge || latch.current) return;
    const gen = generation.current;
    latch.current = true;
    void convexClient.query(messageWindow, {
      conversationId: conversationId as MessageWindowArgs["conversationId"], [direction]: edge.dateCreated,
    }).then((rows) => {
      if (generation.current !== gen) return;
      (direction === "before" ? loadedOlder : loadedNewer).current = true;
      const remote = rows.map(messageToMessage);
      setMessages((current) => reconcileWindow(current, remote));
      (direction === "before" ? setHasMore : setHasNewer)(rows.length >= 40);
    }).catch(() => undefined).finally(() => {
      if (generation.current === gen) latch.current = false;
    });
  }, [convexClient, conversationId, messages]);
  const loadOlder = useCallback(() => load("before"), [load]);
  const loadNewer = useCallback(() => load("after"), [load]);
  const upsert = useCallback((message: Message) => setMessages((current) => upsertMessage(current, message)), []);
  const replaceTemp = useCallback((tempGuid: string, message: Message) => setMessages((current) => settleTemp(current, tempGuid, message)), []);
  const remove = useCallback((guid: string) => setMessages((current) => current.filter((message) => message.guid !== guid)), []);
  const noop = useCallback(() => undefined, []);
  return {
    messages, loading: conversationId !== null && batch === undefined, failed: false,
    retry: noop, hasMore, hasNewer, loadOlder, loadNewer, upsert, replaceTemp, remove,
    // The anchored subscription reconciles live changes without a REST refresh.
    reconcile: noop,
  };
}
