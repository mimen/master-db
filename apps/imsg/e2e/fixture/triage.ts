import { conversationFlags, type ChatState } from "../../shared/chat-state";
import type { ChatSummary } from "../../shared/types";
import type { DirectoryChat } from "../../server/map";
import { CHAT_GUIDS, FIXTURE_NOW } from "./world";

type LastMessage = ChatSummary["lastMessage"];
interface Clear { chatGuid: string; messageGuid: string; reason: "reply" | "dismiss"; clearedAt: number }

/**
 * The fixture's comma_conversation_state and comma_triage_events, keyed by the conversation's primary chat guid, with
 * the rules of convex/comma/triage.ts: a settle checks its anchor against the conversation's own last message. Its
 * clock is the fixture world's.
 */
export function createTriageFixture(deps: {
  lastMessage: (chatGuid: string) => Promise<LastMessage | undefined>;
  settled: (chatGuid: string) => void;
  unsettled: (chatGuid: string) => void;
}) {
  const states = new Map<string, ChatState>();
  let clears: Clear[] = [];
  const write = (chatGuid: string, fields: Partial<ChatState>) => states.set(chatGuid, {
    mutedUnresponded: false, pinned: false, markedUnread: false, readAt: 0, ...states.get(chatGuid), ...fields,
  });
  const log = (clear: Clear) => {
    if (!clears.some((row) => row.chatGuid === clear.chatGuid && row.messageGuid === clear.messageGuid && row.reason === clear.reason)) clears.push(clear);
  };

  function reset(): void {
    states.clear();
    clears = [];
    write(CHAT_GUIDS.needs, { pinned: true });
    write(CHAT_GUIDS.unreadGroup, { markedUnread: true });
  }
  reset();

  async function lastOf(chatGuid: string): Promise<NonNullable<LastMessage>> {
    const last = await deps.lastMessage(chatGuid);
    if (last === undefined) throw new Error("Conversation not found");
    if (!last) throw new Error("chat has no last message");
    return last;
  }

  async function settle(chatGuid: string, anchor?: string): Promise<void> {
    const last = await lastOf(chatGuid);
    if (anchor !== undefined && anchor !== last.guid) throw new Error("latest message changed");
    write(chatGuid, last.isFromMe ? { dismissedWaitingGuid: last.guid } : { dismissedUnrespondedGuid: last.guid });
    log({ chatGuid, messageGuid: last.guid, reason: "dismiss", clearedAt: FIXTURE_NOW });
    deps.settled(chatGuid);
  }

  async function unsettle(chatGuid: string): Promise<void> {
    await lastOf(chatGuid);
    const state = states.get(chatGuid);
    const anchors = new Set([state?.dismissedUnrespondedGuid, state?.dismissedWaitingGuid]);
    clears = clears.filter((row) => row.chatGuid !== chatGuid || row.reason !== "dismiss" || !anchors.has(row.messageGuid));
    write(chatGuid, { dismissedUnrespondedGuid: undefined, dismissedWaitingGuid: undefined });
    deps.unsettled(chatGuid);
  }

  async function flag(chatGuid: string, fields: Pick<Partial<ChatState>, "pinned" | "mutedUnresponded" | "markedUnread">): Promise<void> {
    if (await deps.lastMessage(chatGuid) === undefined) throw new Error("Conversation not found");
    write(chatGuid, fields);
  }

  function read(chatGuid: string, at: number): void {
    write(chatGuid, { readAt: Math.max(states.get(chatGuid)?.readAt ?? 0, Math.min(at, FIXTURE_NOW)), markedUnread: false });
  }

  /** Message ingest's reply clear: a send that follows an unsettled inbound last message answers it. */
  function replied(chatGuid: string, prior: LastMessage, at: number): void {
    if (!prior || prior.isFromMe || states.get(chatGuid)?.dismissedUnrespondedGuid === prior.guid) return;
    log({ chatGuid, messageGuid: prior.guid, reason: "reply", clearedAt: at });
  }

  /** A directory row as listConversations shows it, with the flags and unread count Convex derives. */
  function flagged(chat: DirectoryChat): ChatSummary {
    const { flags, unreadCount } = conversationFlags(states.get(chat.guid), chat.lastMessage, chat.lastMessage?.dateCreated ?? 0, chat.unreadCount);
    return { ...chat, flags, unreadCount };
  }

  const id = (args: Record<string, unknown>) => String(args.conversationId);
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "comma/triage:settle": async (args) => { await settle(id(args), typeof args.anchor === "string" ? args.anchor : undefined); return null; },
    "comma/triage:unsettle": async (args) => { await unsettle(id(args)); return null; },
    "comma/triage:setPinned": async (args) => { await flag(id(args), { pinned: args.pinned === true }); return null; },
    "comma/triage:setMuted": async (args) => { await flag(id(args), { mutedUnresponded: args.muted === true }); return null; },
    "comma/triage:markUnread": async (args) => { await flag(id(args), { markedUnread: true }); return null; },
  };

  return { handlers, reset, settle, unsettle, flag, read, replied, flagged, clears: () => clears };
}
