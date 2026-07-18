import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import EventSourceNative from "react-native-sse";
import { BASE_URL } from "./config";
import type { ServerEvent } from "@shared/types";

/** Single SSE subscription to the server's event stream, cross-platform. */
export function useServerEvents(onEvent: (event: ServerEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const url = `${BASE_URL}/events`;
    const dispatch = (data: string | null | undefined) => {
      if (!data) return;
      try {
        handler.current(JSON.parse(data) as ServerEvent);
      } catch {
        // ignore malformed events
      }
    };

    if (Platform.OS === "web") {
      const source = new EventSource(url);
      source.onmessage = (msg) => dispatch(msg.data as string);
      return () => source.close();
    }

    const source = new EventSourceNative(url);
    source.addEventListener("message", (event) => {
      if (event.type === "message") dispatch(event.data);
    });
    return () => {
      source.removeAllEventListeners();
      source.close();
    };
  }, []);
}
