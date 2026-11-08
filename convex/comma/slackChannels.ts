import { v } from "convex/values";

import { internal } from "../_generated/api";
import { action, internalQuery, mutation } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";

import { slackApi } from "./slackApi";
import { slackToken } from "./slackAuth";
import { startChannelBackfill } from "./slackSync";

/**
 * Channel opt-ins, from Settings' accounts screen. Comma keeps a channel's top-level messages and threads only once
 * Milad follows it there (`slackChannels` on the account); its attention stays mentions only.
 */

const slackChannel = v.object({ id: v.string(), name: v.string(), isPrivate: v.boolean(), following: v.boolean() });

/** At most this many channels, Slack's own page size times five. */
const MAX_PAGES = 5;

export const followedChannels = internalQuery({
  args: { accountId: v.id("comma_accounts") },
  returns: v.array(v.string()),
  handler: async (ctx, { accountId }) => (await ctx.db.get(accountId))?.slackChannels ?? [],
});

/** The channels Milad is in, by name, and which ones Comma follows. Reads Slack, so Settings calls it once on open. */
export const listSlackChannels = action({
  args: { accountId: v.id("comma_accounts") },
  returns: v.array(slackChannel),
  handler: async (ctx, { accountId }) => {
    await assertAllowed(ctx);
    const token = await slackToken(ctx, accountId);
    if (!token) return [];
    const following = new Set(await ctx.runQuery(internal.comma.slackChannels.followedChannels, { accountId }));
    const channels: { id: string; name: string; isPrivate: boolean; following: boolean }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await slackApi<{ channels?: { id: string; name?: string; is_private?: boolean }[]; response_metadata?: { next_cursor?: string } }>(
        "users.conversations", { types: "public_channel,private_channel", exclude_archived: true, limit: 200, cursor }, token);
      for (const channel of result.channels ?? []) {
        channels.push({ id: channel.id, name: channel.name ?? channel.id, isPrivate: channel.is_private ?? false, following: following.has(channel.id) });
      }
      cursor = result.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    return channels.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Follows or stops following a channel. Following one reads its last 90 days; stopping keeps what Comma already holds. */
export const setSlackChannel = mutation({
  args: { accountId: v.id("comma_accounts"), channel: v.string(), name: v.string(), following: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { accountId, channel, name, following }) => {
    await assertAllowed(ctx);
    const account = await ctx.db.get(accountId);
    if (account?.platform !== "slack") throw new Error("Not a Slack account");
    const current = account.slackChannels ?? [];
    if (current.includes(channel) === following) return null;
    await ctx.db.patch(accountId, { slackChannels: following ? [...current, channel] : current.filter((id) => id !== channel) });
    if (following) await startChannelBackfill(ctx, accountId, { id: channel, name });
    return null;
  },
});
