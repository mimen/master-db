import { imessage } from "../../../../convex/comma/conversationIdentity";
import { conversationFlags, laterOf, type ChatState } from "../../shared/chat-state";
import type { ChatSummary } from "../../shared/types";
import type { MappedChat } from "../../server/map";
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
  /** convex/comma/triage.ts sameSend: whether `anchor`, a send's temp guid, landed as the message `lastGuid`. */
  sameSend: (anchor: string, lastGuid: string) => boolean;
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
    if (anchor !== undefined && anchor !== last.guid && !deps.sameSend(anchor, last.guid)) throw new Error("latest message changed");
    const followUp = states.get(chatGuid)?.followUp;
    write(chatGuid, { ...(last.isFromMe ? { dismissedWaitingGuid: last.guid } : { dismissedUnrespondedGuid: last.guid }),
      snooze: undefined, snoozeReturn: undefined, followUp: followUp?.due ? undefined : followUp });
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

  /** convex/comma/later.ts, without the scheduler: the fixture clock never reaches a wake. */
  async function snooze(chatGuid: string, until: number): Promise<void> {
    await lastOf(chatGuid);
    if (!(until > FIXTURE_NOW)) throw new Error("Pick a time in the future");
    write(chatGuid, { snooze: { until, setAt: FIXTURE_NOW }, snoozeReturn: undefined });
  }

  async function followUp(chatGuid: string, at: number): Promise<void> {
    const last = await lastOf(chatGuid);
    if (!(at > FIXTURE_NOW)) throw new Error("Pick a time in the future");
    if (!last.isFromMe) throw new Error("Follow up needs your message to be the last one");
    write(chatGuid, { followUp: { at, since: last.dateCreated, due: false } });
  }

  function read(chatGuid: string, at: number): void {
    write(chatGuid, { readAt: Math.max(states.get(chatGuid)?.readAt ?? 0, Math.min(at, FIXTURE_NOW)), markedUnread: false });
  }

  /** convex/comma/triage.ts carryTempAnchor: a settle taken on a send in flight moves to the message it became. */
  function carry(chatGuid: string, tempGuid: string, realGuid: string): void {
    if (states.get(chatGuid)?.dismissedWaitingGuid === tempGuid) write(chatGuid, { dismissedWaitingGuid: realGuid });
    clears = clears.map((row) => row.chatGuid === chatGuid && row.messageGuid === tempGuid ? { ...row, messageGuid: realGuid } : row);
  }

  /** Message ingest's reply clear: a send that follows an unsettled inbound last message answers it. */
  function replied(chatGuid: string, prior: LastMessage, at: number): void {
    if (!prior || prior.isFromMe || states.get(chatGuid)?.dismissedUnrespondedGuid === prior.guid) return;
    log({ chatGuid, messageGuid: prior.guid, reason: "reply", clearedAt: at });
  }

  /** A directory row as listConversations shows it, with the flags and unread count Convex derives. */
  function flagged(chat: MappedChat): ChatSummary {
    const kind = imessage.kind(chat);
    const { flags, unreadCount } = conversationFlags({ platform: imessage.platform, kind }, states.get(chat.guid), chat.lastMessage,
      chat.lastMessage?.dateCreated ?? 0, chat.unreadCount);
    const later = laterOf(states.get(chat.guid));
    return { ...chat, route: { platform: imessage.platform, accountId: null, imessage: { chatGuid: chat.guid } }, kind, flags, unreadCount, ...(later ? { later } : {}) };
  }

  const id = (args: Record<string, unknown>) => String(args.conversationId);
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "comma/triage:settle": async (args) => { await settle(id(args), typeof args.anchor === "string" ? args.anchor : undefined); return null; },
    "comma/triage:unsettle": async (args) => { await unsettle(id(args)); return null; },
    "comma/triage:setPinned": async (args) => { await flag(id(args), { pinned: args.pinned === true }); return null; },
    "comma/triage:setMuted": async (args) => { await flag(id(args), { mutedUnresponded: args.muted === true }); return null; },
    "comma/triage:markUnread": async (args) => { await flag(id(args), { markedUnread: true }); return null; },
    "comma/later:snooze": async (args) => { await snooze(id(args), Number(args.until)); return null; },
    "comma/later:unsnooze": async (args) => { write(id(args), { snooze: undefined }); return null; },
    "comma/later:setFollowUp": async (args) => { await followUp(id(args), Number(args.at)); return null; },
    "comma/later:clearFollowUp": async (args) => { write(id(args), { followUp: undefined }); return null; },
  };

  return { handlers, reset, settle, unsettle, flag, read, replied, carry, flagged, clears: () => clears };
}
