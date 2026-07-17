import { useEffect, useRef } from "react";
import type { ServerEvent } from "../../shared/types";

/**
 * Single SSE connection shared by the app; handlers register per-render.
 * Reconnects automatically (EventSource native behavior).
 */
export function useServerEvents(onEvent: (event: ServerEvent) => void): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const source = new EventSource("/events");
    source.onmessage = (msg) => {
      try {
        handlerRef.current(JSON.parse(msg.data) as ServerEvent);
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, []);
}
