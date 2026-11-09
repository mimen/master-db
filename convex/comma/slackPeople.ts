import { normalizeEmail } from "../../apps/imsg/shared/address";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { recomputePersonAggregates } from "../identity/internal";

import { personForNormalized } from "./photos";
import type { SlackUser } from "./slackEvents";

/**
 * Slack users in the identity graph. Each is a `slack` identity keyed `slack:U…`. A user whose Slack email is exactly
 * a person's email joins that person, which is how a Slack DM and an iMessage chat end up under one person. Anyone
 * else gets a person of their own, named from Slack and marked auto-clustered, until a merge joins them to someone.
 * The user's profile picture rides on the identity as `img_url`, and the person's aggregates carry it as `avatar_url`.
 */

const SOURCE = "slack";

async function slackIdentity(ctx: Pick<QueryCtx, "db">, userId: string): Promise<Doc<"identities"> | null> {
  return await ctx.db.query("identities")
    .withIndex("by_kind_normalized", (q) => q.eq("kind", "slack").eq("normalized", `slack:${userId}`)).first();
}

export async function upsertSlackUsers(ctx: MutationCtx, users: readonly SlackUser[]): Promise<void> {
  for (const user of users) {
    const now = new Date().toISOString();
    const value = `slack:${user.id}`;
    let identity = await slackIdentity(ctx, user.id);
    if (!identity) {
      const id = await ctx.db.insert("identities", {
        kind: "slack", value, normalized: value, network: SOURCE, display_name: user.name, img_url: user.image, message_count: 0, chat_count: 0,
        is_self: false, source: SOURCE, first_seen_at: now, last_seen_at: now, created_at: now, updated_at: now,
      });
      identity = (await ctx.db.get(id))!;
    } else if (identity.display_name !== user.name || identity.img_url !== user.image) {
      await ctx.db.patch(identity._id, { display_name: user.name, img_url: user.image, updated_at: now });
    }
    let personId = identity.person_id;
    if (!personId) {
      const email = user.email ? normalizeEmail(user.email) : "";
      const match = email ? await personForNormalized(ctx, email) : null;
      personId = match?._id ?? await ctx.db.insert("people", {
        normalized_phones: [], normalized_emails: [], identity_count: 0, message_count: 0, is_self: false,
        auto_clustered: true, created_at: now, updated_at: now,
      });
      await ctx.db.patch(identity._id, { person_id: personId, updated_at: now });
    }
    await recomputePersonAggregates(ctx, personId);
  }
}

/** Of these Slack user ids, the ones the graph has no identity for yet. */
export async function unknownSlackUsers(ctx: Pick<QueryCtx, "db">, userIds: readonly string[]): Promise<string[]> {
  const unknown: string[] = [];
  for (const id of new Set(userIds)) if (!(await slackIdentity(ctx, id))) unknown.push(id);
  return unknown;
}

/** Slack names for rendering mrkdwn, read from the graph. */
export async function slackNames(ctx: Pick<QueryCtx, "db">, userIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of new Set(userIds)) {
    const name = (await slackIdentity(ctx, id))?.display_name;
    if (name) names.set(id, name);
  }
  return names;
}
