import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "../../shared/types";
import { api } from "@/lib/api";

interface UseMessagesResult {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  loadOlder: () => void;
  /** Insert or replace a message that arrived via SSE or optimistic send. */
  upsert: (message: Message) => void;
}

function sortByDate(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.dateCreated - b.dateCreated);
}

export function useMessages(chatGuid: string | null): UseMessagesResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    if (!chatGuid) return;
    const gen = ++generation.current;
    setLoading(true);
    api
      .messages(chatGuid)
      .then((batch) => {
        if (generation.current !== gen) return;
        setMessages(sortByDate(batch));
        setHasMore(batch.length >= 50);
        setLoading(false);
      })
      .catch(() => {
        if (generation.current === gen) setLoading(false);
      });
  }, [chatGuid]);

  const loadOlder = useCallback(() => {
    if (!chatGuid || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;
    const gen = generation.current;
    api
      .messages(chatGuid, oldest.dateCreated)
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
        setHasMore(batch.length >= 50);
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

  return { messages, loading, hasMore, loadOlder, upsert };
}
