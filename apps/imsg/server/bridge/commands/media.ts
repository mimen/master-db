import { notImplemented, type HandlerMap } from "./types";
export const mediaHandlers = {
  sendAttachment: notImplemented<"sendAttachment">(true),
  transcribe: notImplemented<"transcribe">(true),
} satisfies Partial<HandlerMap>;
