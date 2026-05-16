import { type ObjectType, type PropertyValidators } from "convex/values";
import { ConvexError } from "convex/values";

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
 * Throw `Unauthorized` unless the calling identity matches `ALLOWED_EMAIL`.
 * Exported for unit testing; production callers should use the
 * `authedQuery` / `authedMutation` / `authedAction` wrappers below.
 */
export async function assertAllowed(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.email !== ALLOWED_EMAIL) {
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
