import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ScheduledMessage } from "@shared/types";

export { formatScheduledWhen } from "@/lib/scheduled";

export interface UseScheduledResult {
  items: ScheduledMessage[];
  loading: boolean;
  cancel: (id: string) => void;
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

  const load = useCallback(() => {
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
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = useCallback(
    (id: string) => {
      setItems((current) => current.filter((i) => i.id !== id));
      api.cancelScheduled(id).catch(() => load());
    },
    [load],
  );

  return { items, loading, cancel };
}
