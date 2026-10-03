import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import EventSourceNative from "react-native-sse";
import { BASE_URL } from "./config";
import type { ServerEvent } from "@shared/types";
import { liveMessagePreview } from "./live-message";

// The server heartbeats the stream every 25s. A connection that has produced
// neither an event nor a ping for this long is presumed dead — after a laptop
// sleep the TCP half stays "open" without ever erroring, so EventSource's own
// reconnect never fires and every event is silently lost until a reload.
const STALE_MS = 65_000;
const CHECK_MS = 15_000;

type Listener = (event: ServerEvent) => void;
type Source = { close: () => void };

// One connection for the whole app. Each open chat used to mount three
// subscribers, and each held its own EventSource: a fresh TLS stream plus a
// server fanout slot per subscriber, opened and torn down on every chat switch.
const listeners = new Set<Listener>();
let stop: (() => void) | null = null;

function emit(event: ServerEvent): void {
  liveMessagePreview.receive(event);
  for (const listener of [...listeners]) listener(event);
}

function start(): () => void {
  const url = `${BASE_URL}/events`;
  let source: Source | null = null;
  let lastBeat = Date.now();
  let everConnected = false;

  const beat = () => {
    lastBeat = Date.now();
  };

  const opened = () => {
    beat();
    if (everConnected) emit({ kind: "resync" });
    everConnected = true;
  };

  const dispatch = (data: string | null | undefined) => {
    if (!data) return;
    beat();
    let event: ServerEvent;
    try {
      event = JSON.parse(data) as ServerEvent;
    } catch {
      return;
    }
    emit(event);
  };

  const connect = () => {
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
    clearInterval(watchdog);
    removeWakeListeners();
    source?.close();
  };
}

/**
 * Subscribe to the server's event stream. All subscribers share one
 * connection, opened by the first and closed when the last unsubscribes.
 *
 * Delivery is not guaranteed: on any reconnection after the first, every
 * subscriber receives a synthetic `{ kind: "resync" }` telling it the stream
 * had a gap and it must refetch whatever it renders. A stale-stream watchdog
 * plus wake/online fast paths turn silent connection death into that same
 * resync signal.
 */
export function subscribeServerEvents(listener: Listener): () => void {
  listeners.add(listener);
  stop ??= start();
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    stop?.();
    stop = null;
  };
}

export function useServerEvents(onEvent: Listener): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => subscribeServerEvents((event) => handler.current(event)), []);
}
