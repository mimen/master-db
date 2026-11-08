import type { GenericId } from "convex/values";

import { slack } from "../../../../convex/comma/conversationIdentity";
import { unsupportedReason } from "../../../../convex/comma/routeSupport";
import { slackEmojiName } from "../../../../convex/comma/slackLane";
import type { CommandResult, CommaOutboxPayload, CommaReaction } from "../../../../convex/schema/comma/validators";
import { conversationFlags } from "../../shared/chat-state";
import { fixtureConversationId } from "../../shared/fixture-ids";
import { pendingGuid } from "../../shared/pending-send";
import { keyEmoji } from "../../shared/platform-profile";

import { FIXTURE_NOW } from "./world";

/**
 * One Slack DM in the fixture world, absent until a drive seeds it, and Slack's lane as Convex runs it: a send lands
 * as Slack's message under its clientKey, and a send whose answer is lost ends unknown until the check finds it. The
 * rules copy convex/comma/slackLane.ts; convex/comma/slackLane.test.ts proves the real ones against a fake Slack API.
 */

export const SLACK_DM = "slack:D1";
const CHANNEL = "D1";
const ACCOUNT = "account-slack" as GenericId<"comma_accounts">;
const SAM = { address: "slack:U0SAM", name: "Sam Lee" };

type Receipt = { id: string; status: "pending" | "sent" | "failed" | "unknown"; clientKey: string; updatedAt: number; error?: string; result?: CommandResult; resultGuid?: string };
type Row = { guid: string; text: string; isFromMe: boolean; dateCreated: number; edited: boolean; retracted: boolean; clientKey?: string; sendState?: "sending" | "failed"; reactions: string[] };

export function createSlackFixture(receipts: Map<string, Receipt>) {
  let seeded = false;
  let rows: Row[] = [];
  /** The next send posts, then its answer is lost; the check finds it after this many ms. */
  let loseNextAnswer: number | null = null;
  let clock = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  /** Slack's ts, in the fixture's pinned time, each after the last. */
  const nextTs = () => `${(clock = Math.max(clock + 1, Math.floor(FIXTURE_NOW / 1000)))}.000100`;
  const at = (ts: string) => Math.round(Number(ts) * 1000);
  const find = (guid: string) => {
    const row = rows.find((candidate) => candidate.guid === guid);
    if (!row) throw new Error("Slack chat.update failed: message_not_found");
    return row;
  };
  const receipt = (clientKey: string, fields: Omit<Receipt, "id" | "clientKey" | "updatedAt">) => {
    const next = { id: `outbox-${clientKey}`, clientKey, updatedAt: Date.now(), ...fields };
    receipts.set(clientKey, next);
    return next.id;
  };
  const reaction = (key: string): CommaReaction => ({ key, emoji: keyEmoji(key) ?? key, isFromMe: true, senderName: null, senderAddress: null, type: "emoji" });

  const message = (row: Row) => ({
    _id: row.guid, _creationTime: row.dateCreated, platform: "slack" as const, accountId: ACCOUNT, guid: row.guid,
    conversationId: SLACK_DM, dateCreated: row.dateCreated, isFromMe: row.isFromMe, ...(row.isFromMe ? {} : { sender: SAM }),
    text: row.text, edited: row.edited, retracted: row.retracted, isGroupEvent: false, mentions: [], attachmentGuids: [],
    attachments: [], reactions: row.reactions.map(reaction), sourceVersion: 1,
    ...(row.clientKey ? { clientKey: row.clientKey } : {}), ...(row.sendState ? { sendState: row.sendState } : {}),
  });

  const conversation = () => {
    const last = [...rows].filter((row) => !row.retracted).sort((a, b) => b.dateCreated - a.dateCreated)[0];
    const lastMessage = last ? { guid: last.guid, text: last.text, dateCreated: last.dateCreated, isFromMe: last.isFromMe,
      senderName: last.isFromMe ? null : SAM.name, hasAttachments: false } : undefined;
    const lastMessageAt = last?.dateCreated ?? 0;
    const { flags, unreadCount } = conversationFlags({ platform: "slack", kind: "dm" }, undefined, lastMessage ?? null, lastMessageAt, 0);
    return {
      _id: fixtureConversationId(SLACK_DM), _creationTime: FIXTURE_NOW, platform: "slack" as const, accountId: ACCOUNT,
      conversationKey: slack.conversationKey({ type: "im", channel: CHANNEL }), slack: { channel: CHANNEL }, kind: "dm" as const,
      displayName: SAM.name, isGroup: false, participants: [SAM], ...(lastMessage ? { lastMessage } : {}), lastMessageAt,
      isSpam: false, updatedAt: FIXTURE_NOW, flags, unreadCount, groupPhotoUrl: null, known: true, searchNames: [SAM.name.toLowerCase()],
    };
  };

  /** Slack posted it: the message lands under its clientKey and the bubble goes, as onResult and landFoundSend land it. */
  const land = (clientKey: string, text: string) => {
    const ts = nextTs();
    const guid = slack.messageGuid(CHANNEL, ts);
    rows = [...rows.filter((row) => row.guid !== pendingGuid(clientKey)),
      { guid, text, isFromMe: true, dateCreated: at(ts), edited: false, retracted: false, clientKey, reactions: [] }];
    return { guid, result: { kind: "send" as const, guid, slack: { ts, user: "U066UCP4FS6", text, clientKey } } };
  };

  const enqueue = (clientKey: string, payload: CommaOutboxPayload): string => {
    const unsupported = unsupportedReason({ platform: "slack", accountId: ACCOUNT, channel: CHANNEL }, false, payload);
    if (unsupported) throw new Error(unsupported);
    switch (payload.kind) {
      case "send": {
        rows = [...rows, { guid: pendingGuid(clientKey), text: payload.text, isFromMe: true, dateCreated: Date.now(), edited: false, retracted: false, clientKey, sendState: "sending", reactions: [] }];
        if (loseNextAnswer === null) {
          const { guid, result } = land(clientKey, payload.text);
          return receipt(clientKey, { status: "sent", result, resultGuid: guid });
        }
        const checkAfter = loseNextAnswer;
        loseNextAnswer = null;
        rows = rows.map((row) => (row.guid === pendingGuid(clientKey) ? { ...row, sendState: "failed" } : row));
        const timer = setTimeout(() => {
          timers.delete(timer);
          const { guid, result } = land(clientKey, payload.text);
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

  const reset = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    seeded = false;
    rows = [];
    loseNextAnswer = null;
  };

  return {
    owns: (conversationKey: string) => seeded && conversationKey === SLACK_DM,
    conversation: () => (seeded ? conversation() : null),
    // As listMessages serves a thread: a deleted message is gone.
    messages: () => rows.filter((row) => !row.retracted).sort((a, b) => b.dateCreated - a.dateCreated).map(message),
    enqueue,
    seed: () => {
      reset();
      seeded = true;
      rows = [
        { guid: slack.messageGuid(CHANNEL, "1787250000.000100"), text: "Are we still on for the load-in at 4?", isFromMe: false,
          dateCreated: FIXTURE_NOW - 60_000, edited: false, retracted: false, reactions: [] },
      ];
    },
    loseNextAnswer: (checkAfterMs: number) => {
      loseNextAnswer = checkAfterMs;
    },
    reset,
  };
}
