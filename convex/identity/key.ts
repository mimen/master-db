/**
 * Shared-key gate for the identity module's public functions.
 *
 * The imsg client bundle ships the Convex deployment URL in plain JS, which
 * makes every public query/mutation/action callable by anyone who extracts
 * it — no Convex Auth session required for these functions. The contact
 * graph (~1,350 people with phones/emails) and its mutations need a floor
 * under that: a shared secret the client sends on every call.
 *
 * Deliberately fails closed: an unset env var is treated the same as "no
 * access", not "no check configured." A misconfigured deployment must
 * refuse calls, not silently open the graph.
 */
export function requireIdentityKey(provided: string): void {
  const expected = process.env.IMSG_IDENTITY_KEY;
  if (!expected) {
    throw new Error("IMSG_IDENTITY_KEY not configured on this deployment");
  }
  if (provided !== expected) {
    throw new Error("Unauthorized");
  }
}
