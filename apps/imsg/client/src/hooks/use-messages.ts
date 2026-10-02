import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { api } from "@/lib/api";
import { mergeWindow, reconcileWindow, settleTemp, sortByDate, upsertMessage } from "@/lib/message-window";
import { readThreadCache, writeThreadCache, THREAD_CACHE_MAX } from "@/lib/thread-cache";
import type { Message } from "@shared/types";

export interface JumpTarget {
  guid: string;
  dateCreated: number;
}

interface UseMessagesResult {
  /** Ascending by date. */
  messages: Message[];
  loading: boolean;
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
const inflightPrefetch = new Set<string>();
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

export function scheduleThreadPrefetch(guid: string): () => void {
  const timer = setTimeout(() => {
    if (inflightPrefetch.size < 2) prefetchThread(guid);
  }, 150);
  return () => clearTimeout(timer);
}

/** Warm a thread before it's opened (hover / press-down). */
export function prefetchThread(guid: string): void {
  if (threadCache.has(guid) || inflightPrefetch.has(guid)) return;
  inflightPrefetch.add(guid);
  api
    .messages(guid)
    .then((batch) => cacheThread(guid, sortByDate(batch)))
    .catch(() => undefined)
    .finally(() => inflightPrefetch.delete(guid));
}

export function useMessages(chatGuid: string | null, target: JumpTarget | null): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
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
    if (!chatGuid) {
      setMessages([]);
      return;
    }
    const gen = ++generation.current;
    pagingOlder.current = false;
    pagingNewer.current = false;
    const cached = !target ? threadCache.get(chatGuid) : undefined;
    if (cached && cached.length > 0) {
      // Instant render from cache; refresh silently underneath.
      setMessages(cached);
      setHasMore(cached.length >= 40);
      setLoading(false);
    } else {
      setMessages([]);
      setLoading(true);
    }
    api
      .messages(chatGuid, target ? { around: target.dateCreated } : undefined)
      .then((batch) => {
        if (generation.current !== gen) return;
        const sorted = sortByDate(batch);
        if (!target) cacheThread(chatGuid, sorted);
        setMessages((current) => mergeWindow(current, sorted));
        setHasMore(batch.length >= 40);
        setHasNewer(target !== null);
        setLoading(false);
      })
      .catch(() => {
        if (generation.current === gen) setLoading(false);
      });
  }, [chatGuid, target]);

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

  return { messages, loading, hasMore, hasNewer, loadOlder, loadNewer, upsert, replaceTemp, remove, reconcile };
}
