import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Message } from "@/lib/types";

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

  useEffect(() => {
    setHasMore(false);
    setHasNewer(false);
    if (!chatGuid) {
      setMessages([]);
      return;
    }
    const gen = ++generation.current;
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
    if (!chatGuid || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;
    const gen = generation.current;
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
      .catch(() => undefined);
  }, [chatGuid, messages]);

  const loadNewer = useCallback(() => {
    if (!chatGuid || messages.length === 0) return;
    const newest = messages[messages.length - 1];
    if (!newest) return;
    const gen = generation.current;
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
      .catch(() => undefined);
  }, [chatGuid, messages]);

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

  return { messages, loading, hasMore, hasNewer, loadOlder, loadNewer, upsert, replaceTemp, remove };
}
