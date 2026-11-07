import { TAPBACK_GLYPHS } from "../../apps/imsg/shared/platform-profile";
import type { CommaLegacyReaction, CommaPlatform, CommaReaction, CommaReactionState, CommaTapback } from "../schema/comma/validators";

/**
 * Reactions as platform-neutral data. A comma_reactions row is one sender's newest state for one key on
 * one message. iMessage tapbacks become reactions at ingest. Messages ingested before that carry their
 * tapbacks folded on the row (`reactions`), and readers show that fold under the new rows until
 * migrations:deleteLegacyTapbacks has run. Pure, so the bridge's fixture serves reads by the same rules;
 * the Convex reads and writes live in reactionStore.ts.
 */

/** A message's id across platforms, so two platforms' message ids cannot collide. */
export function messageKey(platform: CommaPlatform, guid: string): string {
  return `${platform}:${guid}`;
}

const TAPBACK_EMOJI: Readonly<Record<string, string>> = TAPBACK_GLYPHS;

/** A classic tapback is keyed by its name; an emoji tapback by its emoji, or "emoji" when the bridge could not read it. */
function tapbackKey(type: string, emoji?: string): string {
  return type === "emoji" ? emoji ?? "emoji" : type;
}

function tapbackEmoji(type: string, emoji?: string): string | undefined {
  return type === "emoji" ? emoji : TAPBACK_EMOJI[type];
}

type Sender = { isFromMe: boolean; senderAddress?: string | null };

/** The one state an event replaces: same key, and my own reactions share one sender. */
export function sameReaction(a: Sender & { key: string }, b: Sender & { key: string }): boolean {
  if (a.key !== b.key || a.isFromMe !== b.isFromMe) return false;
  return a.isFromMe || (a.senderAddress ?? null) === (b.senderAddress ?? null);
}

/** The reaction an iMessage tapback row records, or null for any other row. */
export function fromTapback(message: {
  conversationId: CommaReactionState["conversationId"];
  isFromMe: boolean;
  sender?: { address: string };
  dateCreated: number;
  tapback?: CommaTapback;
}): CommaReactionState | null {
  const { tapback } = message;
  if (!tapback) return null;
  const emoji = tapbackEmoji(tapback.reaction, tapback.emoji);
  return {
    platform: "imessage",
    conversationId: message.conversationId,
    targetKey: messageKey("imessage", tapback.targetGuid),
    key: tapbackKey(tapback.reaction, tapback.emoji),
    ...(emoji ? { emoji } : {}),
    isFromMe: message.isFromMe,
    ...(!message.isFromMe && message.sender ? { senderAddress: message.sender.address } : {}),
    at: message.dateCreated,
    removed: tapback.remove,
  };
}

/** Whether `event` changes `current`: it is not older, and it differs. */
export function supersedes(event: CommaReactionState, current: CommaReactionState | undefined): boolean {
  if (!current) return true;
  if (event.at < current.at) return false;
  return event.at !== current.at || event.removed !== current.removed || event.emoji !== current.emoji;
}

/** The name clients built before `key` read. */
function legacyType(key: string): string {
  return key in TAPBACK_EMOJI ? key : "emoji";
}

function view(reaction: { key: string; emoji?: string; isFromMe: boolean; senderAddress?: string | null }): CommaReaction {
  return {
    key: reaction.key,
    ...(reaction.emoji ? { emoji: reaction.emoji } : {}),
    isFromMe: reaction.isFromMe,
    senderName: null,
    senderAddress: reaction.isFromMe ? null : reaction.senderAddress ?? null,
    type: legacyType(reaction.key),
  };
}

/** What a message shows: its legacy fold minus anything a newer row has decided, then live rows oldest first. Names are the reader's to fill. */
export function mergeReactions(legacy: readonly CommaLegacyReaction[], rows: readonly CommaReactionState[]): CommaReaction[] {
  const old = legacy
    .map((r) => ({ key: tapbackKey(r.type, r.emoji), emoji: tapbackEmoji(r.type, r.emoji), isFromMe: r.isFromMe, senderAddress: r.senderAddress }))
    .filter((r) => !rows.some((row) => sameReaction(row, r)));
  const live = rows.filter((row) => !row.removed).sort((a, b) => a.at - b.at);
  return [...old, ...live].map(view);
}
