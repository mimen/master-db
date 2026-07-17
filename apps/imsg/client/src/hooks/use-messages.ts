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
