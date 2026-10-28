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
  const toasts: { message: string; onPress?: () => void }[] = [];
  let held: Promise<void> = Promise.resolve();
  type Payload = { kind: string; messageGuid?: string };
  /** What the bridge answers for a queued command; undefined leaves it pending. */
  let bridge: (payload: Payload) => "sent" | "failed" | undefined = () => undefined;
  const commands = new Map<string, Payload>();
  mock.module("@/lib/toast", () => ({
    showToast: (message: string, action?: { onPress: () => void }) => toasts.push({ message, ...(action ? { onPress: action.onPress } : {}) }),
  }));
  mock.module("@/lib/identity", () => ({
    convexClient: {
      query: async () => ({ _id: "conv-resolved" }),
      mutation: async (ref: Parameters<typeof getFunctionName>[0], args: { payload?: Payload }) => {
        const name = getFunctionName(ref);
        writes.push([name, name === "comma/outbox:enqueue" ? args.payload : args]);
        const commandId = `outbox-${writes.length}`;
        if (args.payload) commands.set(commandId, args.payload);
        await held;
        return commandId;
      },
      watchQuery: (_ref: unknown, { commandId }: { commandId: string }) => ({
        onUpdate: () => () => undefined,
        localQueryResult: () => {
          const payload = commands.get(commandId);
          const status = payload && bridge(payload);
          if (!status) return undefined;
          return { commandId, clientKey: "k", status, updatedAt: 1, ...(status === "sent" ? { result: { kind: payload.kind, ok: true } } : { error: "latest message changed" }) };
        },
      }),
    },
  }));
  const { settleAllChats, toggleSettleChat, undoLastTriageAction } = await import("./use-triage-actions");
  const { beginUndoAction, commitUndoAction } = await import("@/lib/action-undo");
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
    commands.clear();
    bridge = () => undefined;
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
    expect(toasts.map((t) => t.message)).toEqual(["Settled Marcus Reed"]);
    expect(writes).toEqual([["comma/agent:settleConversationAgents", { conversationId: "conv-marcus" }]]);

    expect(undoLastTriageAction()).toBe(true);
    await until(() => writes.length > 1);
    expect(writes.slice(1), "no bridge un-settle to undismiss the anchors").toEqual([
      ["comma/agent:reopenConversationAgents", { conversationId: "conv-marcus" }],
    ]);
  });

  test("a conversation with an agent chat and no messages settles its chats", async () => {
    await toggleSettleChat(chat({ lastMessage: null }));
    expect(toasts.map((t) => t.message)).toEqual(["Settled Marcus Reed"]);
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

  const owed = (n: number) => chat({
    guid: `iMessage;-;+1619555030${n}`, conversationId: `conv-${n}`, displayName: `Person ${n}`, agent: undefined,
    lastMessage: { guid: `m${n}`, text: "thanks!", dateCreated: 2, isFromMe: false, senderName: null, hasAttachments: false },
    flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
  });
  const target = (n: number) => ({ chat: owed(n), anchor: `m${n}` });

  test("Settle all settles every open row as one action: one toast, and one Undo reopens all of them", async () => {
    bridge = () => "sent";
    const quiet = chat({ guid: "iMessage;-;+16195550399", agent: undefined, lastMessage: null });
    await settleAllChats([target(1), target(2), { chat: quiet, anchor: "q" }]);
    expect(toasts.map((t) => t.message)).toEqual(["Settled 2 threads"]);
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
    bridge = () => "sent";
    const moved = chat({
      agent: undefined,
      lastMessage: { guid: "m-urgent", text: "Actually, urgent", dateCreated: 3, isFromMe: false, senderName: null, hasAttachments: false },
      flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
    });
    await settleAllChats([{ chat: moved, anchor: "m-thanks" }]);
    expect(writes).toEqual([["comma/outbox:enqueue", { kind: "settle", messageGuid: "m-thanks" }]]);
  });

  test("Settle all counts only settles the bridge confirmed, reports the rest, and Undo leaves a rejected row alone", async () => {
    bridge = (payload) => (payload.messageGuid === "m2" ? "failed" : "sent");
    await settleAllChats([target(1), target(2), target(3)]);
    expect(toasts.map((t) => t.message)).toEqual(["Settled 2 threads · 1 couldn't be settled"]);
    expect(matchesFilters(shown(owed(2)), "unresponded", "all"), "the rejected row's pending settle rolled back").toBe(true);

    toasts[0]!.onPress!();
    await until(() => writes.length > 4);
    expect(writes.slice(3), "two un-settles, none for the rejected row").toEqual([
      ["comma/outbox:enqueue", { kind: "unsettle" }], ["comma/outbox:enqueue", { kind: "unsettle" }],
    ]);
  });

  test("the batch toast's Undo reverses that batch even after a newer action committed", async () => {
    bridge = () => "sent";
    await settleAllChats([target(1)]);
    const later: string[] = [];
    commitUndoAction(beginUndoAction(), () => later.push("newer settle undone"));
    toasts[0]!.onPress!();
    await until(() => writes.length > 1);
    expect(writes.slice(1)).toEqual([["comma/outbox:enqueue", { kind: "unsettle" }]]);
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
