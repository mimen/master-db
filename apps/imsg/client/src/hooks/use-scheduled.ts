import type { CommaScheduledDoc } from "../../../../../convex/schema/comma/validators";
import { useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { scheduledToScheduled } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";
import { pendScheduled, usePendingScheduled } from "@/lib/pending-scheduled";
import { useChatDirectory } from "./use-chat-directory";
import type { ChatSummary, ScheduledMessage } from "@shared/types";

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
  return useScheduledState(rows, chats, api);
}

export function useScheduledState(
  rows: CommaScheduledDoc[] | undefined,
  chats: readonly ChatSummary[] | null,
  actions: Pick<typeof api, "cancelScheduled" | "sendScheduledNow" | "updateScheduled">,
): UseScheduledResult {
  const shown = usePendingScheduled(rows);
  const items = useMemo(() => (shown ?? []).map((row) => scheduledToScheduled(row, chats ?? [])), [shown, chats]);
  const cancel = useCallback((id: number) => {
    const pending = pendScheduled(id);
    actions.cancelScheduled(id).then(pending.confirm, pending.rollback);
  }, [actions]);
  const sendNow = useCallback(async (id: number): Promise<void> => {
    const pending = pendScheduled(id);
    try {
      await actions.sendScheduledNow(id);
      pending.confirm();
    } catch (error) {
      pending.rollback();
      throw error;
    }
  }, [actions]);
  const edit = useCallback(async (item: ScheduledMessage, text: string, sendAt: number): Promise<void> => {
    await actions.updateScheduled(item.id, item.chatGuid, text, sendAt);
  }, [actions]);
  return { items, loading: rows === undefined, cancel, sendNow, edit };
}
