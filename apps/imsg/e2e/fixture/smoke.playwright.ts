import type { ChatSummary, Message, ServerEvent } from "../../shared/types";
import { expect, test } from "../fixtures/desk";

test("isolated desk serves chats, sends, receives, and fans out SSE", async ({ desk }) => {
  const health = await desk.request.get("/api/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ ok: true, privateApi: true });

  const chatsResponse = await desk.request.get("/api/chats?state=any");
  expect(chatsResponse.ok()).toBe(true);
  const chats = (await chatsResponse.json()) as ChatSummary[];
  expect(chats).toHaveLength(17);
  expect(chats.find((chat) => chat.guid === desk.chats.needs)).toMatchObject({
    displayName: "Alex Rivera",
    flags: { pinned: true, unresponded: true, waiting: false },
    crm: { is_favorite: true, priority: 1 },
  });
  expect(chats.find((chat) => chat.guid === desk.chats.waiting)?.flags.waiting).toBe(true);
  expect(chats.find((chat) => chat.guid === desk.chats.archived)?.flags.archived).toBe(true);
  expect(chats.find((chat) => chat.guid === desk.chats.unknown)).toMatchObject({
    known: false,
    participants: [{ address: "+16195550999" }],
  });

  await desk.page.goto("/", { waitUntil: "domcontentloaded" });
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
      if (parsed.kind !== "new-message") return;
      window.clearTimeout(timeout);
      stream.close();
      resolve(parsed);
    };
  }));
  await desk.page.waitForFunction(() => document.documentElement.dataset.fixtureSseOpen === "true");

  const outboundText = "Doors are at 8. I will arrive by 7:15.";
  const send = await desk.request.post(`/api/chats/${desk.chats.needs}/send`, {
    data: { text: outboundText },
  });
  expect(send.ok()).toBe(true);
  expect((await send.json()) as Message).toMatchObject({
    chatGuid: desk.chats.needs,
    text: outboundText,
    isFromMe: true,
  });

  const inboundText = "Perfect, see you then.";
  await desk.receive(desk.chats.needs, inboundText, "+16195550101");
  await expect(sseEvent).resolves.toMatchObject({
    kind: "new-message",
    chatGuid: desk.chats.needs,
    message: { text: inboundText, isFromMe: false },
  });

  const thread = await desk.request.get(`/api/chats/${desk.chats.needs}/messages`);
  expect(thread.ok()).toBe(true);
  const messages = (await thread.json()) as Message[];
  expect(messages.slice(-2).map((message) => message.text)).toEqual([outboundText, inboundText]);
});
