import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ScheduledMessage } from "@shared/types";

export { formatScheduledWhen } from "@/lib/scheduled";

export interface UseScheduledResult {
  items: ScheduledMessage[];
  loading: boolean;
  cancel: (id: number) => void;
  sendNow: (id: number) => Promise<void>;
  edit: (item: ScheduledMessage, text: string, sendAt: number) => Promise<void>;
}

/**
 * Scheduled-message queue for app/scheduled.tsx: loads the list, and exposes
 * an optimistic cancel (row removed immediately) that reloads from the
 * server if the cancel request fails — same as the original inline logic.
 */
export function useScheduled(): UseScheduledResult {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const requestInFlight = useRef(false);

  const load = useCallback(() => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const gen = ++generation.current;
    api
      .listScheduled()
      .then((result) => {
        if (generation.current !== gen) return;
        setItems(result);
        setLoading(false);
      })
      .catch(() => {
        if (generation.current === gen) setLoading(false);
      })
      .finally(() => {
        requestInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const cancel = useCallback(
    (id: number) => {
      setItems((current) => current.filter((i) => i.id !== id));
      api.cancelScheduled(id).catch(() => load());
    },
    [load],
  );

  const sendNow = useCallback(
    async (id: number): Promise<void> => {
      setItems((current) => current.filter((item) => item.id !== id));
      try {
        await api.sendScheduledNow(id);
      } catch (error) {
        load();
        throw error;
      }
    },
    [load],
  );

  const edit = useCallback(
    async (item: ScheduledMessage, text: string, sendAt: number): Promise<void> => {
      const updated = await api.updateScheduled(item.id, item.chatGuid, text, sendAt);
      setItems((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
    },
    [],
  );

  return { items, loading, cancel, sendNow, edit };
}
