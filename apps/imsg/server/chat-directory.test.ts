import { beforeAll, describe, expect, test } from "bun:test";
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

async function setup(chats: FakeChatSeed[] = twoChatSeed(), now: () => number = Date.now): Promise<{
  bb: FakeBlueBubbles;
  db: OverlayDb;
  directory: ChatDirectory;
  contacts: ContactBook;
}> {
  const bb = new FakeBlueBubbles({ chats, contacts: [ALICE, BOB] });
  const db = new OverlayDb(":memory:");
  const contacts = new ContactBook(bb);
  await contacts.refresh(true);
  const directory = new ChatDirectory(bb, db, contacts, now);
  // Bridge the event stream exactly like server/index.ts does.
  bb.onEvent((event) => {
    if (event.kind === "new-message") {
      directory.applyMessage(event.message.chats?.[0]?.guid ?? null, event.message);
    } else if (event.kind === "updated-message") {
      directory.applyUpdatedMessage(event.message.chats?.[0]?.guid ?? null, event.message);
    }
  });
  return { bb, db, directory, contacts };
}

function find(chats: ChatSummary[], guid: string): ChatSummary {
  const chat = chats.find((c) => c.guid === guid);
  if (!chat) throw new Error(`chat ${guid} not in summaries`);
  return chat;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
    expect(a.contactsAvailable).toBe(true);
    expect(a.lastMessage?.text).toBe("hey from alice");
    expect(a.flags.unresponded).toBe(true); // inbound last message
    expect(a.flags.unread).toBe(true);
  });

  test("fails open when contact classification becomes unavailable", async () => {
    const unknownGuid = "iMessage;-;+15550003333";
    const bb = new FakeBlueBubbles({
      chats: [
        {
          guid: unknownGuid,
          participants: [{ address: "+15550003333" }],
          messages: [inbound("unknown-1", 1000, "hello", "+15550003333")],
        },
      ],
      contacts: [ALICE, BOB],
    });
    const contacts = new ContactBook(bb);
    await contacts.refresh(true);
    expect(contacts.available).toBe(true);

    const db = new OverlayDb(":memory:");
    const directory = new ChatDirectory(bb, db, contacts);
    let changes = 0;
    directory.onEvent(() => changes++);
    let result = await directory.summaries();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(matchesFilters(find(result.chats, unknownGuid), "all", "all")).toBe(false);

    bb.contacts = () => Promise.resolve({ ok: false, error: "contacts unavailable" });
    await contacts.refresh(true);
    expect(contacts.available).toBe(false);
    expect(changes).toBe(1);
    bb.contacts = () => Promise.reject(new Error("contacts transport failed"));
    await contacts.refresh(true);
    expect(contacts.available).toBe(false);

    result = await directory.summaries();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const unknown = find(result.chats, unknownGuid);
    expect(unknown.known).toBe(false);
    expect(unknown.contactsAvailable).toBe(false);
    expect(matchesFilters(unknown, "all", "all")).toBe(true);
    expect(matchesFilters(unknown, "all", "unknown")).toBe(false);
  });

  test("scans every page and records the earliest genuine unread message", async () => {
    const messages: BBMessage[] = [];
    for (let i = 0; i < 1001; i++) {
      messages.push(inbound(`page-${i}`, 10_000 - i));
    }
    const { bb, directory } = await setup([{ guid: CHAT_A, messages }]);
    const queryMessages = bb.queryMessages.bind(bb);
    const queryOptions: Array<Parameters<typeof bb.queryMessages>[0]> = [];
    bb.queryMessages = (options) => {
      queryOptions.push(options);
      return queryMessages(options);
    };

    const result = await directory.summaries();
    if (!result.ok) return;
    const chat = find(result.chats, CHAT_A);
    expect(bb.calls.queryMessages).toBe(2);
    expect(queryOptions.every((options) => options.unreadInboundOnly === true)).toBe(true);
    expect(chat.unreadCount).toBe(1001);
    expect(chat.firstUnreadAt).toBe(9_000);
  });

  test("excludes read, associated, group-event, retracted, and invalid-date messages", async () => {
    const associated = inbound("associated", 2000);
    associated.associatedMessageGuid = "target";
    associated.associatedMessageType = 2000;
    const groupEvent = inbound("group-event", 3000);
    groupEvent.itemType = 1;
    const retracted = inbound("retracted", 4000);
    retracted.dateRetracted = 5000;
    const read = inbound("read", 5000);
    read.dateRead = 6000;
    const invalidDate = inbound("invalid-date", 0);
    const { directory } = await setup([
      {
        guid: CHAT_A,
        messages: [inbound("first", 1000), associated, groupEvent, retracted, read, invalidDate],
      },
    ]);

    const result = await directory.summaries();
    if (!result.ok) return;
    const chat = find(result.chats, CHAT_A);
    expect(chat.unreadCount).toBe(1);
    expect(chat.firstUnreadAt).toBe(1000);
  });

  test("uses the genuine last message as a fallback only when the unread query fails", async () => {
    const { bb, directory } = await setup([{ guid: CHAT_A, messages: [inbound("fallback", 1000)] }]);
    bb.queryMessages = () => Promise.resolve({ ok: false, error: "offline" });

    let result = await directory.summaries();
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).unreadCount).toBe(1);
    expect(find(result.chats, CHAT_A).firstUnreadAt).toBe(1000);

    const zeroDate = await setup([{ guid: CHAT_A, messages: [inbound("zero", 0)] }]);
    zeroDate.bb.queryMessages = () => Promise.resolve({ ok: false, error: "offline" });
    result = await zeroDate.directory.summaries();
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).unreadCount).toBe(0);
    expect(find(result.chats, CHAT_A).firstUnreadAt).toBeNull();
  });

  test("coalesces concurrent unread scans", async () => {
    const { bb, directory } = await setup();
    await directory.summaries();
    const scansBefore = bb.calls.queryMessages;
    directory.invalidate(true);

    await Promise.all([directory.summaries(), directory.summaries()]);
    expect(bb.calls.queryMessages).toBe(scansBefore + 1);
  });

  test("restarts an unread scan invalidated while it is in flight", async () => {
    const { bb, directory } = await setup();
    const queryMessages = bb.queryMessages.bind(bb);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scanStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let first = true;
    bb.queryMessages = async (options) => {
      if (first) {
        first = false;
        started();
        await gate;
      }
      return queryMessages(options);
    };

    const pending = directory.summaries();
    await scanStarted;
    directory.invalidate(true);
    release();
    await pending;

    expect(bb.calls.queryMessages).toBe(2);
  });

  test("keeps the previous unread result when a later paginated scan fails", async () => {
    const messages: BBMessage[] = [];
    for (let i = 0; i < 1001; i++) messages.push(inbound(`atomic-${i}`, 10_000 - i));
    const { bb, directory } = await setup([{ guid: CHAT_A, messages }]);
    await directory.summaries();

    const queryMessages = bb.queryMessages.bind(bb);
    bb.queryMessages = (options) =>
      options.offset === 1000
        ? Promise.resolve({ ok: false, error: "page failed" })
        : queryMessages(options);
    directory.invalidate(true);

    const result = await directory.summaries();
    if (!result.ok) return;
    const chat = find(result.chats, CHAT_A);
    expect(chat.unreadCount).toBe(1001);
    expect(chat.firstUnreadAt).toBe(9_000);
  });
});

// ------------------------------------------------- reactive SSE fast path

describe("ChatDirectory reactive fast path", () => {
  test("inbound event patches the cache without a rebuild", async () => {
    const { bb, directory } = await setup();
    await directory.summaries();
    const rebuilds = bb.calls.queryChats;
    const scans = bb.calls.queryMessages;

    bb.receiveMessage(CHAT_A, "new inbound!");

    const result = await directory.summaries();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No rebuild: the cache was patched in place.
    expect(bb.calls.queryChats).toBe(rebuilds);
    expect(bb.calls.queryMessages).toBe(scans);
    expect(result.chats[0]?.guid).toBe(CHAT_A); // moved to top
    const a = find(result.chats, CHAT_A);
    expect(a.lastMessage?.text).toBe("new inbound!");
    expect(a.flags.unresponded).toBe(true);
    expect(a.flags.unread).toBe(true);
    expect(a.unreadCount).toBe(2);
    expect(a.firstUnreadAt).toBe(1000);
  });

  test("realtime junk messages keep an aged cache screened through reconciliation", async () => {
    let now = 1;
    const { bb, directory } = await setup(twoChatSeed(), () => now);
    await directory.summaries();
    const rebuilds = bb.calls.queryChats;
    now = 20_000;

    const mapped = directory.applyMessage(CHAT_A, {
      ...inbound("spam", 3000, "junk"),
      isSpam: true,
    });
    expect(mapped?.isSpam).toBe(true);

    const result = await directory.summaries();
    expect(result.ok).toBe(true);
    expect(bb.calls.queryChats).toBe(rebuilds + 1);
    if (!result.ok) return;
    const a = find(result.chats, CHAT_A);
    expect(a.isSpam).toBe(true);
    expect(matchesFilters(a, "all", "all")).toBe(false);
    expect(matchesFilters(a, "all", "unknown")).toBe(true);
  });

  test("realtime junk survives an invalidated-cache rebuild", async () => {
    const { bb, directory } = await setup();
    await directory.summaries();
    directory.invalidate();
    const rebuilds = bb.calls.queryChats;

    directory.applyMessage(CHAT_A, {
      ...inbound("spam-after-invalidate", 3000, "junk"),
      isSpam: true,
    });
    const result = await directory.summaries();

    expect(result.ok).toBe(true);
    expect(bb.calls.queryChats).toBe(rebuilds + 1);
    if (!result.ok) return;
    const a = find(result.chats, CHAT_A);
    expect(a.isSpam).toBe(true);
    expect(a.unreadCount).toBe(2);
    expect(matchesFilters(a, "all", "all")).toBe(false);
    expect(matchesFilters(a, "all", "unknown")).toBe(true);
  });

  test("concurrent stale rebuilds cannot drop realtime junk screening", async () => {
    const { bb, directory } = await setup();
    await directory.summaries();
    directory.applyMessage(CHAT_A, {
      ...inbound("concurrent-spam", 3000, "junk"),
      isSpam: true,
    });
    directory.invalidate();

    const originalQuery = bb.queryChats.bind(bb);
    const stale = await originalQuery();
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    type ChatQueryResult = Awaited<ReturnType<FakeBlueBubbles["queryChats"]>>;
    const caughtUp: ChatQueryResult = {
      ok: true,
      value: stale.value.map((chat) =>
        chat.guid === CHAT_A
          ? {
              ...chat,
              lastMessage: {
                ...chat.lastMessage!,
                guid: "concurrent-spam",
                dateCreated: 3000,
                isSpam: true,
              },
            }
          : chat,
      ),
    };
    const firstQuery = deferred<ChatQueryResult>();
    const secondQuery = deferred<ChatQueryResult>();
    let queryCount = 0;
    bb.queryChats = () => (++queryCount === 1 ? firstQuery.promise : secondQuery.promise);

    const staleBuild = directory.summaries();
    const caughtUpBuild = directory.summaries();
    secondQuery.resolve(caughtUp);
    await caughtUpBuild;
    firstQuery.resolve(stale);
    await staleBuild;

    const result = await directory.summaries();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = find(result.chats, CHAT_A);
    expect(a.isSpam).toBe(true);
    expect(matchesFilters(a, "all", "all")).toBe(false);
  });

  test("updated junk classification replaces the realtime override", async () => {
    const { directory } = await setup();
    await directory.summaries();
    directory.applyMessage(CHAT_A, {
      ...inbound("spam-update", 3000, "junk"),
      isSpam: true,
    });
    directory.applyUpdatedMessage(CHAT_A, {
      ...inbound("spam-update", 3000, "not junk"),
      isSpam: false,
    });

    const result = await directory.summaries();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = find(result.chats, CHAT_A);
    expect(a.isSpam).toBe(false);
    expect(matchesFilters(a, "all", "all")).toBe(true);
  });

  test("junk override preserves local read and archive state", async () => {
    const { directory } = await setup();
    await directory.summaries();
    directory.applyMessage(CHAT_A, {
      ...inbound("spam-state", 3000, "junk"),
      isSpam: true,
    });
    expect(await directory.markRead(CHAT_A)).toBe(true);
    directory.setArchived(CHAT_A, true);

    const result = await directory.summaries();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = find(result.chats, CHAT_A);
    expect(a.isSpam).toBe(true);
    expect(a.flags.unread).toBe(false);
    expect(a.flags.archived).toBe(true);
  });

  test("updated messages invalidate summaries for authoritative reconciliation", async () => {
    const { bb, directory } = await setup();
    await directory.summaries();
    const rebuilds = bb.calls.queryChats;

    directory.applyUpdatedMessage(CHAT_A, {
      guid: "a1",
      dateCreated: 1000,
      dateRead: 2000,
      isFromMe: false,
      chats: [{ guid: CHAT_A }],
    });
    await directory.summaries();

    expect(bb.calls.queryChats).toBe(rebuilds + 1);
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
    expect(find(result.chats, CHAT_A).unreadCount).toBe(1);
    expect(find(result.chats, CHAT_A).firstUnreadAt).toBe(1000);

    const ok = await directory.markRead(CHAT_A);
    expect(ok).toBe(true);
    expect(bb.markReadCalls).toContain(CHAT_A);

    result = await directory.summaries(); // rebuild; fake's data still shows the message unread
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).flags.unread).toBe(false);
    expect(find(result.chats, CHAT_A).unreadCount).toBe(0);
    expect(find(result.chats, CHAT_A).firstUnreadAt).toBeNull();
    expect(db.getAll().get(CHAT_A)?.markedUnread).toBe(0);
  });

  test("manual unread does not invent an unread timestamp", async () => {
    const { directory } = await setup([
      {
        guid: CHAT_A,
        messages: [{ guid: "outbound", text: "sent", dateCreated: 1000, isFromMe: true }],
      },
    ]);
    directory.markUnread(CHAT_A);

    const result = await directory.summaries();
    if (!result.ok) return;
    const chat = find(result.chats, CHAT_A);
    expect(chat.flags.unread).toBe(true);
    expect(chat.unreadCount).toBe(0);
    expect(chat.firstUnreadAt).toBeNull();
  });

  test("manual unread updates an already-cached summary immediately", async () => {
    const { directory } = await setup([
      {
        guid: CHAT_A,
        messages: [{ guid: "outbound", text: "sent", dateCreated: 1000, isFromMe: true }],
      },
    ]);
    let result = await directory.summaries();
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).flags.unread).toBe(false);

    directory.markUnread(CHAT_A);
    result = await directory.summaries();
    if (!result.ok) return;
    expect(find(result.chats, CHAT_A).flags.unread).toBe(true);
    expect(find(result.chats, CHAT_A).firstUnreadAt).toBeNull();
  });

  test("manual unread preserves suppression of BlueBubbles read lag", async () => {
    const { directory } = await setup();
    await directory.summaries();
    expect(await directory.markRead(CHAT_A)).toBe(true);
    directory.markUnread(CHAT_A);

    const result = await directory.summaries();
    if (!result.ok) return;
    const chat = find(result.chats, CHAT_A);
    expect(chat.flags.unread).toBe(true);
    expect(chat.unreadCount).toBe(0);
    expect(chat.firstUnreadAt).toBeNull();
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
  // Force the BlueBubbles fallback path: no local chat.db in the test env.
  beforeAll(() => {
    process.env.CHATDB_PATH = "/nonexistent/chat.db";
  });

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
