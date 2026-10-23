import { askTitle, chatPreview } from "../../../../convex/comma/agentSummary";
import type {
  AgentAttachmentMeta, AgentChat, AgentChatId, AgentChatSummary, AgentEntry, AgentItem, AgentItemId, AgentTodo, AskArgs,
} from "../../client/src/lib/agent-api";

/** The composer side of the fixture world the fake agent writes through. */
export interface AgentDraftPort {
  /** Text the user typed into this conversation's composer, or "" for none or an agent draft. */
  userText(conversationId: string): string;
  writeAgentDraft(conversationId: string, text: string, note: string, chatId: string): void;
  /** A finalized upload, or null; an ask may carry only finalized files. */
  upload?(storageId: string): AgentAttachmentMeta | null;
}

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
type ToolEntry = Extract<AgentEntry, { kind: "tool" }>;

const GUEST_QUESTION = {
  question: "Which list?",
  header: "Guest list",
  multiSelect: false,
  options: [{ label: "Freaquency 10/31", description: "Halloween, 2 spots left" }, { label: "Afterparty 11/1" }],
};

const ESC = "\u001b";
/** What the guest-list script prints: green ticks, a bold count, a yellow warning. */
export const GUEST_LIST_OUTPUT = `${ESC}[32m✓${ESC}[0m Freaquency 10/31  ${ESC}[1m2 spots left${ESC}[0m\n${ESC}[33m!${ESC}[0m Afterparty 11/1  sold out`;
/** The runner's measured time for a scripted turn, so the fold reads like a real one. */
export const TURN_MS = 125_000;

const todos = (current: number): AgentTodo[] => [
  { content: "Read the thread", activeForm: "Reading the thread", status: "pending" },
  { content: "Check the guest lists", activeForm: "Checking the guest lists", status: "pending" },
  { content: "Answer the question", activeForm: "Answering the question", status: "pending" },
].map((todo, index) => ({ ...todo, status: index < current ? "completed" : index === current ? "in_progress" : "pending" }));

const bash = (command: string, description: string, status: ToolEntry["status"], detail?: string): ToolEntry =>
  ({ kind: "tool", name: "Bash", summary: description, input: JSON.stringify({ command, description }), status, ...(detail ? { detail } : {}) });
const comma = (name: string, summary: string, input: Record<string, unknown> = {}): ToolEntry =>
  ({ kind: "tool", name: `mcp__comma__${name}`, summary, input: JSON.stringify(input), status: "done" });
const read = (skill: string): ToolEntry =>
  ({ kind: "tool", name: "Read", summary: `Loaded ${skill} skill`, input: JSON.stringify({ file_path: `~/.claude/skills/${skill}/SKILL.md` }), status: "done" });

/**
 * A scripted stand-in for the comma:agent runner behind the client's agent functions. An ask
 * starts a running turn with a checklist, a thinking summary and a command; one step later it ends
 * with a reply, nine steps and a measured duration. A message mentioning "guest list" asks which
 * list instead, and the answer drafts a reply, into the composer or, when the user has typed
 * there, into the pane. A message saying "take your time" keeps working until Stop.
 */
export function createAgentFixture(drafts: AgentDraftPort, stepMs = 400) {
  const chats = new Map<string, AgentChat>();
  const items = new Map<string, AgentItem[]>();
  const turnStarts = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let serial = 0;
  // The fixture server pins Date.now; the pane's timer counts on the browser's wall clock.
  const now = () => new Date().getTime();

  const later = (run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, stepMs);
    timers.add(timer);
  };
  const reopened = { settledAt: undefined, settledWithConversation: undefined };
  /** The runner's agentChat: a settled chat that asks a question reopens. */
  const patchChat = (chatId: string, patch: Partial<AgentChat>) => {
    const chat = chats.get(chatId)!;
    const reopen = patch.state === "waiting_input" && chat.settledAt !== undefined ? reopened : {};
    chats.set(chatId, { ...chat, ...patch, ...reopen, updatedAt: now() });
  };
  const markChat = (chatId: string, patch: Partial<AgentChat>) => {
    chats.set(chatId, { ...chats.get(chatId)!, ...patch });
  };
  const upsert = (chatId: string, key: string, entry: AgentEntry) => {
    const list = items.get(chatId) ?? [];
    const at = now();
    const index = list.findIndex((item) => item.key === key);
    if (index >= 0) list[index] = { ...list[index]!, entry, updatedAt: at };
    else list.push({
      _id: `agent-item-${++serial}` as AgentItemId, _creationTime: at, chatId: chatId as AgentChatId, key,
      ordinal: list.length + 1, entry, createdAt: at, updatedAt: at,
    });
    items.set(chatId, list);
    if (entry.kind === "turn_end") markChat(chatId, { lastTurnEndedAt: at });
  };
  const chatOf = (args: Record<string, unknown>) => {
    const chat = chats.get(String(args.chatId));
    if (!chat) throw new Error("Agent chat not found");
    return chat;
  };
  const summary = (chat: AgentChat): AgentChatSummary => {
    const list = items.get(chat._id) ?? [];
    const first = list[0]?.entry;
    const { _id, conversationId, state, settledAt, seenAt, lastTurnEndedAt, createdAt, updatedAt } = chat;
    return {
      _id, conversationId, state, settledAt, seenAt, lastTurnEndedAt, createdAt, updatedAt,
      title: chat.title ?? askTitle(first?.kind === "user" ? first.text : ""),
      preview: chatPreview(list.slice(-40).reverse().map((item) => item.entry), state),
    };
  };
  const summaries = (rows: AgentChat[]) => rows.sort((a, b) => b.updatedAt - a.updatedAt).map(summary);
  /** The runner's side of a stop: open questions cancel, running steps end, and the turn ends interrupted. */
  const interrupt = (chat: AgentChat) => {
    for (const item of items.get(chat._id) ?? []) {
      if (item.entry.kind === "question" && item.entry.status === "pending") upsert(chat._id, item.key, { ...item.entry, status: "cancelled" });
      if (item.entry.kind === "tool" && item.entry.status === "running") upsert(chat._id, item.key, { ...item.entry, status: "done" });
      if (item.entry.kind === "thinking" && item.entry.streaming) upsert(chat._id, item.key, { ...item.entry, streaming: false });
    }
    upsert(chat._id, `stop-${++serial}`, { kind: "turn_end", outcome: "interrupted", durationMs: now() - (turnStarts.get(chat._id) ?? now()), model: chat.model, effort: chat.effort });
    patchChat(chat._id, { state: "interrupted" });
  };
  /** Convex's settleChat with the fake runner's answer folded in: a waiting chat's turn stops at once. */
  const settleChat = (chat: AgentChat, withConversation: boolean, at = now()) => {
    markChat(chat._id, { settledAt: at, settledWithConversation: withConversation });
    if (chat.state === "waiting_input") interrupt(chats.get(chat._id)!);
  };
  const endTurn = (chat: AgentChat, key: string) => {
    upsert(chat._id, key, { kind: "turn_end", outcome: "completed", durationMs: TURN_MS, model: chat.model, effort: chat.effort });
    patchChat(chat._id, { state: "idle" });
  };

  const ask = (args: AskArgs): AgentChatId => {
    for (const [chatId, list] of items) if (list.some((item) => item.key === args.key)) return chatId as AgentChatId;
    // Convex records what finalizeUpload stored, not what the client says about the file.
    const attachments = (args.attachments ?? []).map((attachment) => {
      const stored = drafts.upload?.(attachment.storageId);
      if (drafts.upload && !stored) throw new Error("Finalized upload not found");
      return stored ?? { filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size };
    });
    let chat = args.chatId ? chatOf(args) : undefined;
    if (chat && chat.conversationId !== args.conversationId) throw new Error("The agent chat belongs to another conversation");
    if (!chat) {
      const at = now();
      chat = { _id: `agent-chat-${++serial}` as AgentChatId, _creationTime: at, conversationId: args.conversationId,
        state: "pending", model: args.model, effort: args.effort, createdAt: at, updatedAt: at };
      chats.set(chat._id, chat);
    }
    const chatId = chat._id;
    upsert(chatId, args.key, { kind: "user", text: args.text, steer: args.steer, ...(attachments.length ? { attachments } : {}) });
    patchChat(chatId, { state: "running", model: args.model, effort: args.effort, ...reopened });
    turnStarts.set(chatId, now());
    const turn = `${args.key}-turn`;
    upsert(chatId, `${turn}:todos`, { kind: "todos", todos: todos(0) });
    upsert(chatId, `${turn}-think`, { kind: "thinking", streaming: true, text: "**Reading the thread**\n\nLooking for when he first asked, and who he wants on the list." });
    upsert(chatId, `${turn}-read`, comma("read_thread", "Read the thread"));
    upsert(chatId, `${turn}-lists`, bash("bun scripts/guest-list.ts --upcoming", "Check the guest lists", "running"));
    if (/take your time/i.test(args.text)) return chatId;
    later(() => {
      const live = chats.get(chatId)!;
      upsert(chatId, `${turn}-think`, { kind: "thinking", streaming: false, text: "**Reading the thread**\n\nLooking for when he first asked, and who he wants on the list." });
      upsert(chatId, `${turn}-lists`, bash("bun scripts/guest-list.ts --upcoming", "Check the guest lists", "done", GUEST_LIST_OUTPUT));
      upsert(chatId, `${turn}-skill`, read("auf"));
      upsert(chatId, `${turn}-search`, comma("search_thread", "Searched the thread for names and emails", { query: "email", limit: 20 }));
      upsert(chatId, `${turn}-people`, comma("get_people", "Looked up people"));
      upsert(chatId, `${turn}-events`, bash("bunx convex run auf:events.upcoming", "auf:events.upcoming", "done", "2 events"));
      upsert(chatId, `${turn}-ref`, read("messaging"));
      upsert(chatId, `${turn}-photo`, comma("get_attachment", "Opened an attachment"));
      upsert(chatId, `${turn}-count`, bash("bun scripts/guest-list.ts --count", "Count the spots left", "done", "2"));
      upsert(chatId, `${turn}:todos`, { kind: "todos", todos: todos(3) });
      if (/guest list/i.test(args.text)) {
        upsert(chatId, `${turn}-reply`, { kind: "assistant", streaming: false,
          text: "Jesse wants himself and **Rebecca Berens** (rebeccaberens@gmail.com) on the list." });
        upsert(chatId, `${turn}-question`, { kind: "question", requestId: `${turn}-question`, questions: [GUEST_QUESTION], status: "pending" });
        patchChat(chatId, { state: "waiting_input" });
        return;
      }
      upsert(chatId, `${turn}-reply`, { kind: "assistant", streaming: false,
        text: "Here is what the thread says.\n\n- Two spots asked for\n- Rebecca's email is `rebeccaberens@gmail.com`\n\n```\nFreaquency 10/31: Jesse, Rebecca Berens\n```" });
      endTurn(live, `${turn}-end`);
    });
    return chatId;
  };

  const answer = (chat: AgentChat, requestId: string, answers: Record<string, string>) => {
    const question = items.get(chat._id)?.find((item) => item.key === requestId);
    if (question?.entry.kind !== "question" || question.entry.status !== "pending") throw new Error("No pending question");
    upsert(chat._id, requestId, { ...question.entry, status: "resolved", answers });
    patchChat(chat._id, { state: "running" });
    const list = Object.values(answers)[0] ?? "the list";
    later(() => {
      upsert(chat._id, `${requestId}-add`, bash(`bun scripts/guest-list.ts --add 2 "${list}"`, `Added 2 guests to ${list}`, "done", `${ESC}[32m✓${ESC}[0m added 2`));
      const text = `You're both on the list for ${list} 🎃 see you there`;
      const note = `Added Jesse + Rebecca to ${list}`;
      const placed = drafts.userText(chat.conversationId).trim() ? "pane" : "composer";
      if (placed === "composer") drafts.writeAgentDraft(chat.conversationId, text, note, chat._id);
      upsert(chat._id, `${requestId}-draft`, { kind: "draft", text, note, placed, used: false });
      upsert(chat._id, `${requestId}-reply`, { kind: "assistant", streaming: false,
        text: placed === "composer" ? `Added Jesse and Rebecca to ${list}. The reply is in the composer.` : `Added Jesse and Rebecca to ${list}. You have text in the composer, so the reply is below.` });
      endTurn(chats.get(chat._id)!, `${requestId}-end`);
    });
  };

  const handlers: Record<string, Handler> = {
    "comma/agent:listAgentChats": async () => summaries([...chats.values()].filter((chat) => chat.settledAt === undefined)),
    "comma/agent:chatsFor": async (args) => summaries([...chats.values()].filter((chat) => chat.conversationId === args.conversationId)),
    "comma/agent:listItems": async (args) => items.get(String(args.chatId)) ?? [],
    "comma/agent:ask": async (args) => ask(args as unknown as AskArgs),
    "comma/agent:answer": async (args) => {
      answer(chatOf(args), String(args.requestId), args.answers as Record<string, string>);
      return null;
    },
    "comma/agent:stop": async (args) => {
      const chat = chatOf(args);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      interrupt(chat);
      return null;
    },
    "comma/agent:settle": async (args) => {
      const chat = chatOf(args);
      if (chat.settledAt === undefined) settleChat(chat, false);
      return null;
    },
    "comma/agent:reopen": async (args) => {
      markChat(chatOf(args)._id, reopened);
      return null;
    },
    "comma/agent:markSeen": async (args) => {
      const chat = chatOf(args);
      if ((chat.lastTurnEndedAt ?? 0) > (chat.seenAt ?? 0)) markChat(chat._id, { seenAt: now() });
      return null;
    },
    "comma/agent:useDraft": async (args) => {
      for (const [chatId, list] of items) {
        const item = list.find((row) => row._id === args.itemId);
        if (item?.entry.kind !== "draft" || item.entry.placed !== "pane") continue;
        drafts.writeAgentDraft(chats.get(chatId)!.conversationId, item.entry.text, item.entry.note ?? "", chatId);
        upsert(chatId, item.key, { ...item.entry, used: true });
        return null;
      }
      throw new Error("No pane draft with that id");
    },
  };

  /** The outbox's side of Convex's enqueue: a conversation settle carries its chats, and sending a chat's draft settles it. */
  const outbox = {
    settle: (conversationId: string) => {
      const at = now();
      for (const chat of [...chats.values()]) if (chat.conversationId === conversationId && chat.settledAt === undefined) settleChat(chat, true, at);
    },
    unsettle: (conversationId: string) => {
      const closed = [...chats.values()].filter((chat) => chat.conversationId === conversationId && chat.settledWithConversation === true && chat.settledAt !== undefined);
      const latest = Math.max(...closed.map((chat) => chat.settledAt!));
      for (const chat of closed) if (chat.settledAt === latest) markChat(chat._id, reopened);
    },
    sentDraft: (chatId: string | undefined) => {
      const chat = chatId ? chats.get(chatId) : undefined;
      if (chat && chat.settledAt === undefined) settleChat(chat, false);
    },
  };

  const reset = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    chats.clear();
    items.clear();
    turnStarts.clear();
  };
  return { handlers, outbox, reset };
}
