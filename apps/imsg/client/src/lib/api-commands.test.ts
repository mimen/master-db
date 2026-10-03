import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("react-native", () => ({ Platform: { OS: "web", select: (o: { web?: unknown }) => o.web } }));

const calls: { kind: string; args: unknown }[] = [];
let resolved: { _id: string } | null = { _id: "conv-1" };
mock.module("./identity", () => ({
  convexClient: {
    query: (_ref: unknown, args: unknown) => {
      calls.push({ kind: "query", args });
      return Promise.resolve(resolved);
    },
    mutation: (_ref: unknown, args: unknown) => {
      calls.push({ kind: "mutation", args });
      return Promise.resolve("outbox-1");
    },
  },
}));

const { enqueueCommand } = await import("./api");
const { setConvexSends, setDataSource } = await import("./settings");

beforeEach(() => {
  calls.length = 0;
  resolved = { _id: "conv-1" };
  setDataSource("convex");
  setConvexSends(true);
});

describe("enqueueCommand", () => {
  test("queues the command on the resolved conversation", async () => {
    expect(await enqueueCommand("iMessage;-;+15550001111", { kind: "pin", value: true })).toBe(true);
    const mutation = calls.find((call) => call.kind === "mutation")?.args as { conversationId: string; payload: unknown; clientKey: string };
    expect(mutation.conversationId).toBe("conv-1");
    expect(mutation.payload).toEqual({ kind: "pin", value: true });
    expect(mutation.clientKey.startsWith("command-")).toBe(true);
  });

  test("falls back to REST when Convex sends are off", async () => {
    setConvexSends(false);
    expect(await enqueueCommand("iMessage;-;+15550001111", { kind: "markRead" })).toBe(false);
    expect(calls).toEqual([]);
  });

  test("falls back to REST when reads aren't on Convex", async () => {
    setDataSource("server");
    expect(await enqueueCommand("iMessage;-;+15550001111", { kind: "markRead" })).toBe(false);
    expect(calls).toEqual([]);
  });

  test("falls back to REST when the chat isn't mirrored yet", async () => {
    resolved = null;
    expect(await enqueueCommand("SMS;-;+15550009999", { kind: "settle" })).toBe(false);
    expect(calls.some((call) => call.kind === "mutation")).toBe(false);
  });
});
