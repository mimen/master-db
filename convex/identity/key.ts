import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { assertAllowed } from "../_lib/authed";
import { constantTimeEqual } from "../_lib/constantTimeEqual";

/**
 * Gate for the identity module's public functions. A server caller passes
 * IMSG_SERVER_SECRET as `key`; the browser passes nothing and rides its
 * signed-in session. IMSG_IDENTITY_KEY is the retired shared key that once
 * shipped in the imsg web bundle; it is honoured only while it is still set
 * on the deployment, so removing it from Convex env is the enforcement step.
 */
export async function requireIdentityAccess(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  key: string | undefined,
): Promise<void> {
  if (key !== undefined) {
    for (const expected of [process.env.IMSG_SERVER_SECRET, process.env.IMSG_IDENTITY_KEY]) {
      if (expected && constantTimeEqual(expected, key)) return;
    }
  }
  await assertAllowed(ctx);
}
