import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";

import { requireIdentityKey } from "./key";

/**
 * The private CRM layer: favorites, priority, and tags — for both people and
 * GROUP CHATS. Split out from mutations.ts (which owns the name-identity edit
 * surface) because this is a distinct concept — Convex-native metadata that
 * has no source-of-truth anywhere else and must NEVER be written to Apple or
 * Airtable (see docs/plans/structured-names.html's "THE RULE: three owners"
 * and field matrix). recomputePersonAggregates (internal.ts) never references
 * any of these fields/tables, so a sync re-run can't clobber them — see
 * internal.test.ts's "CRM fields survive a sync" coverage.
 *
 * DMs have NO chat-targeted CRM of their own: their effective CRM is
 * INHERITED from the linked person (see apps/imsg/server/map.ts's `mapChat`
 * and chat_crm.ts's docstring, "MEMBERSHIP ≠ OWNERSHIP"). The chat-targeted
 * mutations below don't enforce that (they'll happily write a row for any
 * guid you pass), because Convex has no way to know a guid's DM/group-ness —
 * enforcement lives in the client, which only ever offers chat CRM editing on
 * a group's info screen (chat-info-content.tsx).
 *
 * Every mutation here follows the module's established no-op-write
 * discipline: skip the patch/insert (and the updated_at bump that comes with
 * it) entirely when the requested value already matches what's stored, so a
 * repeated tap of an already-set favorite/priority/tag doesn't invalidate
 * every reactive query subscribed to the person/chat.
 */

/** P1–P5, one = highest — see schema/identity/people.ts's docstring for why
 * this is NOT inverted (unlike Todoist's API). Out-of-range or fractional
 * input is clamped/rounded into range rather than rejected, so a slightly
 * malformed client call degrades gracefully instead of throwing. */
export function clampPriority(n: number): number {
  return Math.min(5, Math.max(1, Math.round(n)));
}

// -------------------------------------------------------------- person, CRM

/** Toggle a person's favorite flag. No-op (no write) when the value already
 * matches — `is_favorite` unset reads as `false`, so setting `false` on a
 * never-favorited person is also a no-op. */
export const setFavorite = mutation({
  args: { key: v.string(), personId: v.id("people"), is_favorite: v.boolean() },
  handler: async (ctx, { key, personId, is_favorite }) => {
    requireIdentityKey(key);
    const person = await ctx.db.get(personId);
    if (!person) throw new Error("Person not found");

    const current = person.is_favorite ?? false;
    if (current === is_favorite) return;

    await ctx.db.patch(personId, { is_favorite, updated_at: new Date().toISOString() });
  },
});

/** Set (or clear) a person's priority (P1–P5, one = highest — see
 * clampPriority). Passing `null` or omitting `priority` both clear it back to
 * unset. No-op when the requested (clamped) value already matches what's
 * stored. */
export const setPriority = mutation({
  args: {
    key: v.string(),
    personId: v.id("people"),
    priority: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { key, personId, priority }) => {
    requireIdentityKey(key);
    const person = await ctx.db.get(personId);
    if (!person) throw new Error("Person not found");

    const next = priority == null ? undefined : clampPriority(priority);
    if (person.priority === next) return;

    await ctx.db.patch(personId, { priority: next, updated_at: new Date().toISOString() });
  },
});

/** Add a personal tag to a person — trimmed and lowercased, deduped per
 * person (the unified `tags` table — see schema/identity/tags.ts). No-op when
 * the person already carries this tag. */
export const addTag = mutation({
  args: { key: v.string(), personId: v.id("people"), tag: v.string() },
  handler: async (ctx, { key, personId, tag }) => {
    requireIdentityKey(key);
    const person = await ctx.db.get(personId);
    if (!person) throw new Error("Person not found");
    await addTagRow(ctx, { person_id: personId }, tag);
  },
});

/** Remove a personal tag from a person. No-op (nothing to delete) when the
 * person doesn't carry this tag. */
export const removeTag = mutation({
  args: { key: v.string(), personId: v.id("people"), tag: v.string() },
  handler: async (ctx, { key, personId, tag }) => {
    requireIdentityKey(key);
    const person = await ctx.db.get(personId);
    if (!person) throw new Error("Person not found");
    await removeTagRow(ctx, { person_id: personId }, tag);
  },
});

// ---------------------------------------------------------------- chat, CRM

async function getChatCrmRow(ctx: MutationCtx, chatGuid: string) {
  return ctx.db
    .query("chat_crm")
    .withIndex("by_chat_guid", (q) => q.eq("chat_guid", chatGuid))
    .first();
}

/** Toggle a GROUP chat's favorite flag — the chat-side twin of `setFavorite`.
 * Upserts the chat_crm row (created lazily on first non-default write). No-op
 * when the requested value already matches what's stored (including "no row
 * yet, and the request is `false`"). */
export const setChatFavorite = mutation({
  args: { key: v.string(), chatGuid: v.string(), is_favorite: v.boolean() },
  handler: async (ctx, { key, chatGuid, is_favorite }) => {
    requireIdentityKey(key);
    const existing = await getChatCrmRow(ctx, chatGuid);
    const current = existing?.is_favorite ?? false;
    if (current === is_favorite) return;

    const now = new Date().toISOString();
    if (existing) {
      await ctx.db.patch(existing._id, { is_favorite, updated_at: now });
    } else {
      await ctx.db.insert("chat_crm", { chat_guid: chatGuid, is_favorite, created_at: now, updated_at: now });
    }
  },
});

/** Set (or clear) a GROUP chat's priority (P1–P5, one = highest) — the
 * chat-side twin of `setPriority`. Upserts the chat_crm row (created lazily
 * on first non-default write; never created just to clear an already-unset
 * priority). No-op when the requested (clamped) value already matches. */
export const setChatPriority = mutation({
  args: {
    key: v.string(),
    chatGuid: v.string(),
    priority: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { key, chatGuid, priority }) => {
    requireIdentityKey(key);
    const next = priority == null ? undefined : clampPriority(priority);
    const existing = await getChatCrmRow(ctx, chatGuid);
    const current = existing?.priority ?? undefined;
    if (current === next) return;

    const now = new Date().toISOString();
    if (existing) {
      await ctx.db.patch(existing._id, { priority: next, updated_at: now });
    } else if (next !== undefined) {
      await ctx.db.insert("chat_crm", { chat_guid: chatGuid, priority: next, created_at: now, updated_at: now });
    }
    // else: no row yet and clearing to unset — genuinely nothing to do.
  },
});

/** Add a tag to a GROUP chat — the chat-side twin of `addTag`. */
export const addChatTag = mutation({
  args: { key: v.string(), chatGuid: v.string(), tag: v.string() },
  handler: async (ctx, { key, chatGuid, tag }) => {
    requireIdentityKey(key);
    await addTagRow(ctx, { chat_guid: chatGuid }, tag);
  },
});

/** Remove a tag from a GROUP chat — the chat-side twin of `removeTag`. */
export const removeChatTag = mutation({
  args: { key: v.string(), chatGuid: v.string(), tag: v.string() },
  handler: async (ctx, { key, chatGuid, tag }) => {
    requireIdentityKey(key);
    await removeTagRow(ctx, { chat_guid: chatGuid }, tag);
  },
});

// ------------------------------------------------------------ shared tag ops

type TagOwner = { person_id: Id<"people"> } | { chat_guid: string };

/** Shared add-tag logic for both owners — trims/lowercases, dedupes against
 * whatever rows the owner already has, no-ops if already present. Exactly one
 * of person_id/chat_guid is set on the inserted row (see tags.ts's docstring)
 * — callers pass exactly one via `TagOwner`, so this can't get it wrong. */
async function addTagRow(ctx: MutationCtx, owner: TagOwner, tag: string): Promise<void> {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) throw new Error("Tag can't be empty");

  const existing =
    "person_id" in owner
      ? await ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", owner.person_id)).collect()
      : await ctx.db.query("tags").withIndex("by_chat", (q) => q.eq("chat_guid", owner.chat_guid)).collect();
  if (existing.some((t) => t.tag === normalized)) return;

  await ctx.db.insert("tags", {
    ...("person_id" in owner ? { person_id: owner.person_id } : { chat_guid: owner.chat_guid }),
    tag: normalized,
    created_at: new Date().toISOString(),
  });
}

/** Shared remove-tag logic for both owners — no-ops cleanly when the tag
 * isn't present. */
async function removeTagRow(ctx: MutationCtx, owner: TagOwner, tag: string): Promise<void> {
  const normalized = tag.trim().toLowerCase();
  const existing =
    "person_id" in owner
      ? await ctx.db.query("tags").withIndex("by_person", (q) => q.eq("person_id", owner.person_id)).collect()
      : await ctx.db.query("tags").withIndex("by_chat", (q) => q.eq("chat_guid", owner.chat_guid)).collect();
  const match = existing.find((t) => t.tag === normalized);
  if (!match) return;

  await ctx.db.delete(match._id);
}
