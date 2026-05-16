# Convex Auth — Single-User Lockdown

**Status:** Approved design, awaiting spec review
**Date:** 2026-05-15
**Owner:** Milad

## Problem

`master-db` is deployed as a public Heroku app (Vite/React frontend) backed by a public Convex deployment. Anyone with the Heroku URL can:

1. Load the full UI.
2. Open a Convex WebSocket and call every `query`, `mutation`, and `action` directly — including the agentic ("LLM brain") functions, which spend tokens against Milad's API budgets and could be weaponized for arbitrary prompts.
3. Read all personal data (Todoist sync, routines, agentic state).

The app is single-user and not intended for distribution. The goal is to lock it down to exactly one identity: `milad@afternoonumbrellafriends.com`.

## Goals

- Authentication enforced at the Convex function layer, not just the frontend.
- Sign-in via Google OAuth using the personal `milad@afternoonumbrellafriends.com` account.
- Single-email whitelist: any other Google identity that completes the OAuth round-trip is rejected before a session is issued and again on every subsequent function call.
- Default-locked: any future `query`/`mutation`/`action` added to the codebase is auth-required unless explicitly marked public.
- Existing Todoist webhook (HMAC-validated `httpAction`) stays publicly reachable.
- Existing cron jobs and internal functions continue to work without authentication (system callers).

## Non-goals

- Multi-user support, RBAC, or per-row tenancy (no `userId` foreign keys added to existing tables).
- Magic-link or password fallback. Google only.
- Heroku-level basic auth in front of the static bundle. Lockdown is at the data layer.
- Custom session-length tuning. Convex Auth defaults are fine.
- Anonymous read access to anything.

## Architecture

```
Browser ── Google OAuth ──▶ Convex Auth ── session token ──▶ Browser
   │
   ├── Convex WS (queries / mutations / actions)
   │     └── authedXxx wrapper: identity.email must equal ALLOWED_EMAIL
   │
   └── HTTP routes
         ├── /api/auth/*          (mounted by auth.addHttpRoutes)
         └── /todoist/webhook     (HMAC, intentionally public)
```

### New files

- **`convex/auth.ts`** — Calls `convexAuth({ providers: [Google] })`. Exports `auth`, `signIn`, `signOut`, `store`, and `isAuthenticated` helpers per the `@convex-dev/auth` template. The Google provider passes a `profile()` override that rejects any identity whose `email` does not match `ALLOWED_EMAIL` (rejection happens by throwing — Convex Auth never inserts the `users` row, so no session token is issued).
- **`convex/_lib/authed.ts`** — Defines `authedQuery`, `authedMutation`, `authedAction` as thin wrappers around `query`, `mutation`, `action`. Each wrapper:
  1. Calls `await ctx.auth.getUserIdentity()`.
  2. Throws `ConvexError("Unauthorized")` if `identity` is null or `identity.email !== ALLOWED_EMAIL`.
  3. Passes `ctx` and `args` through to the wrapped handler.
- **`ALLOWED_EMAIL` constant** lives in `convex/_lib/authed.ts` as a hard-coded string literal: `"milad@afternoonumbrellafriends.com"`. Not env-driven, because env-driven introduces a "what if unset" failure mode that silently degrades to "anyone allowed."

### Modified files

- **`convex/http.ts`** — Add `auth.addHttpRoutes(http)` to mount Convex Auth's `/api/auth/*` endpoints alongside the existing Todoist webhook.
- **`convex/schema.ts`** — Spread `authTables` from `@convex-dev/auth/server` alongside the existing `todoist`, `routines`, `agentic`, and `sync_state` table groups.
- **Every public `query`/`mutation`/`action` in `convex/todoist/`, `convex/routines/`, `convex/agentic/`, `convex/dashboard/`** — Swap the definition function from `query`/`mutation`/`action` to `authedQuery`/`authedMutation`/`authedAction`. Argument and return signatures are unchanged.
- **`app/src/App.tsx`** — Swap `ConvexProvider` for `ConvexAuthProvider`. Wrap everything inside it with a new `AuthGate` component.
- **`app/package.json`** and **`package.json`** — Add `@convex-dev/auth` dependency.

### New frontend components

- **`app/src/auth/AuthGate.tsx`** — Reads `useConvexAuth()`. Renders `<FullScreenSpinner />` while `isLoading`, `<SignInScreen />` if `!isAuthenticated`, and `children` otherwise. Ensures no data fetches fire while unauthenticated, because no Convex hooks mount inside the gate until auth resolves.
- **`app/src/auth/SignInScreen.tsx`** — Single-button page: "Sign in with Google" → `signIn("google")`. After redirect, if the email was rejected by the provider callback, the page also displays a "Not authorized for this app" notice with a sign-out link.

## Defense in depth

Whitelist is enforced in two places, both deliberate:

1. **At sign-in**, in the Google provider `profile()` callback. If the email is not allowed, throw — Convex Auth never creates the `users` row, never issues a session token.
2. **At every function call**, in the `authedXxx` wrapper. If `identity.email` is missing or wrong, the function refuses.

Either alone would technically suffice. Both is cheap and survives the case where a stale row exists in `users` or a session token leaks.

## What stays public

- **`/todoist/webhook`** (httpAction, HMAC-validated). Stays a plain `httpAction`, not auth-wrapped.
- **All `internalQuery` / `internalMutation` / `internalAction` definitions.** These are not callable from the client; they are reachable only from other Convex functions and from cron jobs. No wrapping needed.
- **`/api/auth/*`** (mounted by Convex Auth itself). The OAuth callback machinery has to be publicly reachable.

If a *public* function ever needs to be system-callable (e.g., from a cron, but not internal), it stays as a plain `query`/`mutation`/`action` and must carry a code comment explaining why it is intentionally unauthenticated.

## Environment

Two new Convex environment variables (set via `bunx convex env set`, not the Vite build):

- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`

Plus:

- `SITE_URL` — the deployed Heroku URL (e.g., `https://master-db.herokuapp.com`). Convex Auth uses this to construct the OAuth redirect URI.

Local development also needs the same three vars in `.env.local` for `bunx convex dev`, plus a `SITE_URL=http://localhost:5173`. The Google OAuth app in Google Cloud Console gets both the production and local callback URIs registered.

`VITE_CONVEX_URL` is unchanged. The Heroku-served static bundle continues to ship publicly; the lockdown is at the data layer.

## Schema impact

Spreading `authTables` adds `users`, `accounts`, `sessions`, `authVerificationCodes`, `authVerifiers`, `authRefreshTokens`, and `authRateLimits`. These are owned by Convex Auth; the application code does not read or write them directly.

No existing table is modified. No `userId` foreign keys are added. The whitelist is the tenant boundary.

## Testing

- **Unit test `authedQuery`/`authedMutation`/`authedAction`** in `convex/_lib/authed.test.ts` using `convex-test`. Cases:
  - No identity → throws `Unauthorized`.
  - Identity with wrong email → throws `Unauthorized`.
  - Identity with `ALLOWED_EMAIL` → handler runs, ctx/args pass through, return value matches.
- **Unit test the Google provider callback** rejects non-allowed emails. Asserts the callback throws before returning a profile object.
- **`SignInScreen` test** in `app/src/auth/SignInScreen.test.tsx` — renders the button, clicking calls a mocked `signIn("google")`.
- **Regression smoke test per service** — one existing query in `convex/todoist`, `convex/routines`, `convex/agentic` invoked with the whitelisted identity continues to return the same shape it did before the swap.
- **No automated end-to-end OAuth test.** Manual verification on a real deploy:
  1. Deploy to Heroku.
  2. Open the Heroku URL in an incognito window → sign-in screen renders, no data hooks fire.
  3. Sign in as `milad@afternoonumbrellafriends.com` → app loads, existing views work.
  4. Sign out → app blanks to sign-in screen.
  5. Sign in with a different Google account → "Not authorized" message, no `users` row created.

## Rollout

1. Land schema change with `authTables` spread; run `bunx convex dev` so generated types update.
2. Land `convex/auth.ts`, `convex/_lib/authed.ts`, `http.ts` wiring. Functions remain plain `query`/`mutation`/`action` — backend still openly reachable.
3. Swap every public function to its `authed*` variant in one PR per service folder (todoist, routines, agentic, dashboard). After each swap, `bun run typecheck && bun run lint && bun test`.
4. Land frontend `ConvexAuthProvider` + `AuthGate` + `SignInScreen`. Local `bun --cwd app dev` smoke test against a personal Convex dev deployment.
5. Configure Google OAuth credentials in Google Cloud Console with production + localhost redirect URIs. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `SITE_URL` via `bunx convex env set` for both dev and prod deployments.
6. `bunx convex deploy` → deploy Heroku → run manual verification checklist above.

No data migration. No downtime concern (single user).

## Open risks

- **Google Cloud OAuth app setup is manual** and outside the codebase. If `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` / `SITE_URL` are misconfigured, sign-in fails with an opaque error and the app is unusable. Mitigated by manually verifying the OAuth flow before flipping prod.
- **The Todoist webhook stays public.** It is HMAC-validated. If `TODOIST_WEBHOOK_SECRET` ever leaked, an attacker could forge webhook payloads and trigger sync work. Out of scope for this change but worth noting.
- **`ALLOWED_EMAIL` is hard-coded.** A future "I lost access to this Google account" scenario requires a code change + redeploy to recover. Acceptable given the single-user posture; a workspace-domain whitelist would be a one-line change later if needed.
