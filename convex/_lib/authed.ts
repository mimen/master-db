import { type ObjectType, type PropertyValidators } from "convex/values";
import { ConvexError } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  action,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";

/**
 * The single Google identity allowed to use this deployment.
 *
 * Hard-coded on purpose: an env-driven value introduces a "what if unset"
 * failure mode that silently degrades to "anyone allowed."
 */
export const ALLOWED_EMAIL = "milad@afternoonumbrellafriends.com";

/**
 * Parse the Convex Auth identity subject (format: `<userId>|<sessionId>`) into
 * the underlying user-table id. Exported for testing.
 */
export function userIdFromSubject(subject: string): Id<"users"> {
  return (subject.includes("|") ? subject.split("|")[0] : subject) as Id<"users">;
}

/**
 * Throw `Unauthorized` unless the calling identity exists in the users table
 * with `email === ALLOWED_EMAIL`. The JWT subject only carries the user id,
 * not the email, so we look up the user record.
 *
 * For query/mutation contexts we read `ctx.db` directly. For action contexts
 * we route through `internal.auth._getUserEmail` since actions have no db.
 */
export async function assertAllowed(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Unauthorized");
  }
  const userId = userIdFromSubject(identity.subject);

  let email: string | null;
  if ("db" in ctx) {
    const user = await ctx.db.get(userId);
    email = user?.email ?? null;
  } else {
    email = await ctx.runQuery(internal.auth._getUserEmail, { userId });
  }

  if (email !== ALLOWED_EMAIL) {
    throw new ConvexError("Unauthorized");
  }
}

export function authedQuery<
  ArgsValidator extends PropertyValidators = Record<never, never>,
  Output = unknown,
>(def: {
  args?: ArgsValidator;
  handler: (ctx: QueryCtx, args: ObjectType<ArgsValidator>) => Output | Promise<Output>;
}) {
  return query({
    args: (def.args ?? {}) as ArgsValidator,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: async (ctx: QueryCtx, args: any) => {
      await assertAllowed(ctx);
      return def.handler(ctx, args as ObjectType<ArgsValidator>);
    },
  });
}

export function authedMutation<
  ArgsValidator extends PropertyValidators = Record<never, never>,
  Output = unknown,
>(def: {
  args?: ArgsValidator;
  handler: (ctx: MutationCtx, args: ObjectType<ArgsValidator>) => Output | Promise<Output>;
}) {
  return mutation({
    args: (def.args ?? {}) as ArgsValidator,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: async (ctx: MutationCtx, args: any) => {
      await assertAllowed(ctx);
      return def.handler(ctx, args as ObjectType<ArgsValidator>);
    },
  });
}

export function authedAction<
  ArgsValidator extends PropertyValidators = Record<never, never>,
  Output = unknown,
>(def: {
  args?: ArgsValidator;
  handler: (ctx: ActionCtx, args: ObjectType<ArgsValidator>) => Output | Promise<Output>;
}) {
  return action({
    args: (def.args ?? {}) as ArgsValidator,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: async (ctx: ActionCtx, args: any) => {
      await assertAllowed(ctx);
      return def.handler(ctx, args as ObjectType<ArgsValidator>);
    },
  });
}
