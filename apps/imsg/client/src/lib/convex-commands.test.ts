import { describe, expect, test } from "bun:test";
import { enqueueVia, type CommandClient } from "./convex-commands";

function client(resolved: { _id: string } | null) {
  const calls: { kind: string; args: unknown }[] = [];
  const fake: CommandClient = {
    query: (_ref, args) => {
      calls.push({ kind: "query", args });
      return Promise.resolve(resolved);
    },
    mutation: (_ref, args) => {
      calls.push({ kind: "mutation", args });
      return Promise.resolve("outbox-1");
    },
  };
  return { fake, calls };
}

describe("enqueueVia", () => {
  test("queues the command on the resolved conversation", async () => {
    const { fake, calls } = client({ _id: "conv-1" });
    expect(await enqueueVia(fake, true, "iMessage;-;+15550001111", { kind: "pin", value: true })).toBe(true);
    const mutation = calls.find((call) => call.kind === "mutation")?.args as { conversationId: string; payload: unknown; clientKey: string };
    expect(mutation.conversationId).toBe("conv-1");
    expect(mutation.payload).toEqual({ kind: "pin", value: true });
    expect(mutation.clientKey.startsWith("command-")).toBe(true);
  });

  test("falls back to REST when Convex sends aren't active", async () => {
    const { fake, calls } = client({ _id: "conv-1" });
    expect(await enqueueVia(fake, false, "iMessage;-;+15550001111", { kind: "markRead" })).toBe(false);
    expect(calls).toEqual([]);
  });

  test("falls back to REST when the chat isn't mirrored yet", async () => {
    const { fake, calls } = client(null);
    expect(await enqueueVia(fake, true, "SMS;-;+15550009999", { kind: "settle" })).toBe(false);
    expect(calls.some((call) => call.kind === "mutation")).toBe(false);
  });
});
