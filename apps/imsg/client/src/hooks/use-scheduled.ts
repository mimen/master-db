import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { scheduledToScheduled } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";
import { useChatDirectory } from "./use-chat-directory";
import type { ScheduledMessage } from "@shared/types";

export { formatScheduledWhen } from "@/lib/scheduled";

export interface UseScheduledResult {
  items: ScheduledMessage[];
  loading: boolean;
  cancel: (id: number) => void;
  sendNow: (id: number) => Promise<void>;
  edit: (item: ScheduledMessage, text: string, sendAt: number) => Promise<void>;
}

export function useScheduled(): UseScheduledResult {
  const rows = useQuery(commaApi.listScheduled, {});
  const chats = useChatDirectory();
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const items = useMemo(
    () => (rows ?? []).filter((row) => !hidden.has(row.bbId)).map((row) => scheduledToScheduled(row, chats ?? [])),
    [rows, chats, hidden],
  );
  const restore = useCallback((id: number) => {
    setHidden((current) => new Set([...current].filter((value) => value !== id)));
  }, []);
  const cancel = useCallback((id: number) => {
    setHidden((current) => new Set([...current, id]));
    void api.cancelScheduled(id).catch(() => restore(id));
  }, [restore]);
  const sendNow = useCallback(async (id: number): Promise<void> => {
    setHidden((current) => new Set([...current, id]));
    try {
      await api.sendScheduledNow(id);
    } catch (error) {
      restore(id);
      throw error;
    }
  }, [restore]);
  const edit = useCallback(async (item: ScheduledMessage, text: string, sendAt: number): Promise<void> => {
    await api.updateScheduled(item.id, item.chatGuid, text, sendAt);
  }, []);
  return { items, loading: rows === undefined, cancel, sendNow, edit };
}
