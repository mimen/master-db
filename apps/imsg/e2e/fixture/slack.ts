import type { GenericId } from "convex/values";

import { slack, type SlackConversationRef } from "../../../../convex/comma/conversationIdentity";
import { unsupportedReason } from "../../../../convex/comma/routeSupport";
import { slackEmojiName } from "../../../../convex/comma/slackLane";
import type { CommandResult, CommaOutboxPayload, CommaReaction } from "../../../../convex/schema/comma/validators";
import { conversationFlags } from "../../shared/chat-state";
import { fixtureConversationId } from "../../shared/fixture-ids";
import { pendingGuid } from "../../shared/pending-send";
import { keyEmoji } from "../../shared/platform-profile";

import { FIXTURE_NOW } from "./world";

/**
 * Slack in the fixture world, absent until a drive seeds it: a DM, and an opted-in channel with its threads. Slack's
 * lane runs as Convex runs it: a send lands as Slack's message under its clientKey, a reply lands in its thread, and a
 * send whose answer is lost ends unknown until the check finds it. The rules copy convex/comma/slackLane.ts and the
 * thread rules of slackSync.ts and queries.ts; convex/comma/slackLane.test.ts and slackSync.test.ts prove the real ones.
 */

export const SLACK_DM = "slack:D1";
export const SLACK_CHANNEL = "slack:C1";
const ACCOUNT = "account-slack" as GenericId<"comma_accounts">;
const MILAD = "U066UCP4FS6";
const SAM = { address: "slack:U0SAM", name: "Sam Lee" };
const DANA = { address: "slack:U0DANA", name: "Dana" };

type Receipt = { id: string; status: "pending" | "sent" | "failed" | "unknown"; clientKey: string; updatedAt: number; error?: string; result?: CommandResult; resultGuid?: string };
type Row = {
  guid: string; text: string; isFromMe: boolean; dateCreated: number; edited: boolean; retracted: boolean; sender?: typeof SAM;
  mentionsMe?: boolean; clientKey?: string; sendState?: "sending" | "failed"; reactions: string[]; files?: File[];
};
/** A file on a message as listMessages serves it once convex/comma/slackFiles.ts has run: a URL only where it stored a copy. */
type File = ReturnType<typeof slackFile>;
const slackFile = (messageGuid: string, id: string, filename: string, mimeType: string, totalBytes: number, stored: { width?: number; height?: number; url?: string } = {}) => ({
  _id: `${messageGuid}:${id}`, _creationTime: FIXTURE_NOW, platform: "slack" as const, accountId: ACCOUNT, guid: `${messageGuid}:${id}`, messageGuid,
  conversationId: "", mimeType, filename, totalBytes, hideAttachment: false, sourceVersion: 0,
  ...(stored.width ? { width: stored.width, height: stored.height } : {}), thumbUrl: null, originalUrl: stored.url ?? null,
});
/** One Slack conversation: its ref, and for a thread whether Milad follows it. Rows hold its messages, a thread's root aside. */
type Conversation = { key: string; ref: SlackConversationRef; name: string; following?: boolean; rows: Row[] };

const keyOf = (ref: SlackConversationRef) => `slack:${ref.type === "im" ? "D1" : slack.conversationKey(ref).replace(/^ch:/, "")}`;

export function createSlackFixture(receipts: Map<string, Receipt>) {
  let conversations = new Map<string, Conversation>();
  /** The next send posts, then its answer is lost; the check finds it after this many ms. */
  let loseNextAnswer: number | null = null;
  let clock = 0;
  let following: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();

  /** Slack's ts, in the fixture's pinned time, each after the last. */
  const nextTs = () => `${(clock = Math.max(clock + 1, Math.floor(FIXTURE_NOW / 1000)))}.000100`;
  const at = (ts: string) => Math.round(Number(ts) * 1000);
  const tsOf = (guid: string) => guid.slice(guid.indexOf(":") + 1);
  const all = () => [...conversations.values()].flatMap((conversation) => conversation.rows.map((row) => ({ conversation, row })));
  const find = (guid: string) => {
    const hit = all().find(({ row }) => row.guid === guid);
    if (!hit) throw new Error("Slack chat.update failed: message_not_found");
    return hit.row;
  };
  const threadOf = (row: Row, channel: string) => conversations.get(keyOf({ type: "thread", channel, threadTs: tsOf(row.guid) }));
  const shown = (rows: Row[]) => rows.filter((row) => !row.retracted);
  const receipt = (clientKey: string, fields: Omit<Receipt, "id" | "clientKey" | "updatedAt">) => {
    const next = { id: `outbox-${clientKey}`, clientKey, updatedAt: Date.now(), ...fields };
    receipts.set(clientKey, next);
    return next.id;
  };
  const reaction = (key: string): CommaReaction => ({ key, emoji: keyEmoji(key) ?? key, isFromMe: true, senderName: null, senderAddress: null, type: "emoji" });

  /** `viewing`: the conversation listing it, which a thread's root shows in without a chip to itself. */
  const message = (row: Row, conversation: Conversation, viewing = conversation) => {
    const thread = viewing.ref.type !== "thread" ? threadOf(row, conversation.ref.channel) : undefined;
    const replyCount = thread ? shown(thread.rows).length : 0;
    return {
      _id: row.guid, _creationTime: row.dateCreated, platform: "slack" as const, accountId: ACCOUNT, guid: row.guid,
      conversationId: conversation.key, dateCreated: row.dateCreated, isFromMe: row.isFromMe, ...(row.isFromMe ? {} : { sender: row.sender ?? SAM }),
      text: row.text, edited: row.edited, retracted: row.retracted, isGroupEvent: false, mentions: [], attachmentGuids: (row.files ?? []).map((file) => file.guid),
      attachments: (row.files ?? []).map((file) => ({ ...file, conversationId: conversation.key })), reactions: row.reactions.map(reaction), sourceVersion: 1,
      ...(row.clientKey ? { clientKey: row.clientKey } : {}), ...(row.sendState ? { sendState: row.sendState } : {}),
      ...(thread && replyCount ? { replyCount, thread: { conversationId: thread.key, replyCount } } : {}),
    };
  };

  /** As listMessages serves one: newest first, a deleted message gone, and a thread's root under its replies. */
  const messagesOf = (conversation: Conversation) => {
    const root = conversation.ref.type === "thread" ? all().find(({ row }) => row.guid === slack.messageGuid(conversation.ref.channel, (conversation.ref as { threadTs: string }).threadTs)) : undefined;
    return [...shown(conversation.rows).sort((a, b) => b.dateCreated - a.dateCreated).map((row) => message(row, conversation)),
      ...(root ? [message(root.row, root.conversation, conversation)] : [])];
  };

  const view = (conversation: Conversation) => {
    const last = shown(conversation.rows).sort((a, b) => b.dateCreated - a.dateCreated)[0];
    const lastMessage = last ? { guid: last.guid, text: last.text, dateCreated: last.dateCreated, isFromMe: last.isFromMe,
      senderName: last.isFromMe ? null : (last.sender ?? SAM).name, hasAttachments: false, ...(last.mentionsMe ? { mentionsMe: true } : {}) } : undefined;
    const lastMessageAt = last?.dateCreated ?? 0;
    const { ref } = conversation;
    const kind = slack.kind(ref);
    const { flags, unreadCount } = conversationFlags({ platform: "slack", kind, following: conversation.following }, undefined, lastMessage ?? null, lastMessageAt, 0);
    const people = ref.type === "channel" ? [] : [...new Map(conversation.rows.filter((row) => !row.isFromMe).map((row) => [(row.sender ?? SAM).address, row.sender ?? SAM])).values()];
    const parent = ref.type === "thread" ? conversations.get(keyOf({ type: "channel", channel: ref.channel })) : undefined;
    const root = ref.type === "thread" && parent ? parent.rows.find((row) => tsOf(row.guid) === ref.threadTs) : undefined;
    return {
      _id: fixtureConversationId(conversation.key), _creationTime: FIXTURE_NOW, platform: "slack" as const, accountId: ACCOUNT,
      conversationKey: slack.conversationKey(ref), slack: { channel: ref.channel, ...(ref.type === "thread" ? { threadTs: ref.threadTs, following: conversation.following } : {}) },
      kind, displayName: conversation.name, isGroup: kind !== "dm", participants: ref.type === "im" ? [SAM] : people,
      ...(lastMessage ? { lastMessage } : {}), lastMessageAt, isSpam: false, updatedAt: FIXTURE_NOW, flags, unreadCount, groupPhotoUrl: null,
      known: true, searchNames: [conversation.name.toLowerCase()],
      ...(parent ? { thread: { parentId: fixtureConversationId(parent.key), replyCount: root ? shown(conversation.rows).length : 0 } } : {}),
    };
  };

  /** Slack posted it: the message lands under its clientKey and the bubble goes, as onResult and landFoundSend land it. */
  const land = (conversation: Conversation, clientKey: string, text: string) => {
    const ts = nextTs();
    const guid = slack.messageGuid(conversation.ref.channel, ts);
    conversation.rows = [...conversation.rows.filter((row) => row.guid !== pendingGuid(clientKey)),
      { guid, text, isFromMe: true, dateCreated: at(ts), edited: false, retracted: false, clientKey, reactions: [] }];
    if (conversation.ref.type === "thread") conversation.following = true;
    const threadTs = conversation.ref.type === "thread" ? conversation.ref.threadTs : undefined;
    return { guid, result: { kind: "send" as const, guid, slack: { ts, user: MILAD, text, clientKey, ...(threadTs ? { threadTs } : {}) } } };
  };

  const enqueue = (key: string, clientKey: string, payload: CommaOutboxPayload): string => {
    const conversation = conversations.get(key)!;
    const route = { platform: "slack" as const, accountId: ACCOUNT, channel: conversation.ref.channel,
      ...(conversation.ref.type === "thread" ? { threadTs: conversation.ref.threadTs } : {}) };
    const unsupported = unsupportedReason(route, conversation.ref.type !== "im", payload);
    if (unsupported) throw new Error(unsupported);
    switch (payload.kind) {
      case "send": {
        conversation.rows = [...conversation.rows, { guid: pendingGuid(clientKey), text: payload.text, isFromMe: true, dateCreated: Date.now(), edited: false, retracted: false, clientKey, sendState: "sending", reactions: [] }];
        if (loseNextAnswer === null) {
          const { guid, result } = land(conversation, clientKey, payload.text);
          return receipt(clientKey, { status: "sent", result, resultGuid: guid });
        }
        const checkAfter = loseNextAnswer;
        loseNextAnswer = null;
        conversation.rows = conversation.rows.map((row) => (row.guid === pendingGuid(clientKey) ? { ...row, sendState: "failed" } : row));
        const timer = setTimeout(() => {
          timers.delete(timer);
          const { guid, result } = land(conversation, clientKey, payload.text);
          receipt(clientKey, { status: "sent", result, resultGuid: guid });
        }, checkAfter);
        timers.add(timer);
        return receipt(clientKey, { status: "unknown", error: "The operation timed out." });
      }
      case "react": {
        const emoji = keyEmoji(payload.reaction);
        if (!emoji || !slackEmojiName(emoji)) return receipt(clientKey, { status: "failed", error: "Slack can't send that reaction" });
        const row = find(payload.messageGuid);
        row.reactions = payload.remove ? row.reactions.filter((key) => key !== payload.reaction)
          : row.reactions.includes(payload.reaction) ? row.reactions : [...row.reactions, payload.reaction];
        return receipt(clientKey, { status: "sent", result: { kind: "react", ok: true } });
      }
      case "edit":
        Object.assign(find(payload.messageGuid), { text: payload.text, edited: true });
        return receipt(clientKey, { status: "sent", result: { kind: "edit", ok: true } });
      case "unsend":
        Object.assign(find(payload.messageGuid), { text: "", retracted: true });
        return receipt(clientKey, { status: "sent", result: { kind: "unsend", ok: true } });
      case "markRead":
        return receipt(clientKey, { status: "sent", result: { kind: "markRead", ok: true } });
      default:
        throw new Error(`The fixture's Slack runs no ${payload.kind}`);
    }
  };

  const add = (ref: SlackConversationRef, name: string, rows: Row[], fields: Partial<Conversation> = {}) => {
    const key = keyOf(ref);
    conversations.set(key, { key, ref, name, rows, ...fields });
  };
  const inbound = (guid: string, text: string, minutesAgo: number, sender = SAM, extra: Partial<Row> = {}): Row => ({
    guid, text, isFromMe: false, sender, dateCreated: FIXTURE_NOW - minutesAgo * 60_000, edited: false, retracted: false, reactions: [], ...extra,
  });

  const reset = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    conversations = new Map();
    loseNextAnswer = null;
    following = [];
  };

  /** The channels Milad is in, as listSlackChannels reads them from Slack. */
  const CHANNELS = [{ id: "C1", name: "bookings", isPrivate: false }, { id: "C3", name: "ops", isPrivate: false }, { id: "C4", name: "finance", isPrivate: true }];

  return {
    owns: (key: string) => conversations.has(key),
    conversation: (key: string) => {
      const conversation = conversations.get(key);
      return conversation ? view(conversation) : null;
    },
    /** As listConversations serves them: a thread only while it wants Milad. */
    listed: () => [...conversations.values()].map(view).filter((row) => row.kind !== "thread" || row.flags.unresponded || row.flags.pinned || row.flags.unread)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    messages: (key: string) => messagesOf(conversations.get(key)!),
    attachment: (guid: string) => all().flatMap(({ row }) => row.files ?? []).find((file) => file.guid === guid) ?? null,
    enqueue,
    channels: () => CHANNELS.map((channel) => ({ ...channel, following: following.includes(channel.id) })),
    follow: (channel: string, value: boolean) => {
      following = value ? [...new Set([...following, channel])] : following.filter((id) => id !== channel);
    },
    seed: () => {
      reset();
      add({ type: "im", channel: "D1" }, SAM.name, [inbound(slack.messageGuid("D1", "1787250000.000100"), "Are we still on for the load-in at 4?", 1)]);
    },
    /** The DM, and Sam's message with a flyer, a rider and a file Slack wouldn't hand the token. */
    seedFiles: () => {
      reset();
      const guid = slack.messageGuid("D1", "1787250100.000100");
      add({ type: "im", channel: "D1" }, SAM.name, [
        inbound(slack.messageGuid("D1", "1787250000.000100"), "Are we still on for the load-in at 4?", 2),
        inbound(guid, "Flyer and rider for Saturday", 1, SAM, { files: [
          slackFile(guid, "F1", "flyer.png", "image/png", 4096, { width: 1200, height: 900, url: "/__fixture/slack-file/flyer.png" }),
          slackFile(guid, "F2", "rider.pdf", "application/pdf", 52_000, { url: "/__fixture/slack-file/rider.pdf" }),
          slackFile(guid, "F3", "partner-deck.key", "application/octet-stream", 8_200_000),
        ] }),
      ]);
    },
    /** #bookings, opted in: a thread that mentions Milad, one he isn't in, and one he answered last. */
    seedChannel: () => {
      reset();
      following = ["C1"];
      const channel = { type: "channel" as const, channel: "C1" };
      const thread = (ts: string) => ({ type: "thread" as const, channel: "C1", threadTs: ts });
      add(channel, "#bookings", [
        inbound("C1:1787240000.000100", "Rider for Saturday is in the drive", 50, DANA),
        inbound("C1:1787243000.000100", "Parking is in lot B this week", 40, DANA),
        inbound("C1:1787246000.000100", "Load-in moved to 5. Who can confirm the van?", 30),
        inbound("C1:1787248000.000100", "Doors at 8, set times to follow", 10),
      ]);
      add(thread("1787246000.000100"), "#bookings", [
        inbound("C1:1787246100.000100", "I can drive it", 25, DANA),
        inbound("C1:1787246200.000100", "@Milad can you sign the rider before then?", 20, SAM, { mentionsMe: true }),
      ], { following: true });
      add(thread("1787243000.000100"), "#bookings", [inbound("C1:1787243100.000100", "thanks!", 35)], { following: false });
      add(thread("1787240000.000100"), "#bookings", [
        inbound("C1:1787240100.000100", "@Milad does this match the contract?", 48, DANA, { mentionsMe: true }),
        { guid: "C1:1787240200.000100", text: "Yes, signed", isFromMe: true, dateCreated: FIXTURE_NOW - 45 * 60_000, edited: false, retracted: false, reactions: [] },
        inbound("C1:1787240300.000100", "great, filing it", 44, DANA),
        { guid: "C1:1787240400.000100", text: "Thanks Dana", isFromMe: true, dateCreated: FIXTURE_NOW - 43 * 60_000, edited: false, retracted: false, reactions: [] },
      ], { following: true });
    },
    loseNextAnswer: (checkAfterMs: number) => {
      loseNextAnswer = checkAfterMs;
    },
    reset,
  };
}
