import type { BlueBubbles } from "../../bluebubbles";
import { OutboundTyping } from "../presence";
import { requireChat, type CommandHandler, type HandlerMap } from "./types";

export function typingHandler(typing: OutboundTyping, now = Date.now): CommandHandler<"typing"> {
  return {
    execute: async (context, payload) => {
      const result = { kind: "typing" as const, ok: true as const };
      if (payload.active && payload.expiresAt <= now()) return result;
      context.signal.throwIfAborted();
      const current = await context.writer.deps.ingest.post("ephemeral", { state: {
        kind: "typingCurrent", clientKey: context.row.clientKey, claimToken: context.row.claimToken ?? "",
      } });
      if (!current) return result;
      context.signal.throwIfAborted();
      await typing.set(requireChat(context), payload.active, payload.expiresAt);
      return result;
    },
  };
}

const bridges = new WeakMap<BlueBubbles, OutboundTyping>();
export const presenceHandlers = {
  typing: {
    execute: async (context, payload) => {
      const bb = context.commands.bb;
      let typing = bridges.get(bb);
      if (!typing) { typing = new OutboundTyping(bb); bridges.set(bb, typing); }
      return typingHandler(typing).execute(context, payload);
    },
  },
} satisfies Partial<HandlerMap>;
