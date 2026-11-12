import { v } from "convex/values";

import { internalMutation, internalQuery } from "../_generated/server";
import {
  savedMedia,
  savedPlatform,
  savedSuggestion,
} from "../schema/saved/items";

export const savedItemIn = v.object({
  platform: savedPlatform,
  platform_id: v.string(),
  url: v.string(),
  author: v.optional(v.string()),
  text: v.optional(v.string()),
  posted_at: v.optional(v.string()),
  saved_at: v.optional(v.string()),
  links: v.array(v.string()),
  media: v.array(savedMedia),
  collections: v.array(v.string()),
  raw: v.optional(v.string()),
});

/**
 * Insert new saves as status "new", or refresh the platform fields of a known
 * one. The user's triage state (status, notes, summary, tags, suggestion and
 * their timestamps) is never touched here.
 */
export const upsertItems = internalMutation({
  args: { items: v.array(savedItemIn) },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, { items }) => {
    let inserted = 0;
    let updated = 0;
    for (const item of items) {
      const existing = await ctx.db
        .query("saved_items")
        .withIndex("by_platform_and_platform_id", (q) =>
          q.eq("platform", item.platform).eq("platform_id", item.platform_id),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("saved_items", {
          ...item,
          saved_at: item.saved_at ?? new Date().toISOString(),
          status: "new",
          tags: [],
        });
        inserted += 1;
        continue;
      }
      // Absent optional keys stay out of the patch, so a sparser re-import
      // (or one without saved_at) keeps what is stored.
      const { platform: _platform, platform_id: _id, media, ...fields } = item;
      let nextMedia = media;
      if (existing.media.some((m) => m.storage_id)) {
        // Stored copies outlive expiring platform URLs; keep them and free
        // any re-uploaded duplicates so storage does not leak.
        nextMedia = existing.media;
        const kept = new Set(existing.media.map((m) => m.storage_id));
        for (const m of media) {
          if (m.storage_id && !kept.has(m.storage_id)) {
            await ctx.storage.delete(m.storage_id);
          }
        }
      }
      await ctx.db.patch(existing._id, { ...fields, media: nextMedia });
      updated += 1;
    }
    return { inserted, updated };
  },
});

export const knownIds = internalQuery({
  args: { platform: savedPlatform, platform_ids: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { platform, platform_ids }) => {
    const rows = await Promise.all(
      platform_ids.map((platform_id) =>
        ctx.db
          .query("saved_items")
          .withIndex("by_platform_and_platform_id", (q) =>
            q.eq("platform", platform).eq("platform_id", platform_id),
          )
          .unique(),
      ),
    );
    return rows.flatMap((row) => (row ? [row.platform_id] : []));
  },
});

export const generateUploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const listUntriaged = internalQuery({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      platform: savedPlatform,
      platform_id: v.string(),
      url: v.string(),
      author: v.optional(v.string()),
      text: v.optional(v.string()),
      links: v.array(v.string()),
      collections: v.array(v.string()),
      media: v.array(v.object({ type: savedMedia.fields.type })),
    }),
  ),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("saved_items")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .order("desc")
      .filter((q) => q.eq(q.field("suggestion"), undefined))
      .take(limit);
    return rows.map((row) => ({
      platform: row.platform,
      platform_id: row.platform_id,
      url: row.url,
      author: row.author,
      text: row.text,
      links: row.links,
      collections: row.collections,
      media: row.media.map((m) => ({ type: m.type })),
    }));
  },
});

/** Write the triage agent's drafts. Status stays with the user. */
export const setTriage = internalMutation({
  args: {
    results: v.array(
      v.object({
        platform: savedPlatform,
        platform_id: v.string(),
        summary: v.string(),
        tags: v.array(v.string()),
        suggestion: savedSuggestion,
      }),
    ),
  },
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  handler: async (ctx, { results }) => {
    let updated = 0;
    let skipped = 0;
    const triaged_at = new Date().toISOString();
    for (const { platform, platform_id, summary, tags, suggestion } of results) {
      const row = await ctx.db
        .query("saved_items")
        .withIndex("by_platform_and_platform_id", (q) =>
          q.eq("platform", platform).eq("platform_id", platform_id),
        )
        .unique();
      if (!row) {
        skipped += 1;
        continue;
      }
      await ctx.db.patch(row._id, { summary, tags, suggestion, triaged_at });
      updated += 1;
    }
    return { updated, skipped };
  },
});
