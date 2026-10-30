import { beforeEach, expect, mock, test } from "bun:test";
import type { ChatSummary } from "@shared/types";

if (process.env.COMMA_TRIAGE_ACTIONS_CHILD !== "1") {
  test("the settle gesture writes what the conversation's state calls for", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir,
      env: { ...process.env, COMMA_TRIAGE_ACTIONS_CHILD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exit, output: exit ? stdout + stderr : "" }).toEqual({ exit: 0, output: "" });
  });
} else {
  const { getFunctionName } = await import("convex/server");
  const { matchesFilters } = await import("@shared/chat-state");
  type Ref = Parameters<typeof getFunctionName>[0];
  type Args = { conversationId: string; anchor?: string };
  type Row = { _id: string; primaryChatGuid: string; lastMessage?: ChatSummary["lastMessage"]; lastMessageAt: number; unreadCount: number; flags: ChatSummary["flags"] };
  type Today = { day: string; dayStart: number; run: null; queue: null; cleared: { conversationId: string; at: number }[] };

  const writes: [string, Args][] = [];
  const toasts: { message: string; onPress?: () => void }[] = [];
  let held: Promise<void> = Promise.resolve();
  /** Whether Convex takes a write; a rejection carries the settle's anchor error. */
  let server: (name: string, args: Args) => boolean = () => true;

  /** Convex's side: the rows as the server lists them, Today's clear log, and the open agent chats. */
  let rows = new Map<string, Row>();
  let cleared: Today["cleared"] = [];
  let agentChats: { conversationId: string }[] = [];
  const layers = new Set<{ update: (store: unknown, args: Args) => void; args: Args }>();

  const flagsAfter: Record<string, (row: Row) => Partial<ChatSummary["flags"]>> = {
    "comma/triage:settle": () => ({ unresponded: false, waiting: false }),
    "comma/triage:unsettle": (row) => ({ unresponded: !row.lastMessage?.isFromMe, waiting: row.lastMessage?.isFromMe === true }),
  };
  function commit(name: string, args: Args): void {
    const row = rows.get(args.conversationId);
    const flags = flagsAfter[name];
    if (row && flags) rows.set(row._id, { ...row, flags: { ...row.flags, ...flags(row) } });
    if (name === "comma/triage:settle") cleared = [...cleared.filter((c) => c.conversationId !== args.conversationId), { conversationId: args.conversationId, at: 1 }];
    if (name === "comma/triage:unsettle") cleared = cleared.filter((c) => c.conversationId !== args.conversationId);
    if (name === "comma/agent:settleConversationAgents" || name === "comma/triage:settle") agentChats = agentChats.filter((c) => c.conversationId !== args.conversationId);
  }

  /** The client's view: the server's results with every outstanding optimistic update applied, as Convex's local store does. */
  function view() {
    const results = new Map<string, unknown>([
      ["comma/queries:listConversations", { page: [...rows.values()], isDone: true, continueCursor: "" }],
      ["comma/today:get", { day: "d", dayStart: 0, run: null, queue: null, cleared }],
      ["comma/agent:listAgentChats", agentChats],
    ]);
    const args = (name: string) => (name === "comma/queries:listConversations" ? { paginationOpts: { numItems: 25, cursor: null } } : name === "comma/today:get" ? { day: "d" } : {});
    const store = {
      getQuery: (ref: Ref) => results.get(getFunctionName(ref)),
      getAllQueries: (ref: Ref) => [{ args: args(getFunctionName(ref)), value: results.get(getFunctionName(ref)) }],
      setQuery: (ref: Ref, _args: unknown, value: unknown) => { results.set(getFunctionName(ref), value); },
    };
    for (const layer of layers) layer.update(store, layer.args);
    return {
      row: (id: string) => (results.get("comma/queries:listConversations") as { page: Row[] }).page.find((row) => row._id === id)!,
      cleared: (results.get("comma/today:get") as Today).cleared.map((c) => c.conversationId),
      agentChats: (results.get("comma/agent:listAgentChats") as { conversationId: string }[]).map((c) => c.conversationId),
    };
  }
  const inNeedsYou = (chat: ChatSummary) => matchesFilters({ ...chat, flags: view().row(chat.conversationId!).flags }, "unresponded", "all");

  mock.module("@/lib/toast", () => ({
    showToast: (message: string, action?: { onPress: () => void }) => toasts.push({ message, ...(action ? { onPress: action.onPress } : {}) }),
  }));
  mock.module("@/lib/identity", () => ({
    convexClient: {
      query: async () => null,
      watchQuery: () => ({ onUpdate: () => () => undefined, localQueryResult: () => undefined }),
      mutation: async (ref: Ref, args: Args, options?: { optimisticUpdate?: (store: unknown, args: Args) => void }) => {
        const name = getFunctionName(ref);
        writes.push([name, args]);
        const layer = options?.optimisticUpdate ? { update: options.optimisticUpdate, args } : null;
        if (layer) layers.add(layer);
        await held;
        if (layer) layers.delete(layer);
        if (!server(name, args)) throw new Error("[CONVEX M(comma/triage:settle)] Uncaught ConvexError: latest message changed");
        commit(name, args);
        return null;
      },
    },
  }));
  const { settleAllChats, toggleSettleChat, undoLastTriageAction } = await import("./use-triage-actions");
  const { beginUndoAction, commitUndoAction, resetUndoForTests } = await import("@/lib/action-undo");
  const { resetTriageWritesForTests } = await import("@/lib/triage-writes");

  const until = async (done: () => boolean) => {
    for (let tries = 0; !done() && tries < 50; tries++) await Bun.sleep(1);
  };
  const flags = (overrides: Partial<ChatSummary["flags"]> = {}) => ({ unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false, ...overrides });
  const agent = { attention: "open", chatId: "agent-1", title: "Marcus's set length", openCount: 1, activityAt: 1 } as const;
  /** A conversation as the directory lists it, registered on the server side. */
  const chat = (overrides: Partial<ChatSummary>): ChatSummary => {
    const summary: ChatSummary = {
      guid: "iMessage;-;+16195550206", conversationId: "conv-marcus", displayName: "Marcus Reed", isGroup: false, known: true,
      isSpam: false, participants: [], unreadCount: 0,
      lastMessage: { guid: "m1", text: "Ninety minutes works", dateCreated: 1, isFromMe: true, senderName: null, hasAttachments: false },
      flags: flags(), agent,
      ...overrides,
    };
    rows.set(summary.conversationId!, {
      _id: summary.conversationId!, primaryChatGuid: summary.guid, ...(summary.lastMessage ? { lastMessage: summary.lastMessage } : {}),
      lastMessageAt: summary.lastMessage?.dateCreated ?? 0, unreadCount: 0, flags: summary.flags,
    });
    if (summary.agent) agentChats.push({ conversationId: summary.conversationId! });
    return summary;
  };
  const owed = (n: number) => chat({
    guid: `iMessage;-;+1619555030${n}`, conversationId: `conv-${n}`, displayName: `Person ${n}`, agent: undefined,
    lastMessage: { guid: `m${n}`, text: "thanks!", dateCreated: 2, isFromMe: false, senderName: null, hasAttachments: false },
    flags: flags({ unresponded: true }),
  });
  const target = (n: number) => ({ chat: owed(n), anchor: `m${n}` });
  const hold = () => {
    let release = () => {};
    held = new Promise((resolve) => { release = resolve; });
    return () => release();
  };

  beforeEach(() => {
    writes.length = 0;
    toasts.length = 0;
    layers.clear();
    rows = new Map();
    cleared = [];
    agentChats = [];
    server = () => true;
    held = Promise.resolve();
    resetUndoForTests();
    resetTriageWritesForTests();
  });

  test("a settle leaves Needs you and becomes a done gap in Today before Convex answers, and stays gone after", async () => {
    const person = owed(1);
    const release = hold();
    const settling = toggleSettleChat(person);
    await until(() => writes.length > 0);
    expect(inNeedsYou(person), "out of Needs you while the write is in flight").toBe(false);
    expect(view().cleared, "Today's clear log has it before Convex answers").toEqual(["conv-1"]);
    release();
    await settling;
    expect(writes).toEqual([["comma/triage:settle", { conversationId: "conv-1", anchor: "m1" }]]);
    expect(inNeedsYou(person), "Convex's own result keeps it out").toBe(false);
    expect(toasts.map((t) => t.message)).toEqual(["Settled Person 1"]);
  });

  test("a settle right after a send anchors on that send, so a message after it can't be dismissed", async () => {
    const sent = { ...owed(1), lastMessage: { guid: "temp-k1", text: "on it", dateCreated: 3, isFromMe: true, senderName: null, hasAttachments: false }, flags: flags({ waiting: true }) };
    await toggleSettleChat(sent);
    expect(writes).toEqual([["comma/triage:settle", { conversationId: "conv-1", anchor: "temp-k1" }]]);
  });

  test("a settle Convex rejects brings the row back with its toast and leaves no undo entry", async () => {
    const person = owed(1);
    server = () => false;
    await toggleSettleChat(person);
    expect(inNeedsYou(person)).toBe(true);
    expect(view().cleared).toEqual([]);
    expect(toasts.map((t) => t.message)).toEqual(["Conversation changed. Review the newest message."]);
    expect(undoLastTriageAction()).toBe(false);
  });

  test("Undo un-settles the conversation and it comes back", async () => {
    const person = owed(1);
    await toggleSettleChat(person);
    expect(undoLastTriageAction()).toBe(true);
    await until(() => writes.length > 1);
    expect(writes.slice(1)).toEqual([["comma/triage:unsettle", { conversationId: "conv-1" }]]);
    await until(() => inNeedsYou(person));
    expect(inNeedsYou(person)).toBe(true);
    expect(view().cleared).toEqual([]);
  });

  test("a conversation in Needs you only for its agent chat settles those chats and leaves at once; Undo reopens only them", async () => {
    const marcus = chat({});
    const release = hold();
    const settling = toggleSettleChat(marcus);
    await until(() => writes.length > 0);
    expect(view().agentChats, "its agent chats leave the list before Convex answers").toEqual([]);
    release();
    await settling;
    expect(toasts.map((t) => t.message)).toEqual(["Settled Marcus Reed"]);
    expect(writes).toEqual([["comma/agent:settleConversationAgents", { conversationId: "conv-marcus" }]]);

    expect(undoLastTriageAction()).toBe(true);
    await until(() => writes.length > 1);
    expect(writes.slice(1), "no conversation un-settle to undismiss the anchors").toEqual([
      ["comma/agent:reopenConversationAgents", { conversationId: "conv-marcus" }],
    ]);
  });

  test("a conversation with an agent chat and no messages settles its chats", async () => {
    await toggleSettleChat(chat({ lastMessage: null }));
    expect(toasts.map((t) => t.message)).toEqual(["Settled Marcus Reed"]);
    expect(writes).toEqual([["comma/agent:settleConversationAgents", { conversationId: "conv-marcus" }]]);
  });

  test("a conversation that owes a reply settles in Convex, agent chat or not, and Undo un-settles it there", async () => {
    const replyOwed = chat({
      lastMessage: { guid: "m2", text: "How long is my set?", dateCreated: 2, isFromMe: false, senderName: null, hasAttachments: false },
      flags: flags({ unresponded: true }),
    });
    await toggleSettleChat(replyOwed);
    expect(writes).toEqual([["comma/triage:settle", { conversationId: "conv-marcus", anchor: "m2" }]]);
    expect(view().agentChats, "the conversation settle takes its agent chats too").toEqual([]);
    expect(undoLastTriageAction()).toBe(true);
    await until(() => writes.length > 1);
    expect(writes.slice(1)).toEqual([["comma/triage:unsettle", { conversationId: "conv-marcus" }]]);
  });

  test("a second press while the settle is in flight is refused as busy, not turned into an un-settle", async () => {
    const person = owed(1);
    const release = hold();
    const first = toggleSettleChat(person);
    await until(() => writes.length > 0);
    await toggleSettleChat({ ...person, flags: view().row("conv-1").flags });
    release();
    await first;
    expect(writes.map(([name]) => name)).toEqual(["comma/triage:settle"]);
    expect(toasts.map((t) => t.message)).toEqual(["Still saving that change — try again in a moment", "Settled Person 1"]);
  });

  test("Settle all settles every open row as one action: one toast, and one Undo reopens all of them", async () => {
    const quiet = chat({ guid: "iMessage;-;+16195550399", conversationId: "conv-quiet", agent: undefined, lastMessage: null });
    const first = target(1);
    await settleAllChats([first, target(2), { chat: quiet, anchor: "q" }]);
    expect(toasts.map((t) => t.message)).toEqual(["Settled 2 threads"]);
    expect(writes).toEqual([
      ["comma/triage:settle", { conversationId: "conv-1", anchor: "m1" }],
      ["comma/triage:settle", { conversationId: "conv-2", anchor: "m2" }],
    ]);
    expect(inNeedsYou(first.chat)).toBe(false);

    expect(undoLastTriageAction()).toBe(true);
    await until(() => writes.length > 3);
    expect(writes.slice(2)).toEqual([["comma/triage:unsettle", { conversationId: "conv-1" }], ["comma/triage:unsettle", { conversationId: "conv-2" }]]);
    expect(undoLastTriageAction(), "the batch was one entry").toBe(false);
  });

  test("Settle all conditions each settle on the message the build read, not the live newest one", async () => {
    const moved = chat({
      agent: undefined,
      lastMessage: { guid: "m-urgent", text: "Actually, urgent", dateCreated: 3, isFromMe: false, senderName: null, hasAttachments: false },
      flags: flags({ unresponded: true }),
    });
    await settleAllChats([{ chat: moved, anchor: "m-thanks" }]);
    expect(writes).toEqual([["comma/triage:settle", { conversationId: "conv-marcus", anchor: "m-thanks" }]]);
  });

  test("Settle all counts only the settles Convex took, reports the rest, and Undo leaves a rejected row alone", async () => {
    server = (_name, args) => args.anchor !== "m2";
    const rejected = target(2);
    await settleAllChats([target(1), rejected, target(3)]);
    expect(toasts.map((t) => t.message)).toEqual(["Settled 2 threads · 1 couldn't be settled"]);
    expect(inNeedsYou(rejected.chat), "the rejected row's optimistic settle rolled back").toBe(true);

    toasts[0]!.onPress!();
    await until(() => writes.length > 4);
    expect(writes.slice(3), "two un-settles, none for the rejected row").toEqual([
      ["comma/triage:unsettle", { conversationId: "conv-1" }], ["comma/triage:unsettle", { conversationId: "conv-3" }],
    ]);
  });

  test("the batch toast's Undo reverses that batch even after a newer action committed", async () => {
    await settleAllChats([target(1)]);
    const later: string[] = [];
    commitUndoAction(beginUndoAction(), () => later.push("newer settle undone"));
    toasts[0]!.onPress!();
    await until(() => writes.length > 1);
    expect(writes.slice(1)).toEqual([["comma/triage:unsettle", { conversationId: "conv-1" }]]);
    expect(later).toEqual([]);
    expect(undoLastTriageAction(), "keyboard Undo still takes the newest entry").toBe(true);
    expect(later).toEqual(["newer settle undone"]);
  });

  test("Settle all with nothing open says so and leaves no undo entry", async () => {
    await settleAllChats([{ chat: chat({ agent: undefined, lastMessage: null }), anchor: "q" }]);
    expect(toasts.map((t) => t.message)).toEqual(["Nothing left to settle here"]);
    expect(undoLastTriageAction()).toBe(false);
  });
}
