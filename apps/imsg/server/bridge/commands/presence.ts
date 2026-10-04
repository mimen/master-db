import { notImplemented, type HandlerMap } from "./types";
export const presenceHandlers = { typing: notImplemented<"typing">() } satisfies Partial<HandlerMap>;
