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
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { getFunctionName } = await import("convex/server");
  const { matchesFilters } = await import("@shared/chat-state");

  const writes: [string, unknown][] = [];
  const toasts: string[] = [];
  let held: Promise<void> = Promise.resolve();
  mock.module("@/lib/toast", () => ({ showToast: (message: string) => toasts.push(message) }));
  mock.module("@/lib/identity", () => ({
    convexClient: {
      query: async () => ({ _id: "conv-resolved" }),
      mutation: async (ref: Parameters<typeof getFunctionName>[0], args: { payload?: unknown }) => {
        const name = getFunctionName(ref);
        writes.push([name, name === "comma/outbox:enqueue" ? args.payload : args]);
        await held;
        return "outbox-1";
      },
      // The bridge never answers, so a bridge write stays pending once queued.
      watchQuery: () => ({ onUpdate: () => () => undefined, localQueryResult: () => undefined }),
    },
  }));
  const { settleAllChats, toggleSettleChat, undoLastTriageAction } = await import("./use-triage-actions");
  const { resetPendingFlagsForTests, usePendingFlags } = await import("@/lib/pending-flags");
  const { resetUndoForTests } = await import("@/lib/action-undo");

  /** The row as the directory shows it now, pending intents applied. */
  const shown = (chat: ChatSummary) => {
    let rows: ChatSummary[] | null = null;
    renderToString(createElement(() => {
      rows = usePendingFlags([chat]);
      return null;
    }));
    return rows![0]!;
  };
  const until = async (done: () => boolean) => {
    for (let tries = 0; !done() && tries < 50; tries++) await Bun.sleep(1);
  };
  const agent = { attention: "open", chatId: "agent-1", title: "Marcus's set length", openCount: 1, activityAt: 1 } as const;
  const chat = (overrides: Partial<ChatSummary>): ChatSummary => ({
    guid: "iMessage;-;+16195550206", conversationId: "conv-marcus", displayName: "Marcus Reed", isGroup: false, known: true,
    isSpam: false, participants: [], unreadCount: 0,
    lastMessage: { guid: "m1", text: "Ninety minutes works", dateCreated: 1, isFromMe: true, senderName: null, hasAttachments: false },
    flags: { unresponded: false, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
    agent,
    ...overrides,
  });

  beforeEach(() => {
    writes.length = 0;
    toasts.length = 0;
    held = Promise.resolve();
    resetPendingFlagsForTests();
    resetUndoForTests();
  });

  test("a conversation in Needs you only for its agent chat settles those chats and leaves at once; Undo reopens only them", async () => {
    const marcus = chat({});
    expect(matchesFilters(marcus, "unresponded", "all")).toBe(true);
    let release = () => {};
    held = new Promise((resolve) => { release = resolve; });
    const settling = toggleSettleChat(marcus);
    expect(matchesFilters(shown(marcus), "unresponded", "all"), "out of Needs you before Convex answers").toBe(false);
    release();
    await settling;
    expect(toasts).toEqual(["Settled Marcus Reed"]);
    expect(writes).toEqual([["comma/agent:settleConversationAgents", { conversationId: "conv-marcus" }]]);

    expect(undoLastTriageAction()).toBe(true);
    await until(() => writes.length > 1);
    expect(writes.slice(1), "no bridge un-settle to undismiss the anchors").toEqual([
      ["comma/agent:reopenConversationAgents", { conversationId: "conv-marcus" }],
    ]);
  });

  test("a conversation with an agent chat and no messages settles its chats", async () => {
    await toggleSettleChat(chat({ lastMessage: null }));
    expect(toasts).toEqual(["Settled Marcus Reed"]);
    expect(writes).toEqual([["comma/agent:settleConversationAgents", { conversationId: "conv-marcus" }]]);
  });

  test("a conversation that owes a reply settles through the bridge, agent chat or not, and Undo un-settles it there", async () => {
    const owed = chat({
      lastMessage: { guid: "m2", text: "How long is my set?", dateCreated: 2, isFromMe: false, senderName: null, hasAttachments: false },
      flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
    });
    await toggleSettleChat(owed);
    expect(writes).toEqual([["comma/outbox:enqueue", { kind: "settle", messageGuid: "m2" }]]);
    expect(undoLastTriageAction()).toBe(true);
    await until(() => writes.length > 1);
    expect(writes.slice(1)).toEqual([["comma/outbox:enqueue", { kind: "unsettle" }]]);
  });

  test("Settle all settles every open row as one action: one toast, and one Undo reopens all of them", async () => {
    const owed = (n: number) => chat({
      guid: `iMessage;-;+1619555030${n}`, conversationId: `conv-${n}`, displayName: `Person ${n}`, agent: undefined,
      lastMessage: { guid: `m${n}`, text: "thanks!", dateCreated: 2, isFromMe: false, senderName: null, hasAttachments: false },
      flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
    });
    const quiet = chat({ guid: "iMessage;-;+16195550399", agent: undefined, lastMessage: null });
    await settleAllChats([{ chat: owed(1), anchor: "m1" }, { chat: owed(2), anchor: "m2" }, { chat: quiet, anchor: "q" }]);
    expect(toasts).toEqual(["Settled 2 threads"]);
    expect(writes).toEqual([
      ["comma/outbox:enqueue", { kind: "settle", messageGuid: "m1" }],
      ["comma/outbox:enqueue", { kind: "settle", messageGuid: "m2" }],
    ]);
    expect(matchesFilters(shown(owed(1)), "unresponded", "all")).toBe(false);

    expect(undoLastTriageAction()).toBe(true);
    await until(() => writes.length > 3);
    expect(writes.slice(2)).toEqual([["comma/outbox:enqueue", { kind: "unsettle" }], ["comma/outbox:enqueue", { kind: "unsettle" }]]);
    expect(undoLastTriageAction(), "the batch was one entry").toBe(false);
  });

  test("Settle all conditions each settle on the message the build read, not the live newest one", async () => {
    const moved = chat({
      agent: undefined,
      lastMessage: { guid: "m-urgent", text: "Actually, urgent", dateCreated: 3, isFromMe: false, senderName: null, hasAttachments: false },
      flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
    });
    await settleAllChats([{ chat: moved, anchor: "m-thanks" }]);
    expect(writes).toEqual([["comma/outbox:enqueue", { kind: "settle", messageGuid: "m-thanks" }]]);
  });

  test("Settle all with nothing open says so and leaves no undo entry", async () => {
    await settleAllChats([{ chat: chat({ agent: undefined, lastMessage: null }), anchor: "q" }]);
    expect(toasts).toEqual(["Nothing left to settle here"]);
    expect(undoLastTriageAction()).toBe(false);
  });
}
