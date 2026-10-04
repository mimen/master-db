import { describe, expect, test } from "bun:test";
import { FakeBlueBubbles, type FakeChatSeed } from "./bluebubbles-fake";
import { ChatDirectory } from "./chat-directory";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";
import { wireLiveEvents } from "./live-events";

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
  db: OverlayDb;
  invalidations: () => number;
}> {
  const bb = new FakeBlueBubbles({ chats: seed(), contacts: [] });
  const db = new OverlayDb(":memory:");
  const contacts = new ContactBook(bb);
  await contacts.refresh(true);
  const directory = new ChatDirectory(bb, db, contacts, Date.now);
  let invalidated = 0;
  directory.onEvent(() => invalidated++);
  wireLiveEvents(bb, directory, contacts);
  await directory.summaries(); // prime cache + sibling map like a booted server
  return { bb, db, directory, invalidations: () => invalidated };
}

describe("wireLiveEvents", () => {
  test("an inbound message updates the directory and persisted triage", async () => {
    const { bb, directory, db } = await setup();
    bb.receiveMessage(CHAT, "fresh");
    const result = await directory.summaries();
    if (!result.ok) throw new Error(result.error);
    expect(result.chats[0]?.lastMessage?.text).toBe("fresh");
    expect(db.getOpenTriageItem(CHAT)?.messageGuid).toBe(result.chats[0]?.lastMessage?.guid);
  });

  test("the boot connect leaves the primed directory intact", async () => {
    const { bb, invalidations } = await setup();
    const invalidatedBefore = invalidations();
    bb.emit({ kind: "stream-connected" });
    expect(invalidations()).toBe(invalidatedBefore);
  });

  test("reconnect persists a missed inbound's open triage item", async () => {
    const { bb, db } = await setup();
    bb.emit({ kind: "stream-connected" });
    expect(db.getOpenTriageItem(CHAT)).toBeNull();
    bb.appendMessage(CHAT, { guid: "missed", text: "hello again", dateCreated: Date.now() + 1000, isFromMe: false });
    bb.emit({ kind: "stream-connected" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.getOpenTriageItem(CHAT)?.messageGuid).toBe("missed");
  });

  test("a reconnect rebuilds the directory", async () => {
    const { bb, directory, invalidations } = await setup();
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
    expect(invalidations()).toBe(invalidatedBefore + 1);
    // The rebuilt directory now sees the missed message.
    const result = await directory.summaries();
    if (!result.ok) throw new Error(result.error);
    expect(result.chats[0]?.lastMessage?.text).toBe("sent while the stream was down");
  });
});
