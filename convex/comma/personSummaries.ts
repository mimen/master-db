import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { conversationFlags } from "../../apps/imsg/shared/chat-state";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { personName } from "../identity/names";
import { conversationKind as conversationKindValidator, personSummary, platform } from "../schema/comma/validators";
import { people } from "../schema/identity/people";

import { aiExecutorStatus } from "./bridgeState";
import { conversationKind } from "./conversationIdentity";
import { enqueueCommand } from "./enqueue";
import { personContext, personConversations, personLine } from "./personContext";
import { personForAddress } from "./photos";
import { unreadOf, withConversationState } from "./queries";
import { SUGGESTION_PRECOMPUTE } from "./suggestions";

/**
 * Person summaries: a short written read of one person across iMessage, Slack and email, which the AI process
 * rebuilds about 30 minutes after their last real message, so a burst rebuilds once. The agent pane shows it above
 * that person's open threads on every platform, and the agent and Today read it beside the raw messages.
 */

export const PERSON_SUMMARY = {
  debounceMs: 30 * 60_000,
  /** A message older than this is history a backfill posts, and never queues a rebuild. */
  freshMs: 10 * 60_000,
  /** What the summary model reads. */
  lines: 40,
  maxChars: 8_000,
  /** Open threads the header lists. */
  threads: 6,
} as const;

const dueRef = makeFunctionReference<"mutation", { personId: Id<"people"> }, null>("comma/personSummaries:due");

async function rowOf(ctx: QueryCtx, personId: Id<"people">) {
  return await ctx.db.query("comma_person_summaries").withIndex("by_personId", (q) => q.eq("personId", personId)).unique();
}

/** Channel chatter, a thread Milad doesn't follow, and bulk mail say nothing about a person. */
function speaksForPerson(conversation: Doc<"comma_conversations">): boolean {
  return !conversation.isSpam && conversationKind(conversation) !== "channel" && conversation.slack?.following !== false && !conversation.gmail?.bulk;
}

type Arrived = Pick<Doc<"comma_messages">, "conversationId" | "dateCreated" | "isFromMe" | "sender">;

/**
 * Each sender of a fresh real message gets one rebuild, `debounceMs` after their latest. A rebuild already scheduled
 * finds the later time and waits for it, so only a person with none pending schedules one.
 */
export async function schedulePersonSummaries(ctx: MutationCtx, messages: readonly Arrived[]): Promise<void> {
  const now = Date.now();
  const conversations = new Map<Id<"comma_conversations">, Doc<"comma_conversations"> | null>();
  const people = new Map<Id<"people">, Id<"comma_conversations">>();
  for (const message of messages) {
    if (message.isFromMe || !message.sender || message.dateCreated < now - PERSON_SUMMARY.freshMs) continue;
    if (!conversations.has(message.conversationId)) conversations.set(message.conversationId, await ctx.db.get(message.conversationId));
    const conversation = conversations.get(message.conversationId);
    if (!conversation || !speaksForPerson(conversation)) continue;
    const person = await personForAddress(ctx, message.sender.address);
    if (person) people.set(person._id, message.conversationId);
  }
  const dueAt = now + PERSON_SUMMARY.debounceMs;
  for (const [personId, conversationId] of people) {
    const row = await rowOf(ctx, personId);
    if (row) await ctx.db.patch(row._id, { dueAt, conversationId });
    else await ctx.db.insert("comma_person_summaries", { personId, dueAt, conversationId });
    if (row?.dueAt === undefined) await ctx.scheduler.runAt(dueAt, dueRef, { personId });
  }
}

/** The debounce's end: waits again if a later message moved it, else queues the rebuild on the aiBackground lane. */
export const due = internalMutation({
  args: { personId: v.id("people") },
  returns: v.null(),
  handler: async (ctx, { personId }) => {
    const row = await rowOf(ctx, personId);
    if (row?.dueAt === undefined) return null;
    if (row.dueAt > Date.now()) {
      await ctx.scheduler.runAt(row.dueAt, dueRef, { personId });
      return null;
    }
    await ctx.db.patch(row._id, { dueAt: undefined });
    const ai = await aiExecutorStatus(ctx);
    // A stopped AI process never says so; queued rebuilds would pile up for its return.
    if (!ai?.connected || !ai.capabilities.suggestions || ai.lastSeenAt < Date.now() - SUGGESTION_PRECOMPUTE.aiFreshMs) return null;
    if (!row.conversationId || !await ctx.db.get(row.conversationId)) return null;
    await enqueueCommand(ctx, { clientKey: `personSummary:${personId}:${row.dueAt}`, conversationId: row.conversationId, payload: { kind: "personSummary", personId } });
    return null;
  },
});

const { notes, organization } = people.validator.fields;

/** Ingest route for the AI process: what the summary model reads. Null when the person is gone. */
export const personSummaryContext = internalMutation({
  args: { personId: v.id("people") },
  returns: v.union(v.object({ name: v.string(), notes, organization, lines: v.array(personLine) }), v.null()),
  handler: async (ctx, { personId }) => {
    const person = await ctx.db.get(personId);
    if (!person) return null;
    const { name, lines } = await personContext(ctx, { person, limit: PERSON_SUMMARY.lines * 2, maxChars: PERSON_SUMMARY.maxChars * 2 });
    const kept = new Map<Id<"comma_conversations">, boolean>();
    for (const id of new Set(lines.map((line) => line.conversationId))) {
      const conversation = await ctx.db.get(id);
      kept.set(id, conversation !== null && speaksForPerson(conversation));
    }
    let chars = 0;
    const picked = lines.filter((line) => kept.get(line.conversationId)).slice(0, PERSON_SUMMARY.lines).filter((line) => (chars += line.text.length) <= PERSON_SUMMARY.maxChars);
    return { name, lines: picked, notes: person.notes, organization: person.organization };
  },
});

/** Ingest route for the AI process: stores a summary unless a newer one landed first. */
export const personSummaryPublish = internalMutation({
  args: { personId: v.id("people"), summary: personSummary },
  returns: v.boolean(),
  handler: async (ctx, { personId, summary }) => {
    const row = await rowOf(ctx, personId);
    if (row?.summary && row.summary.basedOnAt > summary.basedOnAt) return false;
    if (row) await ctx.db.patch(row._id, { summary });
    else await ctx.db.insert("comma_person_summaries", { personId, summary });
    return true;
  },
});

/** The written summary, for the agent's and Today's context. */
export async function summaryOf(ctx: QueryCtx, personId: Id<"people">) {
  return (await rowOf(ctx, personId))?.summary ?? null;
}

/** The summary as one block of model text: the paragraph, then its points. */
export async function summaryText(ctx: QueryCtx, personId: Id<"people"> | undefined): Promise<string | undefined> {
  const summary = personId ? await summaryOf(ctx, personId) : null;
  return summary ? [summary.text, ...summary.points.map((point) => `- ${point}`)].join("\n") : undefined;
}

const openThread = v.object({
  conversationId: v.id("comma_conversations"),
  title: v.string(),
  platform,
  kind: conversationKindValidator,
  state: v.union(v.literal("needsYou"), v.literal("waiting")),
  lastMessageAt: v.number(),
});

/**
 * The agent pane's header for a one-to-one conversation: the person, the platforms they reach Milad on, the written
 * summary when one exists, and their threads that want Milad or wait on them, on every platform, newest first.
 */
export const get = query({
  args: { conversationId: v.id("comma_conversations") },
  returns: v.union(v.object({
    personId: v.id("people"),
    name: v.string(),
    platforms: v.array(platform),
    summary: v.union(personSummary, v.null()),
    threads: v.array(openThread),
  }), v.null()),
  handler: async (ctx, { conversationId }) => {
    await assertAllowed(ctx);
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.isGroup || conversation.participants.length !== 1) return null;
    let person = await personForAddress(ctx, conversation.participants[0]!.address);
    for (let hops = 0; person?.merged_into && hops < 5; hops++) person = await ctx.db.get(person.merged_into);
    if (!person) return null;
    const { sentIn, dms } = await personConversations(ctx, person);
    const ids = new Set([conversationId, ...sentIn.flatMap(({ ids: sent }) => sent), ...dms.map((dm) => dm._id)]);
    const rows = (await Promise.all([...ids].map((id) => ctx.db.get(id)))).filter((row): row is Doc<"comma_conversations"> => row !== null);
    const open = [];
    for (const row of rows) {
      const state = await ctx.db.query("comma_conversation_state").withIndex("by_conversationId", (q) => q.eq("conversationId", row._id)).unique();
      const ruled = { platform: row.platform ?? "imessage", kind: conversationKind(row), following: row.slack?.following };
      const { flags } = conversationFlags(ruled, state ?? undefined, row.lastMessage ?? null, row.lastMessageAt, unreadOf(row));
      if (flags.unresponded || flags.waiting) open.push({ row, state: flags.unresponded ? "needsYou" as const : "waiting" as const });
    }
    open.sort((a, b) => b.row.lastMessageAt - a.row.lastMessageAt);
    const threads = await Promise.all(open.slice(0, PERSON_SUMMARY.threads).map(async ({ row, state }) => ({
      conversationId: row._id, title: (await withConversationState(ctx, row)).displayName, platform: row.platform ?? "imessage",
      kind: conversationKind(row), state, lastMessageAt: row.lastMessageAt,
    })));
    return {
      personId: person._id,
      name: personName(person) ?? conversation.displayName,
      platforms: [...new Set(rows.map((row) => row.platform ?? "imessage"))],
      summary: await summaryOf(ctx, person._id),
      threads,
    };
  },
});
