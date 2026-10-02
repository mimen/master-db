import { expect, mock, test } from "bun:test";
import type { Message } from "@shared/types";

const calls: string[] = [];
let respond: (batch: Message[]) => void = () => {};

mock.module("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
mock.module("@/lib/api", () => ({
  api: {
    messages: (guid: string) => {
      calls.push(guid);
      return new Promise<Message[]>((resolve) => {
        respond = resolve;
      });
    },
  },
}));

const { fetchNewest, prefetchThread } = await import("./use-messages");

test("a press-down prefetch and the open that follows share one request", async () => {
  prefetchThread("chat-a");
  const opened = fetchNewest("chat-a");
  expect(calls).toEqual(["chat-a"]);

  respond([]);
  expect(await opened).toEqual([]);

  void fetchNewest("chat-a");
  expect(calls).toEqual(["chat-a", "chat-a"]);
});
