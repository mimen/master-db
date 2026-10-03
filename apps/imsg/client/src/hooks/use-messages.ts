import { usePaginatedQuery, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { api } from "@/lib/api";
import { mergeConvexMessages, messageToMessage } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";
import { foldReaction, mergeWindow, reconcileWindow, settleTemp, sortByDate, upsertMessage } from "@/lib/message-window";
import { afterPaint, markOpenRendered, markOpenStart } from "@/lib/open-timing";
import { useDataSource } from "@/lib/settings";
import { readThreadCache, writeThreadCache, THREAD_CACHE_MAX } from "@/lib/thread-cache";
import type { Message, ServerEvent } from "@shared/types";

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

// ------------------------------------------------------------- thread cache
// Stale-while-revalidate: opening a chat renders instantly from the cache
// while a fresh window loads behind it. Bounded LRU.
const webStorage = (() => {
  try {
    return Platform.OS === "web" && typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
})();
const threadCache = webStorage ? readThreadCache(webStorage) : new Map<string, Message[]>();
// Newest-window fetches in flight, shared so a press-down prefetch and the
// open that follows it cost one round trip, not two.
const inflightNewest = new Map<string, Promise<Message[]>>();
// Entries started by a live event: newest message only, history not fetched yet.
const partialThreads = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function flushThreadCache(): void {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (webStorage) writeThreadCache(webStorage, threadCache);
}

if (webStorage) {
  window.addEventListener("pagehide", flushThreadCache);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushThreadCache();
  });
}

function cacheThread(guid: string, messages: Message[]): void {
  threadCache.delete(guid);
  threadCache.set(guid, messages);
  if (threadCache.size > THREAD_CACHE_MAX) {
    const oldest = threadCache.keys().next().value;
    if (oldest !== undefined) threadCache.delete(oldest);
  }
  if (webStorage) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushThreadCache, 400);
  }
}

export function cachedThread(guid: string): Message[] | undefined {
  return threadCache.get(guid);
}

/**
 * Fold a live event into its chat's cached thread, open or not, so a message the
 * sidebar already shows is there the moment the chat opens. A chat with no entry
 * starts one holding just this message; the open's fetch merges history behind it.
 */
export function applyThreadEvent(event: ServerEvent): void {
  if (event.kind === "new-message" || event.kind === "updated-message") {
    const cached = threadCache.get(event.chatGuid);
    if (!cached && (event.kind !== "new-message" || event.message.retracted)) return;
    if (!cached) partialThreads.add(event.chatGuid);
    cacheThread(event.chatGuid, upsertMessage(cached ?? [], event.message));
  } else if (event.kind === "reaction") {
    const cached = threadCache.get(event.chatGuid);
    const target = cached?.find((m) => m.guid === event.targetGuid);
    if (cached && target) cacheThread(event.chatGuid, upsertMessage(cached, foldReaction(target, event)));
  }
}

export function fetchNewest(guid: string): Promise<Message[]> {
  let pending = inflightNewest.get(guid);
  if (!pending) {
    pending = api.messages(guid).finally(() => inflightNewest.delete(guid));
    inflightNewest.set(guid, pending);
  }
  return pending;
}

export function scheduleThreadPrefetch(guid: string): () => void {
  const timer = setTimeout(() => {
    if (inflightNewest.size < 2) warmThread(guid);
  }, 150);
  return () => clearTimeout(timer);
}

/** Press-down on a row: the open is coming, so start its clock and its fetch. */
export function prefetchThread(guid: string): void {
  markOpenStart(guid);
  warmThread(guid);
}

function warmThread(guid: string): void {
  if ((threadCache.has(guid) && !partialThreads.has(guid)) || inflightNewest.has(guid)) return;
  fetchNewest(guid)
    .then((batch) => {
      partialThreads.delete(guid);
      cacheThread(guid, mergeWindow(threadCache.get(guid) ?? [], sortByDate(batch)));
    })
    .catch(() => undefined);
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
  const wantsConvex = useDataSource() === "convex" && target === null && chatGuid !== null;
  // Any service-sibling guid resolves to its merged conversation.
  const resolved = useQuery(commaApi.resolveChat, wantsConvex && chatGuid ? { chatGuid } : "skip");
  const conversationId = wantsConvex && resolved ? resolved._id : null;
  // Fall back to REST while resolving, or when the bridge hasn't mirrored this chat yet.
  const convexMode = conversationId !== null;
  const convex = useConvexMessages(conversationId, convexMode ? chatGuid : null);
  const server = useServerMessages(convexMode ? null : chatGuid, target);
  return convexMode ? convex : server;
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
    const cached = !target ? threadCache.get(chatGuid) : undefined;
    if (cached && cached.length > 0) {
      // Instant render from cache; refresh silently underneath.
      setMessages(cached);
      setHasMore(cached.length >= 40);
      setLoading(false);
      afterPaint(() => markOpenRendered(chatGuid, false));
    } else {
      setMessages([]);
      setLoading(true);
    }
    (target ? api.messages(chatGuid, { around: target.dateCreated }) : fetchNewest(chatGuid))
      .then((batch) => {
        if (generation.current !== gen) return;
        const sorted = sortByDate(batch);
        if (!target) partialThreads.delete(chatGuid);
        setMessages((current) => mergeWindow(current, sorted));
        setHasMore(batch.length >= 40);
        setHasNewer(target !== null);
        setLoading(false);
        afterPaint(() => markOpenRendered(chatGuid, true));
      })
      .catch(() => {
        if (generation.current !== gen) return;
        setLoading(false);
        setFailed(!(cached && cached.length > 0));
      });
  }, [chatGuid, target, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Keep the cache current as the open thread changes (sends, SSE, edits).
  useEffect(() => {
    if (chatGuid && !target && messages.length > 0) cacheThread(chatGuid, messages);
  }, [chatGuid, target, messages]);

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
