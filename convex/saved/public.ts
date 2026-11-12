import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import { query } from "../_generated/server";
import { assertAllowed, authedMutation } from "../_lib/authed";
import { saved_items, savedMedia, savedStatus } from "../schema/saved/items";

const savedItemView = v.object({
  _id: v.id("saved_items"),
  _creationTime: v.number(),
  ...saved_items.validator.omit("media").fields,
  media: v.array(savedMedia.extend({ src: v.string() })),
});

/**
 * One status bucket, newest saved first. A tag matches the agent's tags or
 * the platform's collection names.
 */
export const list = query({
  args: {
    status: v.optional(savedStatus),
    tag: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(savedItemView),
  handler: async (ctx, { status = "new", tag, paginationOpts }) => {
    await assertAllowed(ctx);
    const result = await ctx.db
      .query("saved_items")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("desc")
      .paginate(paginationOpts);
    // ponytail: tag filter runs per page in memory (~1300 rows); a page can come back short. Add a tag index if it grows.
    const rows = tag
      ? result.page.filter((row) => row.tags.includes(tag) || row.collections.includes(tag))
      : result.page;
    const page = await Promise.all(
      rows.map(async ({ media, ...row }) => ({
        ...row,
        media: await Promise.all(
          media.map(async (m) => ({
            ...m,
            src: (m.storage_id && (await ctx.storage.getUrl(m.storage_id))) || m.url,
          })),
        ),
      })),
    );
    return { ...result, page };
  },
});

export const setStatus = authedMutation({
  args: { id: v.id("saved_items"), status: savedStatus },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, {
      status,
      processed_at: status === "new" ? undefined : new Date().toISOString(),
    });
  },
});

export const setNotes = authedMutation({
  args: { id: v.id("saved_items"), notes: v.string() },
  handler: async (ctx, { id, notes }) => {
    await ctx.db.patch(id, { notes });
  },
});

export const tagCounts = query({
  args: {},
  returns: v.array(v.object({ tag: v.string(), count: v.number() })),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    const counts = new Map<string, number>();
    // ponytail: full scan of saved_items (~1300 rows); keep a counts table if this grows past a few thousand.
    for await (const row of ctx.db.query("saved_items")) {
      for (const tag of new Set([...row.tags, ...row.collections])) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  },
});
