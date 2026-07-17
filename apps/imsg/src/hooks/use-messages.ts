import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "../../shared/types";
import { api } from "@/lib/api";

export interface JumpTarget {
  guid: string;
  dateCreated: number;
}

interface UseMessagesResult {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  /** True while viewing a jumped-to window that may not include the newest messages. */
  hasNewer: boolean;
  loadOlder: () => void;
  loadNewer: () => void;
  /** Insert or replace a message that arrived via SSE or optimistic send. */
  upsert: (message: Message) => void;
  /** Swap an optimistic temp message for its settled version (or failure marker). */
  replaceTemp: (tempGuid: string, message: Message) => void;
}

function sortByDate(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.dateCreated - b.dateCreated);
}

export function useMessages(chatGuid: string | null, target: JumpTarget | null): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setHasNewer(false);
    if (!chatGuid) return;
    const gen = ++generation.current;
    setLoading(true);
    api
      .messages(chatGuid, target ? { around: target.dateCreated } : undefined)
      .then((batch) => {
        if (generation.current !== gen) return;
        setMessages(sortByDate(batch));
        setHasMore(batch.length >= 40);
        setHasNewer(target !== null);
        setLoading(false);
      })
      .catch(() => {
        if (generation.current === gen) setLoading(false);
      });
  }, [chatGuid, target]);

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

  const upsert = useCallback((message: Message) => {
    setMessages((current) => {
      const index = current.findIndex((m) => m.guid === message.guid);
      if (index >= 0) {
        const next = [...current];
        next[index] = message;
        return next;
      }
      return sortByDate([...current, message]);
    });
  }, []);

  const replaceTemp = useCallback((tempGuid: string, message: Message) => {
    setMessages((current) =>
      sortByDate(current.map((m) => (m.guid === tempGuid ? message : m))),
    );
  }, []);

  return { messages, loading, hasMore, hasNewer, loadOlder, loadNewer, upsert, replaceTemp };
}
