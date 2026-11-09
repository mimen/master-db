import { v } from "convex/values";

import { addressesMatch, stripServiceSuffix } from "../../apps/imsg/shared/address";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { accountHealth, gmailApp, platform, type CommaPlatform } from "../schema/comma/validators";

import { IMESSAGE_ACCOUNT } from "./conversationIdentity";
import { reconnectBy } from "./googleAuth";
import type { AccountScope } from "./messageShape";

/**
 * Accounts: one signed-in identity per platform login (the iMessage Mac, a Slack workspace, a mailbox). Every
 * conversation, message and sync cursor belongs to one, so keys and message ids only need to be unique per account.
 * iMessage has exactly one, seeded on first use. OAuth platforms keep a sealed token on the row (credentials.ts), which
 * no query returns.
 */

type Account = Doc<"comma_accounts">;

const accountInput = { platform, externalId: v.string(), label: v.string(), selfHandles: v.optional(v.array(v.string())) };

async function byExternalId(ctx: QueryCtx, platform: CommaPlatform, externalId: string): Promise<Account | null> {
  return await ctx.db.query("comma_accounts")
    .withIndex("by_platform_externalId", (q) => q.eq("platform", platform).eq("externalId", externalId)).unique();
}

/** Idempotent: the account with this platform id, created or brought up to date. */
export async function ensureAccount(ctx: MutationCtx, input: {
  platform: CommaPlatform; externalId: string; label: string; selfHandles?: string[];
}): Promise<Account> {
  const existing = await byExternalId(ctx, input.platform, input.externalId);
  if (!existing) {
    const id = await ctx.db.insert("comma_accounts", {
      platform: input.platform, externalId: input.externalId, label: input.label,
      selfHandles: input.selfHandles ?? [], health: "ok", createdAt: Date.now(),
    });
    return (await ctx.db.get(id))!;
  }
  const changed = existing.label !== input.label ||
    (input.selfHandles !== undefined && input.selfHandles.join("\n") !== existing.selfHandles.join("\n"));
  if (!changed) return existing;
  const fields = { label: input.label, selfHandles: input.selfHandles ?? existing.selfHandles };
  await ctx.db.patch(existing._id, fields);
  return { ...existing, ...fields };
}

/**
 * The account an ingest call writes for: the one it names, else iMessage's, for bridges that predate accounts.
 * A named account must be on the named platform.
 */
export async function ingestAccount(ctx: MutationCtx, args: { platform?: CommaPlatform; accountId?: Id<"comma_accounts"> }): Promise<Account> {
  if (!args.accountId) {
    if (args.platform && args.platform !== "imessage") throw new Error(`An ingest for ${args.platform} must name its account`);
    return await ensureAccount(ctx, IMESSAGE_ACCOUNT);
  }
  const account = await ctx.db.get(args.accountId);
  if (!account) throw new Error("Account not found");
  if (args.platform && account.platform !== args.platform) throw new Error(`Account ${account._id} is not on ${args.platform}`);
  return account;
}

/** The scope of the platform's only account, for callers that name a thread by a platform id alone. */
export async function soleAccountScope(ctx: QueryCtx, platform: CommaPlatform): Promise<AccountScope> {
  const accounts = await ctx.db.query("comma_accounts")
    .withIndex("by_platform_externalId", (q) => q.eq("platform", platform)).take(2);
  return { platform, accountId: accounts.length === 1 ? accounts[0]!._id : null };
}

/** Whether `address` is one of the user's handles on this account: the same handle, or the same text where it has no match key. */
export function isSelf(account: Pick<Account, "selfHandles">, address: string | undefined): boolean {
  if (!address) return false;
  const handle = stripServiceSuffix(address).toLowerCase();
  return account.selfHandles.some((self) => addressesMatch(self, address) || stripServiceSuffix(self).toLowerCase() === handle);
}

/** POST /comma/ingest/account: a bridge names its account at startup and posts the id with every batch. */
export const ensure = internalMutation({
  args: accountInput,
  returns: v.id("comma_accounts"),
  handler: async (ctx, args) => (await ensureAccount(ctx, args))._id,
});

/** Settings' accounts list. Fields are named one by one, so the sealed credentials never reach a client. */
export const listAccounts = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("comma_accounts"), platform, label: v.string(), health: accountHealth, connected: v.boolean(), createdAt: v.number(),
    /** A mailbox's Google app, and when its grant ends where Google ends grants. */
    gmailApp: v.optional(gmailApp), reconnectBy: v.optional(v.number()),
    /** A mailbox's own addresses, which a reply all leaves out. */
    selfHandles: v.optional(v.array(v.string())),
  })),
  handler: async (ctx) => {
    await assertAllowed(ctx);
    return (await ctx.db.query("comma_accounts").collect()).map((account) => {
      const ends = account.credentials ? reconnectBy(account.gmailGrant) : undefined;
      return {
        _id: account._id, platform: account.platform, label: account.label, health: account.health, createdAt: account.createdAt,
        // The iMessage account has no token: the Mini's bridge is its connection.
        connected: account.platform === "imessage" || account.credentials !== undefined,
        ...(account.platform === "gmail" ? { gmailApp: account.gmailGrant?.app ?? "workspace" as const, selfHandles: account.selfHandles } : {}),
        ...(ends !== undefined ? { reconnectBy: ends } : {}),
      };
    });
  },
});
