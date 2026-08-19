import { describe, expect, test } from "bun:test";
import { FakeBlueBubbles, type FakeChatSeed } from "./bluebubbles-fake";
import { ChatDirectory } from "./chat-directory";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";
import { wireLiveEvents } from "./live-events";
import type { ServerEvent } from "../shared/types";

const CHAT = "iMessage;-;+15550001111";

function seed(): FakeChatSeed[] {
  return [
    {
      guid: CHAT,
      participants: [{ address: "+15550001111" }],
      messages: [
        { guid: "m1", text: "hello", dateCreated: 1000, isFromMe: false, handle: { address: "+15550001111" } },
      ],
    },
  ];
}

async function setup(): Promise<{
  bb: FakeBlueBubbles;
  directory: ChatDirectory;
  broadcasts: ServerEvent[];
  invalidations: () => number;
}> {
  const bb = new FakeBlueBubbles({ chats: seed(), contacts: [] });
  const db = new OverlayDb(":memory:");
  const contacts = new ContactBook(bb);
  await contacts.refresh(true);
  const directory = new ChatDirectory(bb, db, contacts, Date.now);
  let invalidated = 0;
  directory.onEvent(() => invalidated++);
  const broadcasts: ServerEvent[] = [];
  wireLiveEvents(bb, directory, contacts, (event) => broadcasts.push(event));
  await directory.summaries(); // prime cache + sibling map like a booted server
  return { bb, directory, broadcasts, invalidations: () => invalidated };
}

describe("wireLiveEvents", () => {
  test("an inbound message broadcasts new-message under the conversation guid", async () => {
    const { bb, broadcasts } = await setup();
    bb.receiveMessage(CHAT, "fresh");
    const event = broadcasts.find((e) => e.kind === "new-message");
    expect(event).toBeDefined();
    if (event?.kind !== "new-message") throw new Error("unreachable");
    expect(event.chatGuid).toBe(CHAT);
    expect(event.message.text).toBe("fresh");
  });

  test("the boot connect broadcasts nothing — nothing was missed yet", async () => {
    const { bb, broadcasts, invalidations } = await setup();
    const invalidatedBefore = invalidations();
    bb.emit({ kind: "stream-connected" });
    expect(broadcasts).toEqual([]);
    expect(invalidations()).toBe(invalidatedBefore);
  });

  test("a reconnect rebuilds the directory and tells clients to resync", async () => {
    const { bb, directory, broadcasts, invalidations } = await setup();
    bb.emit({ kind: "stream-connected" }); // boot
    // The socket was down: a message lands without any event reaching us.
    bb.appendMessage(CHAT, {
      guid: "missed-1",
      text: "sent while the stream was down",
      dateCreated: Date.now(),
      isFromMe: false,
      handle: { address: "+15550001111" },
    });
    const invalidatedBefore = invalidations();
    bb.emit({ kind: "stream-connected" }); // recovery
    expect(broadcasts).toContainEqual({ kind: "resync" });
    expect(invalidations()).toBe(invalidatedBefore + 1);
    // The rebuilt directory now sees the missed message.
    const result = await directory.summaries();
    if (!result.ok) throw new Error(result.error);
    expect(result.chats[0]?.lastMessage?.text).toBe("sent while the stream was down");
  });
});
