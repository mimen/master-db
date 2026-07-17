import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSummary, StateFilter, TypeFilter } from "../../shared/types";
import { api } from "@/lib/api";

interface UseChatsResult {
  chats: ChatSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useChats(state: StateFilter, type: TypeFilter): UseChatsResult {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const gen = ++generation.current;
    api
      .chats(state, type)
      .then((result) => {
        if (generation.current !== gen) return;
        setChats(result);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (generation.current !== gen) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [state, type]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  return { chats, loading, error, refresh };
}
