import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import EventSourceNative from "react-native-sse";
import { BASE_URL } from "./config";
import type { ServerEvent } from "@shared/types";

/**
 * ONE connection for the whole app, owned here rather than per component.
 *
 * Two failures this exists to survive:
 *  - react-native-sse only re-polls on an HTTP status; a transport-level drop
 *    (Mini asleep, tailnet blip, iOS suspending the socket in the background)
 *    reports status 0 and matched none of its retry branches, so the stream
 *    died silently and nothing ever revived it.
 *  - Nothing listened for the app returning to the foreground, so a resume
 *    showed whatever was on screen an hour ago with no indication it was stale.
 */

type Listener = (event: ServerEvent) => void;

const listeners = new Set<Listener>();
const liveListeners = new Set<() => void>();

type Source = { close: () => void };

let source: Source | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let live = false;

/** True while the event stream is connected. Drives the stale/offline banner. */
export function isStreamLive(): boolean {
  return live;
}

export function subscribeStreamLive(onChange: () => void): () => void {
  liveListeners.add(onChange);
  return () => {
    liveListeners.delete(onChange);
  };
}

function setLive(next: boolean): void {
  if (live === next) return;
  live = next;
  for (const l of liveListeners) l();
}

function dispatch(data: string | null | undefined): void {
  if (!data) return;
  let event: ServerEvent;
  try {
    event = JSON.parse(data) as ServerEvent;
  } catch {
    return; // malformed frame — never let it kill the stream
  }
  setLive(true);
  for (const listener of [...listeners]) listener(event);
}

/** Exponential backoff with jitter, capped — a sleeping Mini must not be hammered. */
function scheduleReconnect(): void {
  if (retry !== null) return;
  const delay = Math.min(30_000, 500 * 2 ** attempt) * (0.7 + Math.random() * 0.6);
  attempt++;
  retry = setTimeout(() => {
    retry = null;
    connect();
  }, delay);
}

function connect(): void {
  disconnect();
  const url = `${BASE_URL}/events`;

  if (Platform.OS === "web") {
    const es = new EventSource(url);
    es.onopen = () => {
      attempt = 0;
      setLive(true);
    };
    es.onmessage = (msg) => dispatch(msg.data as string);
    es.onerror = () => {
      setLive(false);
      disconnect();
      scheduleReconnect();
    };
    source = { close: () => es.close() };
    return;
  }

  const es = new EventSourceNative(url);
  es.addEventListener("open", () => {
    attempt = 0;
    setLive(true);
  });
  es.addEventListener("message", (event) => {
    if (event.type === "message") dispatch(event.data);
  });
  // Covers the status-0 case the library drops on the floor.
  es.addEventListener("error", () => {
    setLive(false);
    scheduleReconnect();
  });
  source = {
    close: () => {
      es.removeAllEventListeners();
      es.close();
    },
  };
}

function disconnect(): void {
  source?.close();
  source = null;
}

/** Force a fresh stream now — used on foreground and by the retry banner. */
export function reconnectStream(): void {
  if (retry) {
    clearTimeout(retry);
    retry = null;
  }
  attempt = 0;
  connect();
}

let appStateBound = false;
function bindAppState(): void {
  if (appStateBound) return;
  appStateBound = true;
  AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    // iOS suspends sockets in the background and the resumed one is usually
    // dead. Cheaper to always rebuild than to probe a socket that lies.
    reconnectStream();
    for (const onResume of [...resumeListeners]) onResume();
  });
}

const resumeListeners = new Set<() => void>();

/**
 * Runs when the app returns to the foreground, after the stream is rebuilt.
 * Anything showing server state should refetch here — events that landed while
 * backgrounded were never delivered.
 */
export function useAppResume(onResume: () => void): void {
  const handler = useRef(onResume);
  handler.current = onResume;
  useEffect(() => {
    const run = (): void => handler.current();
    resumeListeners.add(run);
    bindAppState();
    return () => {
      resumeListeners.delete(run);
    };
  }, []);
}

/** Subscribe to the shared stream. Every caller shares one connection. */
export function useServerEvents(onEvent: Listener): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const listener: Listener = (event) => handler.current(event);
    listeners.add(listener);
    bindAppState();
    if (listeners.size === 1) connect();
    return () => {
      listeners.delete(listener);
      // Last subscriber leaving tears the stream down; a remount rebuilds it.
      if (listeners.size === 0) {
        if (retry) {
          clearTimeout(retry);
          retry = null;
        }
        disconnect();
        setLive(false);
      }
    };
  }, []);
}
