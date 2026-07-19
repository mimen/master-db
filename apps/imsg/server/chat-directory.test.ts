import { describe, expect, test } from "bun:test";
import type { BBContact, BBMessage } from "./bb-types";
import { FakeBlueBubbles, type FakeChatSeed } from "./bluebubbles-fake";
import { ChatDirectory } from "./chat-directory";
import { ContactBook } from "./contacts";
import { OverlayDb } from "./db";
import { MessageSearch } from "./message-search";
import { mapMessage } from "./map";
import { matchesFilters } from "../shared/chat-state";
import type { ChatSummary } from "../shared/types";

// ---------------------------------------------------------------- fixtures

const CHAT_A = "iMessage;-;+15550001111";
const CHAT_B = "iMessage;-;+15550002222";

function inbound(guid: string, dateCreated: number, text = "hi", handle = "+15550001111"): BBMessage {
  return { guid, text, dateCreated, isFromMe: false, handle: { address: handle } };
}

const ALICE: BBContact = {
  phoneNumbers: [{ address: "+15550001111" }],
  firstName: "Alice",
  lastName: null,
  emails: [],
};
const BOB: BBContact = {
  phoneNumbers: [{ address: "+15550002222" }],
  firstName: "Bob",
  lastName: null,
  emails: [],
};

/** Two known DMs; A older, B newer, both with an inbound last message. */
function twoChatSeed(): FakeChatSeed[] {
  return [
    {
      guid: CHAT_A,
      participants: [{ address: "+15550001111" }],
      messages: [inbound("a1", 1000, "hey from alice", "+15550001111")],
    },
    {
      guid: CHAT_B,
      participants: [{ address: "+15550002222" }],
      messages: [inbound("b1", 2000, "hey from bob", "+15550002222")],
    },
  ];
}

async function setup(chats: FakeChatSeed[] = twoChatSeed()): Promise<{
  bb: FakeBlueBubbles;
  db: OverlayDb;
  directory: ChatDirectory;
  contacts: ContactBook;
}> {
  const bb = new FakeBlueBubbles({ chats, contacts: [ALICE, BOB] });
  const db = new OverlayDb(":memory:");
  const contacts = new ContactBook(bb);
  await contacts.refresh(true);
  const directory = new ChatDirectory(bb, db, contacts);
  // Bridge the event stream exactly like server/index.ts does.
  bb.onEvent((event) => {
    if (event.kind === "new-message" || event.kind === "updated-message") {
      directory.applyMessage(event.message.chats?.[0]?.guid ?? null, event.message);
    }
  });
  return { bb, db, directory, contacts };
}

function find(chats: ChatSummary[], guid: string): ChatSummary {
  const chat = chats.find((c) => c.guid === guid);
  if (!chat) throw new Error(`chat ${guid} not in summaries`);
  return chat;
}

// ---------------------------------------------------------------- summaries

describe("ChatDirectory.summaries", () => {
  test("builds a flag-annotated list from the seeded chats", async () => {
    const { directory } = await setup();
    const result = await directory.summaries();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chats.map((c) => c.guid)).toEqual([CHAT_B, CHAT_A]); // newest first
    const a = find(result.chats, CHAT_A);
    expect(a.displayName).toBe("Alice");
    expect(a.known).toBe(true);
    expect(a.lastMessage?.text).toBe("hey from alice");
    expect(a.flags.unresponded).toBe(true); // inbound last message
    expect(a.flags.unread).toBe(true);
  });
});

// ------------------------------------------------- reactive SSE fast path

describe("ChatDirectory reactive fast path", () => {
  test("inbound event patches the cache without a rebuild", async () => {
    const { bb, directory } = await setup();
    await directory.summaries();
    const rebuilds = bb.calls.queryChats;

    bb.receiveMessage(CHAT_A, "new inbound!");

    const result = await directory.summaries();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No rebuild: the cache was patched in place.
    expect(bb.calls.queryChats).toBe(rebuilds);
    expect(result.chats[0]?.guid).toBe(CHAT_A); // moved to top
    const a = find(result.chats, CHAT_A);
    expect(a.lastMessage?.text).toBe("new inbound!");
    expect(a.flags.unresponded).toBe(true);
    expect(a.flags.unread).toBe(true);
  });

  test("outbound message sets waiting and clears unresponded", async () => {
    const { bb, directory, contacts } = await setup();
    await directory.summaries();

    const sent = await bb.sendText(CHAT_A, "my reply");
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    directory.applyKnownMessage(CHAT_A, mapMessage(sent.value, CHAT_A, contacts));

    const result = await directory.summaries();
    if (!result.ok) return;
    const a = find(result.chats, CHAT_A);
    expect(a.flags.waiting).toBe(true);
    expect(a.flags.unresponded).toBe(false);
    expect(bb.sentTexts).toEqual([{ chatGuid: CHAT_A, message: "my reply" }]);
  });

  test("markRead clears unread via the local override even when BB still says unread", async () => {
    const { bb, db, directory } = await setup();
    directory.markUnread(CHAT_A);
    expect(db.getAll().get(CHAT_A)?.markedUnread).toBe(1);

    let result = await directory.summaries();
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).flags.unread).toBe(true);

    const ok = await directory.markRead(CHAT_A);
    expect(ok).toBe(true);
    expect(bb.markReadCalls).toContain(CHAT_A);

    result = await directory.summaries(); // rebuild; fake's data still shows the message unread
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).flags.unread).toBe(false);
    expect(db.getAll().get(CHAT_A)?.markedUnread).toBe(0);
  });

  test("archive excludes from the all lens; a new inbound auto-unarchives", async () => {
    const { bb, directory } = await setup();
    directory.setArchived(CHAT_A, true);

    let result = await directory.summaries();
    if (!result.ok) return;
    const visible = result.chats.filter((c) => matchesFilters(c, "all", "all"));
    expect(visible.find((c) => c.guid === CHAT_A)).toBeUndefined();
    expect(find(result.chats, CHAT_A).flags.archived).toBe(true);

    bb.receiveMessage(CHAT_A, "you around?");

    result = await directory.summaries();
    if (!result.ok) return;
    const visibleAfter = result.chats.filter((c) => matchesFilters(c, "all", "all"));
    expect(visibleAfter.find((c) => c.guid === CHAT_A)).toBeDefined();
    expect(find(result.chats, CHAT_A).flags.archived).toBe(false);
  });

  test("dismiss('unresponded') clears the flag until a newer inbound arrives", async () => {
    const { bb, directory } = await setup();
    let result = await directory.summaries();
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).flags.unresponded).toBe(true);

    const dismissed = await directory.dismiss(CHAT_A, "unresponded");
    expect(dismissed.ok).toBe(true);

    result = await directory.summaries();
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).flags.unresponded).toBe(false);

    bb.receiveMessage(CHAT_A, "still there?");

    result = await directory.summaries();
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).flags.unresponded).toBe(true);
  });

  test("changed fires for mutations but not for applyMessage", async () => {
    const { bb, directory } = await setup();
    await directory.summaries(); // build the cache first
    let changed = 0;
    directory.onEvent(() => {
      changed++;
    });

    bb.receiveMessage(CHAT_A, "quiet patch"); // fast path — no changed event
    expect(changed).toBe(0);

    directory.setArchived(CHAT_A, true);
    await directory.markRead(CHAT_A);
    await directory.dismiss(CHAT_A, "unresponded");
    expect(changed).toBe(3);
  });
});

// ---------------------------------------------------------------- search

describe("MessageSearch", () => {
  test("finds messages by substring", async () => {
    const bb = new FakeBlueBubbles({
      chats: [
        {
          guid: CHAT_A,
          messages: [
            inbound("s1", 1000, "let's get burritos tonight"),
            inbound("s2", 2000, "sounds good"),
          ],
        },
      ],
    });
    const contacts = new ContactBook(bb);
    await contacts.refresh(true);
    const search = new MessageSearch(bb, contacts);

    const results = await search.search("burrito");
    expect(results.length).toBe(1);
    expect(results[0]?.text).toContain("burrito");
  });

  test("returns nothing for queries shorter than two characters", async () => {
    const { bb, contacts } = await setup();
    const search = new MessageSearch(bb, contacts);
    expect(await search.search("a")).toEqual([]);
    expect(bb.calls.queryMessages).toBe(0); // guarded before any fetch
  });

  test("caps results at 50 matches", async () => {
    const messages: BBMessage[] = [];
    for (let i = 0; i < 60; i++) messages.push(inbound(`p${i}`, 1000 + i, `pizza plan ${i}`));
    const bb = new FakeBlueBubbles({ chats: [{ guid: CHAT_A, messages }] });
    const contacts = new ContactBook(bb);
    await contacts.refresh(true);
    const search = new MessageSearch(bb, contacts);

    const results = await search.search("pizza");
    expect(results.length).toBe(50);
  });
});
