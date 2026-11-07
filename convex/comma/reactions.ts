import { TAPBACK_GLYPHS, tapbackKey } from "../../apps/imsg/shared/platform-profile";
import type { CommaPlatform, CommaReaction, CommaReactionState, CommaTapback } from "../schema/comma/validators";

/**
 * Reactions as platform-neutral data. A comma_reactions row is one sender's newest state for one key on
 * one message. iMessage tapbacks become reactions at ingest. Pure, so the bridge's fixture serves reads by the same rules;
 * the Convex reads and writes live in reactionStore.ts.
 */

/** A message's id across platforms, so two platforms' message ids cannot collide. */
export function messageKey(platform: CommaPlatform, guid: string): string {
  return `${platform}:${guid}`;
}

const TAPBACK_EMOJI: Readonly<Record<string, string>> = TAPBACK_GLYPHS;

function tapbackEmoji(type: string, emoji?: string): string | undefined {
  return type === "emoji" ? emoji : TAPBACK_EMOJI[type];
}

type Sender = { isFromMe: boolean; senderAddress?: string | null };

/** My own reactions share one sender whatever address sent them. */
function sameSender(a: Sender, b: Sender): boolean {
  if (a.isFromMe !== b.isFromMe) return false;
  return a.isFromMe || (a.senderAddress ?? null) === (b.senderAddress ?? null);
}

/** The one state an event replaces: same sender and key. */
export function sameReaction(a: Sender & { key: string }, b: Sender & { key: string }): boolean {
  return a.key === b.key && sameSender(a, b);
}

/** The reaction an iMessage tapback row records, or null for any other row. */
export function fromTapback(message: {
  platform?: CommaPlatform;
  conversationId: CommaReactionState["conversationId"];
  isFromMe: boolean;
  sender?: { address: string };
  dateCreated: number;
  tapback?: CommaTapback;
}): CommaReactionState | null {
  const { tapback } = message;
  if (!tapback) return null;
  const emoji = tapbackEmoji(tapback.reaction, tapback.emoji);
  const platform = message.platform ?? "imessage";
  return {
    platform,
    conversationId: message.conversationId,
    targetKey: messageKey(platform, tapback.targetGuid),
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

/**
 * The rows one event writes, given the target's rows. A sender keeps one live reaction per message, so an add
 * leaves the sender's other live reactions as tombstones, and an add older than one of them lands as a tombstone.
 * `row` is the existing row each state replaces.
 */
export function reactionWrites<R extends CommaReactionState>(rows: readonly R[], event: CommaReactionState): { row?: R; state: CommaReactionState }[] {
  const others = rows.filter((row) => sameSender(row, event) && row.key !== event.key && !row.removed);
  const stale = !event.removed && others.some((row) => row.at > event.at);
  const next = stale ? { ...event, removed: true } : event;
  const own = rows.find((row) => sameReaction(row, event));
  const writes: { row?: R; state: CommaReactionState }[] = supersedes(next, own) ? [{ row: own, state: next }] : [];
  if (next.removed) return writes;
  return [...writes, ...others.map((row) => ({ row, state: { ...stateOf(row), at: event.at, removed: true } }))];
}

function stateOf(row: CommaReactionState): CommaReactionState {
  const { platform, conversationId, targetKey, key, emoji, isFromMe, senderAddress, at, removed } = row;
  return { platform, conversationId, targetKey, key, ...(emoji ? { emoji } : {}), isFromMe, ...(senderAddress ? { senderAddress } : {}), at, removed };
}

/** The key an emoji reaction carried before keys were namespaced, rewritten; any other key as it is. */
export function currentKey(key: string): string {
  return key in TAPBACK_EMOJI || key === "emoji" || key.startsWith("emoji:") ? key : tapbackKey("emoji", key);
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

/**
 * What a message shows: each sender's newest live row, oldest first. Rows written before one reaction per sender
 * can hold two for a sender. Names are the reader's to fill.
 */
export function shownReactions(rows: readonly CommaReactionState[]): CommaReaction[] {
  const live = rows.filter((row) => !row.removed).sort((a, b) => a.at - b.at);
  return live.filter((row, i) => !live.slice(i + 1).some((later) => sameSender(later, row))).map(view);
}
