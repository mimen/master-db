import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
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

function sortByDate(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.dateCreated - b.dateCreated);
}

// ------------------------------------------------------------- thread cache
// Stale-while-revalidate: opening a chat renders instantly from the cache
// while a fresh window loads behind it. Bounded LRU.
const threadCache = new Map<string, Message[]>();
const THREAD_CACHE_MAX = 30;
const inflightPrefetch = new Set<string>();

function cacheThread(guid: string, messages: Message[]): void {
  threadCache.delete(guid);
  threadCache.set(guid, messages);
  if (threadCache.size > THREAD_CACHE_MAX) {
    const oldest = threadCache.keys().next().value;
    if (oldest !== undefined) threadCache.delete(oldest);
  }
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
        setMessages(sorted);
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
        setMessages((current) => {
          const byGuid = new Map(current.map((m) => [m.guid, m]));
          let changed = false;
          for (const m of batch) {
            const known = byGuid.get(m.guid);
            if (m.retracted) {
              if (known) {
                byGuid.delete(m.guid);
                changed = true;
              }
              continue;
            }
            if (!known || JSON.stringify(known) !== JSON.stringify(m)) {
              byGuid.set(m.guid, m);
              changed = true;
            }
          }
          return changed ? sortByDate([...byGuid.values()]) : current;
        });
      })
      .catch(() => undefined);
  }, [chatGuid, target]);

  const remove = useCallback((guid: string) => {
    setMessages((current) => current.filter((m) => m.guid !== guid));
  }, []);

  const upsert = useCallback((message: Message) => {
    setMessages((current) => {
      if (message.retracted) return current.filter((m) => m.guid !== message.guid);
      const index = current.findIndex((m) => m.guid === message.guid);
      if (index >= 0) {
        const next = [...current];
        next[index] = message;
        return next;
      }
      let next = [...current, message];
      if (message.isFromMe) {
        const tempIndex = current.findIndex(
          (m) => m.pending && m.guid.startsWith("temp-") && m.text === message.text,
        );
        if (tempIndex >= 0) next = next.filter((m) => m.guid !== current[tempIndex]?.guid);
      }
      return sortByDate(next);
    });
  }, []);

  const replaceTemp = useCallback((tempGuid: string, message: Message) => {
    setMessages((current) => {
      const withoutTemp = current.filter((m) => m.guid !== tempGuid);
      const index = withoutTemp.findIndex((m) => m.guid === message.guid);
      if (index >= 0) {
        const next = [...withoutTemp];
        next[index] = message;
        return sortByDate(next);
      }
      return sortByDate([...withoutTemp, message]);
    });
  }, []);

  return { messages, loading, hasMore, hasNewer, loadOlder, loadNewer, upsert, replaceTemp, remove, reconcile };
}
