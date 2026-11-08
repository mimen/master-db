import { v, type Infer } from "convex/values";

import { formatAddress, normalizeHandle } from "../../apps/imsg/shared/address";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { personName } from "../identity/names";
import { platform } from "../schema/comma/validators";

import { soleAccountScope } from "./accounts";
import { handleKey } from "./conversationIdentity";
import { conversationPeople } from "./conversationInfo";
import { findByKey } from "./conversationLookup";
import { isAssociated } from "./messageShape";
import { resolveConversationNames } from "./names";
import { normalizedAddress } from "./photos";

/**
 * A person's recent messages across every conversation they are in: what they sent anywhere, through each handle
 * that resolves to them (`comma_messages.by_sender_conversation_date`), and both sides of every one-to-one
 * conversation with those handles. Newest first, each line carrying its conversation, bounded by count and characters.
 */

export const personLine = v.object({
  at: v.number(),
  conversationId: v.id("comma_conversations"),
  conversation: v.string(),
  kind: v.union(v.literal("dm"), v.literal("group")),
  platform,
  fromMe: v.boolean(),
  sender: v.string(),
  text: v.string(),
});
export type PersonLine = Infer<typeof personLine>;

export const personContextResult = v.object({
  name: v.string(),
  lines: v.array(personLine),
  /** Older lines exist past `limit` or `maxChars`; page with the oldest `at` as `beforeAt`. */
  more: v.boolean(),
  /** Their written summary across platforms (convex/comma/personSummaries.ts), when one has been built. */
  summary: v.optional(v.string()),
});

export type PersonContextInput = {
  person: Doc<"people"> | null;
  /** The address the caller knows them by; the only handle when no person resolves. */
  address?: string;
  excludeConversationId?: Id<"comma_conversations">;
  sinceAt?: number;
  beforeAt?: number;
  limit: number;
  maxChars: number;
};

const LINE_CHARS = 500;
const MAX_HANDLES = 24;
/**
 * Conversations read per handle, one sequential seek each: about 17 ms apiece on a local backend, so 31 conversations
 * took 530 ms. A handle in more stops at the first this many by id.
 */
// ponytail: discovery is O(conversations the handle ever sent in); a per-person conversation table makes it one read.
const MAX_CONVERSATIONS = 60;
/** Rows read per conversation and handle, matching or not, so legacy tapback rows cannot run a read long. */
const SCAN = 400;

type Row = Doc<"comma_messages">;

const shown = (row: Row) =>
  !isAssociated(row) && !row.retracted && !row.isGroupEvent && ((row.modelText ?? row.text).trim() !== "" || row.attachmentGuids.length > 0);

/** One index range read newest first, a row at a time, holding its newest unread line. */
type Source = { rows: AsyncIterator<Row>; keep: (row: Row) => boolean; read: number; head: Row | null };

async function advance(source: Source): Promise<void> {
  source.head = null;
  while (source.read < SCAN) {
    const next = await source.rows.next();
    if (next.done) return;
    source.read++;
    if (source.keep(next.value)) {
      source.head = next.value;
      return;
    }
  }
}

/** The newest `count` distinct rows across the sources, reading each only as far as the merge reaches. */
async function merge(sources: Source[], count: number): Promise<Row[]> {
  await Promise.all(sources.map(advance));
  const rows: Row[] = [];
  const seen = new Set<Id<"comma_messages">>();
  while (rows.length < count) {
    const newest = sources.reduce<Source | null>((best, source) =>
      source.head && (!best?.head || source.head.dateCreated > best.head.dateCreated) ? source : best, null);
    if (!newest?.head) break;
    if (!seen.has(newest.head._id)) rows.push(newest.head);
    seen.add(newest.head._id);
    await advance(newest);
  }
  return rows;
}

/** Every address and one-to-one key the person is reachable at. */
async function handlesOf(ctx: QueryCtx, person: Doc<"people"> | null, address?: string) {
  const identities = person
    ? await ctx.db.query("identities").withIndex("by_person", (q) => q.eq("person_id", person._id)).take(MAX_HANDLES * 2)
    : [];
  const addresses = new Set([
    ...address ? [address, normalizedAddress(address)] : [],
    ...person?.normalized_phones ?? [], ...person?.normalized_emails ?? [],
    ...identities.flatMap(({ value, normalized }) => [value, normalized]),
  ].filter(Boolean));
  const direct = [...addresses].filter((handle) => normalizeHandle(handle));
  return { senders: [...addresses].slice(0, MAX_HANDLES), dmKeys: [...new Set(direct.map(handleKey))].slice(0, MAX_HANDLES) };
}

/**
 * Where a person talks: each handle's conversations they sent in, one index seek apiece, and their one-to-one
 * conversations with Milad. `exclude` costs nothing however busy it is.
 */
export async function personConversations(ctx: QueryCtx, person: Doc<"people"> | null, address?: string, exclude?: Id<"comma_conversations">) {
  const { senders, dmKeys } = await handlesOf(ctx, person, address);
  const conversationsOf = async (handle: string) => {
    const found: Id<"comma_conversations">[] = [];
    while (found.length < MAX_CONVERSATIONS) {
      const after = found[found.length - 1];
      const next = await ctx.db.query("comma_messages").withIndex("by_sender_conversation_date", (q) => {
        const scoped = q.eq("sender.address", handle);
        return after === undefined ? scoped : scoped.gt("conversationId", after);
      }).first();
      if (!next) break;
      found.push(next.conversationId);
    }
    return { handle, ids: found.filter((id) => id !== exclude) };
  };
  // ponytail: one-to-one keys are looked up on iMessage's account, the only one; loop the accounts when another lands.
  const scope = await soleAccountScope(ctx, "imessage");
  const [sentIn, dms] = await Promise.all([
    Promise.all(senders.map(conversationsOf)),
    Promise.all(dmKeys.map((key) => findByKey(ctx, scope, key))),
  ]);
  return { sentIn, dms: dms.filter((dm): dm is Doc<"comma_conversations"> => dm !== null && dm._id !== exclude) };
}

export async function personContext(ctx: QueryCtx, input: PersonContextInput) {
  const { person, address, excludeConversationId: exclude, sinceAt, beforeAt, limit, maxChars } = input;
  const name = personName(person) ?? (address ? formatAddress(address) : "Unknown");
  const { sentIn, dms } = await personConversations(ctx, person, address, exclude);
  const source = (rows: AsyncIterable<Row>, keep: (row: Row) => boolean): Source =>
    ({ rows: rows[Symbol.asyncIterator](), keep, read: 0, head: null });
  const sent = sentIn.flatMap(({ handle, ids }) => ids.map((id) => source(
    ctx.db.query("comma_messages").withIndex("by_sender_conversation_date", (q) => {
      const scoped = q.eq("sender.address", handle).eq("conversationId", id);
      const after = sinceAt === undefined ? scoped : scoped.gt("dateCreated", sinceAt);
      return beforeAt === undefined ? after : after.lt("dateCreated", beforeAt);
    }).order("desc"),
    (row) => !row.isFromMe && shown(row),
  )));
  const both = [...new Set(dms.map((dm) => dm._id))].map((id) => source(
    ctx.db.query("comma_messages").withIndex("by_conversation_date", (q) => {
      const scoped = q.eq("conversationId", id);
      const after = sinceAt === undefined ? scoped : scoped.gt("dateCreated", sinceAt);
      return beforeAt === undefined ? after : after.lt("dateCreated", beforeAt);
    }).order("desc"),
    shown,
  ));
  const rows = await merge([...sent, ...both], limit + 1);

  const picked: Row[] = [];
  let chars = 0;
  for (const row of rows.slice(0, limit)) {
    const length = Math.min((row.modelText ?? row.text).trim().length, LINE_CHARS);
    if (picked.length > 0 && chars + length > maxChars) break;
    picked.push(row);
    chars += length;
  }

  const conversations = new Map<Id<"comma_conversations">, Promise<{ title: string; isGroup: boolean; platform: PersonLine["platform"] } | null>>();
  const conversationOf = (id: Id<"comma_conversations">) => {
    if (!conversations.has(id)) conversations.set(id, (async () => {
      const conversation = await ctx.db.get(id);
      if (!conversation) return null;
      // A named group's title needs no participant names.
      const people = conversation.isGroup && conversation.rawDisplayName?.trim() ? [] : (await conversationPeople(ctx, conversation)).map((p) => p.person);
      return { title: resolveConversationNames(conversation, people).displayName, isGroup: conversation.isGroup, platform: conversation.platform ?? "imessage" };
    })());
    return conversations.get(id)!;
  };
  const lines = (await Promise.all(picked.map(async (row): Promise<PersonLine | null> => {
    const conversation = await conversationOf(row.conversationId);
    if (!conversation) return null;
    const text = (row.modelText ?? row.text).trim();
    return {
      at: row.dateCreated, conversationId: row.conversationId, conversation: conversation.title,
      kind: conversation.isGroup ? "group" : "dm", platform: conversation.platform, fromMe: row.isFromMe,
      sender: row.isFromMe ? "Me" : name,
      text: text ? text.slice(0, LINE_CHARS) : `[${row.attachmentGuids.length === 1 ? "an attachment" : `${row.attachmentGuids.length} attachments`}]`,
    };
  }))).filter((line): line is PersonLine => line !== null);
  return { name, lines, more: rows.length > picked.length };
}
