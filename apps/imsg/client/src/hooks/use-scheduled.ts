import type { CommaScheduledDoc } from "../../../../../convex/schema/comma/validators";
import { useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { scheduledToScheduled } from "@/lib/convex-adapters";
import { commaApi } from "@/lib/convex-api";
import { pendScheduled, usePendingScheduled } from "@/lib/pending-scheduled";
import type { ScheduledItem } from "@/lib/scheduled";
import { useChatDirectory } from "./use-chat-directory";
import type { ChatSummary } from "@shared/types";

export { formatScheduledWhen } from "@/lib/scheduled";

export interface UseScheduledResult {
  items: ScheduledItem[];
  loading: boolean;
  cancel: (item: ScheduledItem) => Promise<void>;
  sendNow: (item: ScheduledItem) => Promise<void>;
  edit: (item: ScheduledItem, text: string, sendAt: number) => Promise<void>;
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
  /** Takes the message off the queue at once, and puts it back if the command fails. */
  const pended = useCallback(async (item: ScheduledItem, run: () => Promise<void>): Promise<void> => {
    const pending = pendScheduled(item.id);
    try {
      await run();
      pending.confirm();
    } catch (error) {
      pending.rollback();
      throw error;
    }
  }, []);
  const cancel = useCallback((item: ScheduledItem) => pended(item, () => actions.cancelScheduled(item)), [actions, pended]);
  const sendNow = useCallback((item: ScheduledItem) => pended(item, () => actions.sendScheduledNow(item)), [actions, pended]);
  const edit = useCallback((item: ScheduledItem, text: string, sendAt: number) => actions.updateScheduled(item, text, sendAt), [actions]);
  return { items, loading: rows === undefined, cancel, sendNow, edit };
}
