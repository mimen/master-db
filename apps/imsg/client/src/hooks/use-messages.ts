import { usePaginatedQuery, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { registerMessageActions } from "@/lib/api";
import { mergeConvexMessages, messageToMessage } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";
import { liveMessagePreview } from "@/lib/live-message";
import { settleTemp, sortByDate, upsertMessage } from "@/lib/message-window";
import { afterPaint, markOpenRendered } from "@/lib/open-timing";
import type { Message } from "@shared/types";
import { useMessageWindow } from "./use-message-window";

export interface JumpTarget {
  guid: string;
  dateCreated: number;
}

export interface UseMessagesResult {
  /** Ascending by date. */
  messages: Message[];
  loading: boolean;
  /** The opening fetch failed and there is nothing cached to show. */
  failed: boolean;
  retry: () => void;
  hasMore: boolean;
  hasNewer: boolean;
  loadOlder: () => void;
  loadNewer: () => void;
  upsert: (message: Message) => void;
  replaceTemp: (tempGuid: string, message: Message) => void;
  remove: (guid: string) => void;
  /** Refetch the newest window and fold it in — for after an event-stream gap. */
  reconcile: () => void;
}

/**
 * Convex read path for an open thread. History comes live from the comma
 * mirror; this session's own sends live in a local overlay until their echo
 * (matched by clientKey or guid) arrives, so the optimistic bubble never
 * blinks.
 */
function useConvexMessages(conversationId: string | null, chatGuid: string | null): UseMessagesResult {
  const { results, status, loadMore } = usePaginatedQuery(
    commaApi.listMessages,
    conversationId ? { conversationId: conversationId as never } : "skip",
    { initialNumItems: 50 },
  );
  const [local, setLocal] = useState<Message[]>([]);
  useEffect(() => setLocal([]), [conversationId]);
  useEffect(() => {
    if (chatGuid && status !== "LoadingFirstPage") afterPaint(() => markOpenRendered(chatGuid, true));
  }, [chatGuid, status]);
  const remote = useMemo(() => sortByDate(results.map(messageToMessage)), [results]);
  const messages = useMemo(() => mergeConvexMessages(liveMessagePreview.withHistory(chatGuid, remote), local), [chatGuid, remote, local]);
  const upsert = useCallback((message: Message) => {
    setLocal((current) => upsertMessage(current, message));
  }, []);
  const replaceTemp = useCallback((tempGuid: string, message: Message) => {
    setLocal((current) => settleTemp(current, tempGuid, message));
  }, []);
  const remove = useCallback((guid: string) => {
    setLocal((current) => current.filter((m) => m.guid !== guid));
  }, []);
  const noop = useCallback(() => undefined, []);
  const loadOlder = useCallback(() => {
    if (status === "CanLoadMore") loadMore(50);
  }, [status, loadMore]);
  return {
    messages,
    loading: status === "LoadingFirstPage" && conversationId !== null && messages.length === 0,
    failed: false,
    retry: noop,
    hasMore: status === "CanLoadMore",
    hasNewer: false,
    loadOlder,
    loadNewer: noop,
    upsert,
    replaceTemp,
    remove,
    // Convex queries are live; there is no stream gap to reconcile.
    reconcile: noop,
  };
}

export function useMessages(chatGuid: string | null, target: JumpTarget | null): UseMessagesResult {
  const resolved = useQuery(commaApi.resolveChat, chatGuid ? { chatGuid } : "skip");
  const conversationId = resolved?._id ?? null;
  const convex = useConvexMessages(!target ? conversationId : null, !target ? chatGuid : null);
  const anchored = useMessageWindow(target ? conversationId : null, target ? chatGuid : null, target);
  const selected = target ? anchored : convex;
  const result = {
    ...selected,
    loading: chatGuid !== null && selected.messages.length === 0 && (resolved === undefined || selected.loading),
  };
  useEffect(() => registerMessageActions(result.messages), [result.messages]);
  return result;
}
