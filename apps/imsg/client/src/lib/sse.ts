import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import EventSourceNative from "react-native-sse";
import { BASE_URL } from "./config";
import type { ServerEvent } from "@shared/types";

// The server heartbeats the stream every 25s. A connection that has produced
// neither an event nor a ping for this long is presumed dead — after a laptop
// sleep the TCP half stays "open" without ever erroring, so EventSource's own
// reconnect never fires and every event is silently lost until a reload.
const STALE_MS = 65_000;
const CHECK_MS = 15_000;

type Source = { close: () => void };

/**
 * Single SSE subscription to the server's event stream, cross-platform.
 *
 * Delivery is not guaranteed: on any (re)connection after the first, the
 * handler receives a synthetic `{ kind: "resync" }` telling the consumer the
 * stream had a gap and it must refetch whatever it renders. A stale-stream
 * watchdog plus wake/online fast paths turn silent connection death into that
 * same resync signal.
 */
export function useServerEvents(onEvent: (event: ServerEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const url = `${BASE_URL}/events`;
    let source: Source | null = null;
    let lastBeat = Date.now();
    let everConnected = false;
    let disposed = false;

    const beat = () => {
      lastBeat = Date.now();
    };

    const opened = () => {
      beat();
      if (everConnected) handler.current({ kind: "resync" });
      everConnected = true;
    };

    const dispatch = (data: string | null | undefined) => {
      if (!data) return;
      beat();
      try {
        handler.current(JSON.parse(data) as ServerEvent);
      } catch {
        // ignore malformed events
      }
    };

    const connect = () => {
      if (disposed) return;
      if (Platform.OS === "web") {
        const es = new EventSource(url);
        es.onopen = opened;
        es.addEventListener("ping", beat);
        es.onmessage = (msg) => dispatch(msg.data as string);
        source = es;
        return;
      }
      const es = new EventSourceNative<"ping">(url);
      es.addEventListener("open", opened);
      es.addEventListener("ping", beat);
      es.addEventListener("message", (event) => {
        if (event.type === "message") dispatch(event.data);
      });
      source = {
        close: () => {
          es.removeAllEventListeners();
          es.close();
        },
      };
    };

    const restart = () => {
      source?.close();
      beat(); // one restart per stale window, not one per check tick
      connect();
    };

    const restartIfStale = () => {
      if (Date.now() - lastBeat > STALE_MS) restart();
    };

    connect();
    const watchdog = setInterval(restartIfStale, CHECK_MS);

    // Waking and coming back online are the moments streams die silently;
    // check immediately instead of waiting out the watchdog interval.
    let removeWakeListeners: () => void;
    if (Platform.OS === "web") {
      const onVisible = () => {
        if (document.visibilityState === "visible") restartIfStale();
      };
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("online", restartIfStale);
      removeWakeListeners = () => {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", restartIfStale);
      };
    } else {
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") restartIfStale();
      });
      removeWakeListeners = () => sub.remove();
    }

    return () => {
      disposed = true;
      clearInterval(watchdog);
      removeWakeListeners();
      source?.close();
    };
  }, []);
}
