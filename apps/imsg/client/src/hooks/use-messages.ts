import { usePaginatedQuery, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, registerMessageActions } from "@/lib/api";
import { mergeConvexMessages, messageToMessage } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";
import { mergeWindow, reconcileWindow, settleTemp, sortByDate, upsertMessage } from "@/lib/message-window";
import { afterPaint, markOpenRendered, markOpenStart } from "@/lib/open-timing";
import type { Message } from "@shared/types";

export interface JumpTarget {
  guid: string;
  dateCreated: number;
}

interface UseMessagesResult {
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
 * blinks. Jump-to-message windows stay on the REST path.
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
  const messages = useMemo(() => mergeConvexMessages(remote, local), [remote, local]);
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
    loading: status === "LoadingFirstPage" && conversationId !== null,
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
  const resolved = useQuery(commaApi.resolveChat, chatGuid && !target ? { chatGuid } : "skip");
  const convex = useConvexMessages(resolved?._id ?? null, !target ? chatGuid : null);
  // Historical jump windows have no Convex equivalent yet.
  const server = useServerMessages(target ? chatGuid : null, target);
  const result = target ? server : { ...convex, loading: chatGuid !== null && (resolved === undefined || convex.loading) };
  useEffect(() => registerMessageActions(result.messages), [result.messages]);
  return result;
}

function useServerMessages(chatGuid: string | null, target: JumpTarget | null): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const generation = useRef(0);
  // A flick fires onEndReached/onStartReached repeatedly against the same cursor
  // before the first response lands; these latch one request per direction.
  const pagingOlder = useRef(false);
  const pagingNewer = useRef(false);

  useEffect(() => {
    setHasMore(false);
    setHasNewer(false);
    setFailed(false);
    if (!chatGuid) {
      setMessages([]);
      return;
    }
    const gen = ++generation.current;
    pagingOlder.current = false;
    pagingNewer.current = false;
    markOpenStart(chatGuid);
    setMessages([]);
    setLoading(true);
    api.messages(chatGuid, { around: target?.dateCreated })
      .then((batch) => {
        if (generation.current !== gen) return;
        const sorted = sortByDate(batch);
        setMessages((current) => mergeWindow(current, sorted));
        setHasMore(batch.length >= 40);
        setHasNewer(target !== null);
        setLoading(false);
        afterPaint(() => markOpenRendered(chatGuid, true));
      })
      .catch(() => {
        if (generation.current !== gen) return;
        setLoading(false);
        setFailed(true);
      });
  }, [chatGuid, target, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const loadOlder = useCallback(() => {
    if (!chatGuid || messages.length === 0 || pagingOlder.current) return;
    const oldest = messages[0];
    if (!oldest) return;
    const gen = generation.current;
    pagingOlder.current = true;
    api
      .messages(chatGuid, { before: oldest.dateCreated })
      .then((batch) => {
        if (generation.current !== gen) return;
        if (batch.length === 0) {
          setHasMore(false);
          return;
        }
        setMessages((current) => {
          const known = new Set(current.map((m) => m.guid));
          const older = batch.filter((m) => !known.has(m.guid));
          return sortByDate([...older, ...current]);
        });
        setHasMore(batch.length >= 40);
      })
      .catch(() => undefined)
      .finally(() => {
        pagingOlder.current = false;
      });
  }, [chatGuid, messages]);

  const loadNewer = useCallback(() => {
    if (!chatGuid || messages.length === 0 || pagingNewer.current) return;
    const newest = messages[messages.length - 1];
    if (!newest) return;
    const gen = generation.current;
    pagingNewer.current = true;
    api
      .messages(chatGuid, { after: newest.dateCreated })
      .then((batch) => {
        if (generation.current !== gen) return;
        if (batch.length < 40) setHasNewer(false);
        if (batch.length === 0) return;
        setMessages((current) => {
          const known = new Set(current.map((m) => m.guid));
          const newer = batch.filter((m) => !known.has(m.guid));
          return sortByDate([...current, ...newer]);
        });
      })
      .catch(() => undefined)
      .finally(() => {
        pagingNewer.current = false;
      });
  }, [chatGuid, messages]);

  // After an SSE gap (sleep, dropped stream) anything that arrived meanwhile
  // was simply never delivered — refetch the newest window and merge. Skipped
  // while anchored in history (target/hasNewer): folding the newest page into
  // an older window would render a false continuity across the unloaded gap.
  const reconcile = useCallback(() => {
    if (!chatGuid || target || pagingNewer.current) return;
    const gen = generation.current;
    api
      .messages(chatGuid)
      .then((batch) => {
        if (generation.current !== gen) return;
        setMessages((current) => reconcileWindow(current, batch));
      })
      .catch(() => undefined);
  }, [chatGuid, target]);

  const remove = useCallback((guid: string) => {
    setMessages((current) => current.filter((m) => m.guid !== guid));
  }, []);

  const upsert = useCallback((message: Message) => {
    setMessages((current) => upsertMessage(current, message));
  }, []);

  const replaceTemp = useCallback((tempGuid: string, message: Message) => {
    setMessages((current) => settleTemp(current, tempGuid, message));
  }, []);

  return { messages, loading, failed, retry, hasMore, hasNewer, loadOlder, loadNewer, upsert, replaceTemp, remove, reconcile };
}
