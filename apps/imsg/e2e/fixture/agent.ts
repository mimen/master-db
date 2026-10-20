import type { AgentChat, AgentChatId, AgentEntry, AgentItem, AgentItemId, AskArgs } from "../../client/src/lib/agent-api";

/** The composer side of the fixture world the fake agent writes through. */
export interface AgentDraftPort {
  /** Text the user typed into this conversation's composer, or "" for none or an agent draft. */
  userText(conversationId: string): string;
  writeAgentDraft(conversationId: string, text: string, note: string): void;
}

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

const GUEST_QUESTION = {
  question: "Which list?",
  header: "Guest list",
  multiSelect: false,
  options: [{ label: "Freaquency 10/31", description: "Halloween, 2 spots left" }, { label: "Afterparty 11/1" }],
};

/**
 * A scripted stand-in for the comma:agent runner behind the client's agent functions. An ask
 * starts a running turn; one step later it ends with a reply and a folded pair of tool steps. A
 * message mentioning "guest list" asks which list instead, and the answer drafts a reply, into
 * the composer or, when the user has typed there, into the pane.
 */
export function createAgentFixture(drafts: AgentDraftPort, stepMs = 400) {
  const chats = new Map<string, AgentChat>();
  const items = new Map<string, AgentItem[]>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let serial = 0;

  const later = (run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, stepMs);
    timers.add(timer);
  };
  const patchChat = (chatId: string, patch: Partial<AgentChat>) => {
    const chat = chats.get(chatId)!;
    chats.set(chatId, { ...chat, ...patch, updatedAt: Date.now() });
  };
  const upsert = (chatId: string, key: string, entry: AgentEntry) => {
    const list = items.get(chatId) ?? [];
    const now = Date.now();
    const index = list.findIndex((item) => item.key === key);
    if (index >= 0) list[index] = { ...list[index]!, entry, updatedAt: now };
    else list.push({
      _id: `agent-item-${++serial}` as AgentItemId, _creationTime: now, chatId: chatId as AgentChatId, key,
      ordinal: list.length + 1, entry, createdAt: now, updatedAt: now,
    });
    items.set(chatId, list);
  };
  const liveChat = (conversationId: string) => [...chats.values()].find((chat) => chat.conversationId === conversationId && chat.archivedAt === undefined);
  const chatOf = (args: Record<string, unknown>) => {
    const chat = chats.get(String(args.chatId));
    if (!chat) throw new Error("Agent chat not found");
    return chat;
  };

  const ask = (args: AskArgs): AgentChatId => {
    const now = Date.now();
    let chat = liveChat(args.conversationId);
    if (!chat) {
      chat = { _id: `agent-chat-${++serial}` as AgentChatId, _creationTime: now, conversationId: args.conversationId,
        state: "pending", model: args.model, effort: args.effort, createdAt: now, updatedAt: now };
      chats.set(chat._id, chat);
    }
    const chatId = chat._id;
    if (items.get(chatId)?.some((item) => item.key === args.key)) return chatId;
    upsert(chatId, args.key, { kind: "user", text: args.text, steer: args.steer });
    patchChat(chatId, { state: "running" });
    const turn = `${args.key}-turn`;
    upsert(chatId, `${turn}-read`, { kind: "tool", name: "read_thread", summary: "Read the last 40 messages", status: "running" });
    later(() => {
      upsert(chatId, `${turn}-read`, { kind: "tool", name: "read_thread", summary: "Read the last 40 messages", status: "done" });
      upsert(chatId, `${turn}-search`, { kind: "tool", name: "search_thread", summary: "Searched the thread for names and emails", detail: "query: email", status: "done" });
      if (/guest list/i.test(args.text)) {
        upsert(chatId, `${turn}-reply`, { kind: "assistant", streaming: false,
          text: "Jesse wants himself and **Rebecca Berens** (rebeccaberens@gmail.com) on the list." });
        upsert(chatId, `${turn}-question`, { kind: "question", requestId: `${turn}-question`, questions: [GUEST_QUESTION], status: "pending" });
        patchChat(chatId, { state: "waiting_input" });
        return;
      }
      upsert(chatId, `${turn}-reply`, { kind: "assistant", streaming: false,
        text: `Here is what the thread says.\n\n- Two spots asked for\n- Rebecca's email is \`rebeccaberens@gmail.com\`` });
      upsert(chatId, `${turn}-end`, { kind: "turn_end", outcome: "completed", durationMs: stepMs });
      patchChat(chatId, { state: "idle" });
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
      upsert(chat._id, `${requestId}-add`, { kind: "tool", name: "Bash", summary: `Added 2 guests to ${list}`, status: "done" });
      const text = `You're both on the list for ${list} 🎃 see you there`;
      const note = `Added Jesse + Rebecca to ${list}`;
      const placed = drafts.userText(chat.conversationId).trim() ? "pane" : "composer";
      if (placed === "composer") drafts.writeAgentDraft(chat.conversationId, text, note);
      upsert(chat._id, `${requestId}-draft`, { kind: "draft", text, note, placed, used: false });
      upsert(chat._id, `${requestId}-reply`, { kind: "assistant", streaming: false,
        text: placed === "composer" ? `Added Jesse and Rebecca to ${list}. The reply is in the composer.` : `Added Jesse and Rebecca to ${list}. You have text in the composer, so the reply is below.` });
      upsert(chat._id, `${requestId}-end`, { kind: "turn_end", outcome: "completed", durationMs: stepMs });
      patchChat(chat._id, { state: "idle" });
    });
  };

  const handlers: Record<string, Handler> = {
    "comma/agent:liveChat": async (args) => liveChat(String(args.conversationId)) ?? null,
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
      for (const item of items.get(chat._id) ?? []) {
        if (item.entry.kind === "question" && item.entry.status === "pending") upsert(chat._id, item.key, { ...item.entry, status: "cancelled" });
      }
      upsert(chat._id, `stop-${++serial}`, { kind: "turn_end", outcome: "interrupted" });
      patchChat(chat._id, { state: "interrupted" });
      return null;
    },
    "comma/agent:newChat": async (args) => {
      const chat = liveChat(String(args.conversationId));
      if (chat) patchChat(chat._id, { archivedAt: Date.now() });
      return null;
    },
    "comma/agent:useDraft": async (args) => {
      for (const [chatId, list] of items) {
        const item = list.find((row) => row._id === args.itemId);
        if (item?.entry.kind !== "draft" || item.entry.placed !== "pane") continue;
        drafts.writeAgentDraft(chats.get(chatId)!.conversationId, item.entry.text, item.entry.note ?? "");
        upsert(chatId, item.key, { ...item.entry, used: true });
        return null;
      }
      throw new Error("No pane draft with that id");
    },
  };

  const reset = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    chats.clear();
    items.clear();
  };
  return { handlers, reset };
}
