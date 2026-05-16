import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { ALLOWED_EMAIL } from "./_lib/authed";
import { internalQuery } from "./_generated/server";

/**
 * Reject any Google profile whose email does not match the whitelist.
 *
 * Throwing here means Convex Auth never inserts the `users` row, so a
 * rejected user is never issued a session token. The per-call `authed*`
 * wrappers are belt-and-suspenders for the unlikely case of a stale row.
 */
export function rejectIfNotAllowed(profile: Record<string, unknown>) {
  const email = typeof profile.email === "string" ? profile.email : null;
  if (email !== ALLOWED_EMAIL) {
    throw new Error("Unauthorized: this app is restricted to a single user.");
  }
  return {
    id: String(profile.sub ?? profile.id ?? ""),
    email,
    name: typeof profile.name === "string" ? profile.name : null,
  };
}

/**
 * Allowed post-sign-in redirect origins. Convex Auth's default callback only
 * accepts URLs matching the global `SITE_URL` env var — which forces a single
 * frontend per Convex deployment. We have one deployment but two frontends
 * (localhost dev + Heroku prod), so we override with a small allowlist. The
 * client passes `redirectTo: window.location.origin` and we accept it iff
 * the origin is on this list.
 *
 * Add new entries here when deploying to a new frontend host; no need to
 * touch the `SITE_URL` env var.
 */
const ALLOWED_REDIRECT_ORIGINS = [
  "http://localhost:3000",
  "https://convex-db-master-d31d50f579b2.herokuapp.com",
];

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      profile(googleProfile) {
        return rejectIfNotAllowed(googleProfile as Record<string, unknown>);
      },
    }),
  ],
  callbacks: {
    async redirect({ redirectTo }) {
      for (const origin of ALLOWED_REDIRECT_ORIGINS) {
        if (
          redirectTo === origin ||
          redirectTo.startsWith(`${origin}/`) ||
          redirectTo.startsWith(`${origin}?`)
        ) {
          return redirectTo;
        }
      }
      throw new Error(
        `Disallowed redirectTo: ${redirectTo}. Add the origin to ALLOWED_REDIRECT_ORIGINS in convex/auth.ts.`,
      );
    },
  },
});

/**
 * Internal helper used by `assertAllowed` in `_lib/authed.ts` to fetch a user's
 * email when running inside an action ctx (which has no direct `ctx.db`).
 * Underscored helper files in `convex/_lib` are excluded from Convex's API
 * generation, so the internalQuery has to live here.
 */
export const _getUserEmail = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user?.email ?? null;
  },
});
