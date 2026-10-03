import type { ConvexConversation, ConvexMessage } from "../../client/src/lib/convex-adapters";
import type { ServerEvent } from "../../shared/types";
import { expect, test } from "../fixtures/desk";

test("isolated desk serves Convex chats, sends, receives, and fans out SSE", async ({ desk }) => {
  const health = await desk.request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ ok: true, privateApi: true });

  const chatsResponse = await desk.request.post("/__fixture/convex", {
    data: { name: "comma/queries:listConversations", args: { paginationOpts: { numItems: 100, cursor: null } } },
  });
  expect(chatsResponse.ok()).toBe(true);
  const chatsPage = (await chatsResponse.json()) as { page: ConvexConversation[]; isDone: boolean; continueCursor: string };
  expect(chatsPage).toMatchObject({ isDone: true, continueCursor: expect.any(String) });
  const chats = chatsPage.page;
  expect(chats).toHaveLength(17);
  const conversation = chats.find((chat) => chat.primaryChatGuid === desk.chats.needs)!;
  expect(conversation).toMatchObject({
    displayName: "Alex Rivera",
    flags: { pinned: true, unresponded: true, waiting: false },
  });
  expect(chats.find((chat) => chat.primaryChatGuid === desk.chats.waiting)?.flags.waiting).toBe(true);
  expect(chats.find((chat) => chat.primaryChatGuid === desk.chats.coldSms)?.flags.waiting).toBe(true);
  expect(chats.find((chat) => chat.primaryChatGuid === desk.chats.unknown)).toMatchObject({
    participants: [{ address: "+16195550999", name: null }],
  });

  await desk.page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(desk.page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  const sseEvent = desk.page.evaluate(() => new Promise<ServerEvent>((resolve, reject) => {
    const stream = new EventSource("/events");
    const timeout = window.setTimeout(() => {
      stream.close();
      reject(new Error("timed out waiting for fixture SSE"));
    }, 8_000);
    stream.onopen = () => {
      document.documentElement.dataset.fixtureSseOpen = "true";
    };
    stream.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as ServerEvent;
      if (parsed.kind !== "new-message" || parsed.message.isFromMe) return;
      window.clearTimeout(timeout);
      stream.close();
      resolve(parsed);
    };
  }));
  await desk.page.waitForFunction(() => document.documentElement.dataset.fixtureSseOpen === "true");

  const outboundText = "Doors are at 8. I will arrive by 7:15.";
  const send = await desk.request.post("/__fixture/convex", {
    data: {
      name: "comma/outbox:enqueue",
      args: { conversationId: conversation._id, clientKey: "fixture-smoke-send", payload: { kind: "send", text: outboundText } },
    },
  });
  expect(send.ok()).toBe(true);

  const inboundText = "Perfect, see you then.";
  await desk.receive(desk.chats.needs, inboundText, "+16195550101");
  await expect(sseEvent).resolves.toMatchObject({
    kind: "new-message",
    chatGuid: desk.chats.needs,
    message: { text: inboundText, isFromMe: false },
  });

  const thread = await desk.request.post("/__fixture/convex", {
    data: { name: "comma/queries:listMessages", args: { conversationId: conversation._id, paginationOpts: { numItems: 100, cursor: null } } },
  });
  expect(thread.ok()).toBe(true);
  const messages = ((await thread.json()) as { page: ConvexMessage[] }).page;
  expect(messages.find((message) => message.text === outboundText)).toMatchObject({
    chatGuid: desk.chats.needs,
    isFromMe: true,
    clientKey: "fixture-smoke-send",
  });
  expect(messages.slice(0, 2).map((message) => message.text)).toEqual([inboundText, outboundText]);
});
