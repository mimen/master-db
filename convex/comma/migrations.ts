import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

import { imessage } from "./conversationIdentity";
import { findByChatGuid } from "./conversationLookup";

/**
 * One-time data moves for the conversation identity change. Each converges: a rerun finds nothing
 * left to do. Run with dryRun first; see the PR that added them for the backup and run order.
 */

/** Stamps `platform: "imessage"` on conversations written before platforms existed. Page until isDone. */
export const backfillConversationPlatform = internalMutation({
  args: { dryRun: v.boolean(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ patched: v.number(), cursor: v.string(), isDone: v.boolean() }),
  handler: async (ctx, { dryRun, cursor }) => {
    const page = await ctx.db.query("comma_conversations").paginate({ cursor, numItems: 200 });
    const missing = page.page.filter((row) => row.platform === undefined);
    if (!dryRun) for (const row of missing) await ctx.db.patch(row._id, { platform: imessage.platform });
    return { patched: missing.length, cursor: page.continueCursor, isDone: page.isDone };
  },
});

const newestFirst = (a: Doc<"chat_crm">, b: Doc<"chat_crm">) => b.updated_at.localeCompare(a.updated_at);

/**
 * Moves group CRM (chat_crm, tags, event_links) from the chat GUID it was keyed on to that chat's
 * conversation. Rows that land on one conversation merge: chat_crm keeps the newest row and fills
 * its unset fields from older ones; a tag or event link already on the conversation drops its copy.
 * A GUID no conversation knows stays as it is and is reported.
 */
export const rekeyGroupCrm = internalMutation({
  args: { dryRun: v.boolean() },
  returns: v.object({
    moved: v.object({ chat_crm: v.number(), tags: v.number(), event_links: v.number() }),
    deleted: v.object({ chat_crm: v.number(), tags: v.number(), event_links: v.number() }),
    unresolved: v.array(v.string()),
  }),
  handler: async (ctx, { dryRun }) => {
    const owners = new Map<string, Id<"comma_conversations"> | null>();
    const ownerOf = async (chatGuid: string) => {
      if (!owners.has(chatGuid)) owners.set(chatGuid, (await findByChatGuid(ctx, chatGuid))?._id ?? null);
      return owners.get(chatGuid) ?? null;
    };
    const moved = { chat_crm: 0, tags: 0, event_links: 0 };
    const deleted = { chat_crm: 0, tags: 0, event_links: 0 };

    /** Each group row with its conversation, moving it there; rows whose GUID resolves nowhere are left out. */
    async function owned<T extends Doc<"chat_crm" | "tags" | "event_links">>(rows: T[], table: keyof typeof moved) {
      const out: { row: T; conversationId: Id<"comma_conversations"> }[] = [];
      for (const row of rows) {
        if (row.conversation_id) {
          out.push({ row, conversationId: row.conversation_id });
          continue;
        }
        if (!row.chat_guid) continue;
        const conversationId = await ownerOf(row.chat_guid);
        if (!conversationId) continue;
        moved[table] += 1;
        if (!dryRun) await ctx.db.patch(row._id, { conversation_id: conversationId });
        out.push({ row, conversationId });
      }
      return out;
    }
    async function drop(table: keyof typeof deleted, id: Id<"chat_crm" | "tags" | "event_links">) {
      deleted[table] += 1;
      if (!dryRun) await ctx.db.delete(id);
    }

    const crm = new Map<string, Doc<"chat_crm">[]>();
    for (const { row, conversationId } of await owned(await ctx.db.query("chat_crm").collect(), "chat_crm")) {
      crm.set(conversationId, [...(crm.get(conversationId) ?? []), row]);
    }
    for (const rows of crm.values()) {
      const [keep, ...rest] = [...rows].sort(newestFirst);
      if (!keep || !rest.length) continue;
      const is_favorite = keep.is_favorite ?? rest.find((row) => row.is_favorite !== undefined)?.is_favorite;
      const priority = keep.priority ?? rest.find((row) => row.priority !== undefined)?.priority;
      if (!dryRun) await ctx.db.patch(keep._id, { is_favorite, priority });
      for (const row of rest) await drop("chat_crm", row._id);
    }

    async function dedupe<T extends Doc<"tags" | "event_links">>(rows: T[], table: "tags" | "event_links", same: (row: T) => string) {
      const seen = new Set<string>();
      const oldestFirst = rows.filter((row) => row.person_id === undefined).sort((a, b) => a._creationTime - b._creationTime);
      for (const { row, conversationId } of await owned(oldestFirst, table)) {
        const key = JSON.stringify([conversationId, same(row)]);
        if (seen.has(key)) await drop(table, row._id);
        else seen.add(key);
      }
    }
    await dedupe(await ctx.db.query("tags").collect(), "tags", (row) => row.tag);
    await dedupe(await ctx.db.query("event_links").collect(), "event_links", (row) => row.airtable_event_id);

    const unresolved = [...owners].filter(([, id]) => !id).map(([chatGuid]) => chatGuid).sort();
    return { moved, deleted, unresolved };
  },
});
