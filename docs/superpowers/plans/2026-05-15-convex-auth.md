# Convex Auth — Single-User Lockdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock `master-db` to a single Google identity (`milad@afternoonumbrellafriends.com`) by enforcing authentication at the Convex function layer and gating the React frontend behind a sign-in screen.

**Architecture:** Add `@convex-dev/auth` with Google OAuth. Wrap every public Convex `query`/`mutation`/`action` in `authedQuery`/`authedMutation`/`authedAction` factories that throw unless `ctx.auth.getUserIdentity().email === ALLOWED_EMAIL`. Provider `profile()` callback rejects non-allowed emails so no session is ever issued. Frontend mounts `ConvexAuthProvider` and wraps the existing layout in an `AuthGate` that renders a sign-in screen until authenticated. Todoist webhook (HMAC) and internal/cron functions stay public.

**Tech Stack:** Convex, `@convex-dev/auth`, `@auth/core` Google provider, React 19, Vite, TypeScript strict, vitest + `convex-test`.

**Spec:** `docs/superpowers/specs/2026-05-15-convex-auth-design.md`

---

## File Structure

**New files (backend):**
- `convex/auth.ts` — `convexAuth({ providers: [Google] })`, profile callback whitelisting.
- `convex/_lib/authed.ts` — `ALLOWED_EMAIL`, `authedQuery`, `authedMutation`, `authedAction` factories.
- `convex/_lib/authed.test.ts` — Unit tests for the wrappers.
- `convex/auth.config.ts` — Provider config required by Convex Auth.

**New files (frontend):**
- `app/src/auth/AuthGate.tsx` — Reads `useConvexAuth()`, renders spinner / sign-in / children.
- `app/src/auth/SignInScreen.tsx` — Single-button Google sign-in page with not-authorized fallback.
- `app/src/auth/SignInScreen.test.tsx` — Renders button, click dispatches `signIn("google")`.

**Modified files:**
- `convex/schema.ts` — Spread `authTables`.
- `convex/http.ts` — Mount `auth.addHttpRoutes(http)`.
- `convex/todoist/**` `convex/routines/**` `convex/agentic/**` `convex/dashboard/**` — Swap public `query`/`mutation`/`action` → `authedQuery`/`authedMutation`/`authedAction` across ~42 files.
- `app/src/App.tsx` — Swap `ConvexProvider` → `ConvexAuthProvider`, wrap layout in `<AuthGate>`.
- `app/package.json`, `package.json` — Add `@convex-dev/auth`.
- `.env.local` (gitignored) — `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `SITE_URL` for dev.

**Files explicitly NOT modified:**
- `convex/http.ts` Todoist route — stays public (HMAC).
- Anything declared with `internalQuery` / `internalMutation` / `internalAction` — not client-reachable.
- `convex/routines/crons.ts` and `convex/todoist/webhook.ts` — system callers, not authenticated.

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`
- Modify: `app/package.json`

- [ ] **Step 1: Add `@convex-dev/auth` to the Convex root project**

Run:
```bash
cd ~/Documents/GitHub/master-db
bun add @convex-dev/auth @auth/core
```

Expected: both packages added to root `package.json`.

- [ ] **Step 2: Add `@convex-dev/auth` to the app workspace**

Run:
```bash
cd ~/Documents/GitHub/master-db
bun --cwd app add @convex-dev/auth
```

Expected: `@convex-dev/auth` added to `app/package.json`.

- [ ] **Step 3: Verify the install with a typecheck**

Run:
```bash
bun run typecheck
```

Expected: PASS (no code changes yet).

- [ ] **Step 4: Commit**

```bash
git add package.json app/package.json bun.lock app/bun.lock
git commit -m "chore(auth): add @convex-dev/auth dependency"
```

---

## Task 2: Add the `authed*` wrapper factories

**Files:**
- Create: `convex/_lib/authed.ts`
- Test: `convex/_lib/authed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/_lib/authed.test.ts`:

```typescript
import { describe, expect, test } from "vitest";

import { ALLOWED_EMAIL, assertAllowed } from "./authed";

function makeCtx(identity: { email?: string } | null) {
  return {
    auth: {
      getUserIdentity: async () => identity,
    },
  } as Parameters<typeof assertAllowed>[0];
}

describe("ALLOWED_EMAIL", () => {
  test("is the single whitelisted address", () => {
    expect(ALLOWED_EMAIL).toBe("milad@afternoonumbrellafriends.com");
  });
});

describe("assertAllowed", () => {
  test("throws Unauthorized when no identity is present", async () => {
    await expect(assertAllowed(makeCtx(null))).rejects.toThrow(/Unauthorized/);
  });

  test("throws Unauthorized when identity email is missing", async () => {
    await expect(assertAllowed(makeCtx({}))).rejects.toThrow(/Unauthorized/);
  });

  test("throws Unauthorized when identity email does not match", async () => {
    await expect(
      assertAllowed(makeCtx({ email: "intruder@example.com" })),
    ).rejects.toThrow(/Unauthorized/);
  });

  test("resolves when identity email matches ALLOWED_EMAIL", async () => {
    await expect(
      assertAllowed(makeCtx({ email: ALLOWED_EMAIL })),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
bun test convex/_lib/authed.test.ts
```

Expected: FAIL — `Cannot find module './authed'`.

- [ ] **Step 3: Implement the factories**

Create `convex/_lib/authed.ts`:

```typescript
import { ConvexError } from "convex/values";
import type { ArgsArrayToObject, FunctionVisibility } from "convex/server";

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
 * Exported for unit testing — production callers should use the
 * `authedQuery`/`authedMutation`/`authedAction` wrappers below.
 */
export async function assertAllowed(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.email !== ALLOWED_EMAIL) {
    throw new ConvexError("Unauthorized");
  }
}

type AnyArgs = Record<string, unknown>;

/**
 * Wrap `query`. The wrapped handler runs only if the caller's identity
 * email matches `ALLOWED_EMAIL`.
 */
export function authedQuery<Args extends Record<string, unknown>, Output>(def: {
  args: Parameters<typeof query>[0]["args"];
  handler: (ctx: QueryCtx, args: Args) => Output | Promise<Output>;
}) {
  return query({
    args: def.args,
    handler: async (ctx, args) => {
      await assertAllowed(ctx);
      return def.handler(ctx, args as Args);
    },
  });
}

export function authedMutation<Args extends Record<string, unknown>, Output>(def: {
  args: Parameters<typeof mutation>[0]["args"];
  handler: (ctx: MutationCtx, args: Args) => Output | Promise<Output>;
}) {
  return mutation({
    args: def.args,
    handler: async (ctx, args) => {
      await assertAllowed(ctx);
      return def.handler(ctx, args as Args);
    },
  });
}

export function authedAction<Args extends Record<string, unknown>, Output>(def: {
  args: Parameters<typeof action>[0]["args"];
  handler: (ctx: ActionCtx, args: Args) => Output | Promise<Output>;
}) {
  return action({
    args: def.args,
    handler: async (ctx, args) => {
      await assertAllowed(ctx);
      return def.handler(ctx, args as Args);
    },
  });
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
bun test convex/_lib/authed.test.ts
```

Expected: PASS — all 5 cases (`ALLOWED_EMAIL` value, no identity, missing email, wrong email, allowed email).

- [ ] **Step 5: Typecheck**

Run:
```bash
bun run typecheck && bun run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add convex/_lib/authed.ts convex/_lib/authed.test.ts
git commit -m "feat(auth): add authedQuery/Mutation/Action factories"
```

---

## Task 3: Wire Convex Auth with Google provider + whitelist callback

**Files:**
- Create: `convex/auth.ts`
- Create: `convex/auth.config.ts`
- Test: `convex/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `convex/auth.test.ts`:

```typescript
import { describe, expect, test } from "vitest";

import { ALLOWED_EMAIL } from "./_lib/authed";
import { rejectIfNotAllowed } from "./auth";

describe("rejectIfNotAllowed", () => {
  test("returns profile when email matches", () => {
    const profile = { email: ALLOWED_EMAIL, name: "Milad", sub: "abc" };
    expect(rejectIfNotAllowed(profile)).toEqual({
      id: "abc",
      email: ALLOWED_EMAIL,
      name: "Milad",
    });
  });

  test("throws when email is missing", () => {
    expect(() => rejectIfNotAllowed({ sub: "abc" })).toThrow(/Unauthorized/);
  });

  test("throws when email is wrong", () => {
    expect(() =>
      rejectIfNotAllowed({ email: "intruder@example.com", sub: "abc" }),
    ).toThrow(/Unauthorized/);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
bun test convex/auth.test.ts
```

Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Implement `convex/auth.ts`**

Create `convex/auth.ts`:

```typescript
import { convexAuth } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";

import { ALLOWED_EMAIL } from "./_lib/authed";

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

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      profile(googleProfile) {
        return rejectIfNotAllowed(googleProfile as Record<string, unknown>);
      },
    }),
  ],
});
```

- [ ] **Step 4: Create the provider config file Convex Auth expects**

Create `convex/auth.config.ts`:

```typescript
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
```

- [ ] **Step 5: Run the test and verify it passes**

Run:
```bash
bun test convex/auth.test.ts
```

Expected: PASS — all 3 cases.

- [ ] **Step 6: Typecheck**

Run:
```bash
bun run typecheck && bun run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add convex/auth.ts convex/auth.config.ts convex/auth.test.ts
git commit -m "feat(auth): configure Convex Auth with Google + email whitelist"
```

---

## Task 4: Schema — spread `authTables`

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Edit `convex/schema.ts`**

Current contents:
```typescript
import { defineSchema } from "convex/server";

import * as agentic from "./schema/agentic";
import * as routines from "./schema/routines";
import { sync_state } from "./schema/sync/syncState";
import * as todoist from "./schema/todoist";

export default defineSchema({
  ...todoist,

  ...routines,

  ...agentic,

  sync_state,

});
```

Replace with:
```typescript
import { authTables } from "@convex-dev/auth/server";
import { defineSchema } from "convex/server";

import * as agentic from "./schema/agentic";
import * as routines from "./schema/routines";
import { sync_state } from "./schema/sync/syncState";
import * as todoist from "./schema/todoist";

export default defineSchema({
  ...authTables,

  ...todoist,

  ...routines,

  ...agentic,

  sync_state,
});
```

- [ ] **Step 2: Regenerate types**

Run:
```bash
bunx convex dev --once
```

Expected: completes without schema errors. `convex/_generated/*` updates to include the auth tables.

- [ ] **Step 3: Typecheck + tests**

Run:
```bash
bun run typecheck && bun test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts convex/_generated
git commit -m "feat(auth): add authTables to schema"
```

---

## Task 5: Mount Convex Auth HTTP routes

**Files:**
- Modify: `convex/http.ts`

- [ ] **Step 1: Edit `convex/http.ts`**

Replace the file contents with:

```typescript
import { httpRouter } from "convex/server";

import { auth } from "./auth";
import { handleTodoistWebhook } from "./todoist/webhook";

/**
 * HTTP Router for Convex
 * Handles incoming HTTP requests and routes them to appropriate handlers
 */
const http = httpRouter();

/**
 * Convex Auth — mounts /api/auth/* (callbacks, token refresh, sign-out).
 * These endpoints are intentionally public; the whitelist is enforced in
 * the Google provider's profile() callback.
 */
auth.addHttpRoutes(http);

/**
 * Todoist webhook endpoint
 * POST /todoist/webhook
 *
 * Receives real-time webhook notifications from Todoist.
 * Intentionally public: validated by HMAC signature, not Convex Auth.
 */
http.route({
  path: "/todoist/webhook",
  method: "POST",
  handler: handleTodoistWebhook,
});

export default http;
```

- [ ] **Step 2: Typecheck**

Run:
```bash
bun run typecheck && bun run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add convex/http.ts
git commit -m "feat(auth): mount Convex Auth HTTP routes alongside Todoist webhook"
```

---

## Task 6: Swap todoist public functions to `authed*`

**Files:**
- Modify: every `.ts` file under `convex/todoist/queries/`, `convex/todoist/mutations/`, `convex/todoist/actions/`.

This is a mechanical refactor. For each file:

- Replace `import { query } from "../../_generated/server";` with `import { authedQuery } from "../../_lib/authed";`
- Replace `= query({` with `= authedQuery({`
- Same for `mutation` → `authedMutation` and `action` → `authedAction`.

Files declaring `internalQuery` / `internalMutation` / `internalAction` are NOT touched. Files in `convex/todoist/sync/`, `convex/todoist/types/`, `convex/todoist/utils/` are NOT touched. `convex/todoist/webhook.ts` and `convex/todoist/debug.ts` are NOT touched (debug stays as `query` — gate it manually if exposed; otherwise it should be moved to `internalQuery` later).

- [ ] **Step 1: List the files to modify**

Run:
```bash
grep -rln "^import.*query.*from.*_generated/server\"\|^import.*mutation.*from.*_generated/server\"\|^import.*action.*from.*_generated/server\"" convex/todoist/queries convex/todoist/mutations convex/todoist/actions | sort
```

Expected: ~38 files listed. Save the list — these are the only files that should change in this task.

- [ ] **Step 2: For each file in the list, perform the swap**

Example before (`convex/todoist/queries/getAllProjects.ts`):
```typescript
import { v } from "convex/values";

import { query } from "../../_generated/server";

export const getAllProjects = query({
```

After:
```typescript
import { v } from "convex/values";

import { authedQuery } from "../../_lib/authed";

export const getAllProjects = authedQuery({
```

Apply the equivalent swap (`mutation` → `authedMutation`, `action` → `authedAction`) for the other two function kinds.

- [ ] **Step 3: Typecheck**

Run:
```bash
bun run typecheck
```

Expected: PASS. If a type error appears about handler signature mismatch, the `args` for that function probably uses a complex type — in that case, leave the handler signature as `async (ctx, args)` (let TS infer) since the wrapper passes args through unchanged.

- [ ] **Step 4: Lint**

Run:
```bash
bun run lint
```

Expected: PASS.

- [ ] **Step 5: Run the existing test suite**

Run:
```bash
bun test convex/todoist
```

Expected: PASS. Tests call `t.mutation(api.todoist...)` without an identity — they should now FAIL with "Unauthorized" because the functions now require auth.

If tests fail with "Unauthorized": update every affected test to add `.withIdentity({ email: ALLOWED_EMAIL })` between `convexTest(schema, modules)` and the function call. Example before:
```typescript
const t = convexTest(schema, modules);
await t.mutation(api.todoist.mutations.foo.default, {...});
```
After:
```typescript
import { ALLOWED_EMAIL } from "../../_lib/authed";
// ...
const t = convexTest(schema, modules);
await t.withIdentity({ email: ALLOWED_EMAIL }).mutation(api.todoist.mutations.foo.default, {...});
```

Re-run `bun test convex/todoist` after each test file fix. Iterate until green.

- [ ] **Step 6: Commit**

```bash
git add convex/todoist
git commit -m "feat(auth): require auth on public todoist functions"
```

---

## Task 7: Swap routines public functions

**Files:**
- Modify: `convex/routines/queries/*.ts`, `convex/routines/actions/*.ts`

- [ ] **Step 1: List the files**

Run:
```bash
grep -rln "^import.*query.*from.*_generated/server\"\|^import.*mutation.*from.*_generated/server\"\|^import.*action.*from.*_generated/server\"" convex/routines/queries convex/routines/actions
```

Expected: ~9 files.

- [ ] **Step 2: Swap each file's import and definition** (same pattern as Task 6).

- [ ] **Step 3: Typecheck + lint + test**

Run:
```bash
bun run typecheck && bun run lint && bun test convex/routines
```

Expected: PASS. Apply the `.withIdentity({ email: ALLOWED_EMAIL })` fix from Task 6 Step 5 to any failing test.

- [ ] **Step 4: Commit**

```bash
git add convex/routines
git commit -m "feat(auth): require auth on public routines functions"
```

---

## Task 8: Swap agentic public functions

**Files:**
- Modify: `convex/agentic/queries/*.ts`, `convex/agentic/mutations/*.ts`, `convex/agentic/actions/*.ts`

The agentic functions are the "LLM brain" — this task is the security-critical one.

- [ ] **Step 1: List the files**

Run:
```bash
grep -rln "^import.*query.*from.*_generated/server\"\|^import.*mutation.*from.*_generated/server\"\|^import.*action.*from.*_generated/server\"" convex/agentic/queries convex/agentic/mutations convex/agentic/actions
```

Expected: list of agentic public functions. Note: `convex/agentic/dev/seed.ts` uses `mutation` — this is dev-only seeding. Swap it to `authedMutation` as well (it should not run in production from an unauthenticated client). If you'd rather make it internal, swap to `internalMutation` instead and remove any callers from the client.

- [ ] **Step 2: Swap each file's import and definition** (same pattern as Task 6).

- [ ] **Step 3: Typecheck + lint + test**

Run:
```bash
bun run typecheck && bun run lint && bun test convex/agentic
```

Expected: PASS. Apply the `.withIdentity({ email: ALLOWED_EMAIL })` fix to any failing test.

- [ ] **Step 4: Commit**

```bash
git add convex/agentic
git commit -m "feat(auth): require auth on public agentic functions"
```

---

## Task 9: Swap dashboard public functions

**Files:**
- Modify: `convex/dashboard/queries/getDashboardStats.ts`

- [ ] **Step 1: Swap the file**

In `convex/dashboard/queries/getDashboardStats.ts`:
- Replace `import { query } from "../../_generated/server";` with `import { authedQuery } from "../../_lib/authed";`
- Replace `export const getDashboardStats = query({` with `export const getDashboardStats = authedQuery({`

- [ ] **Step 2: Typecheck + lint + test**

Run:
```bash
bun run typecheck && bun run lint && bun test convex/dashboard
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add convex/dashboard
git commit -m "feat(auth): require auth on dashboard query"
```

---

## Task 10: Full test sweep + fix any missed test files

**Files:** test files only, across the repo.

- [ ] **Step 1: Run the entire test suite**

Run:
```bash
bun test
```

Expected: PASS or only "Unauthorized" failures.

- [ ] **Step 2: For each "Unauthorized" failure, update the test**

In the failing test file, add the import:
```typescript
import { ALLOWED_EMAIL } from "../../_lib/authed";
```
(Adjust the relative path to the file's location.)

Then convert each Convex function call site:
```typescript
// before
await t.mutation(api.foo.bar.default, {...});
// after
await t.withIdentity({ email: ALLOWED_EMAIL }).mutation(api.foo.bar.default, {...});
```

Re-run `bun test` after each file. Iterate until green.

- [ ] **Step 3: Final typecheck + lint + tests**

Run:
```bash
bun run typecheck && bun run lint && bun test
```

Expected: PASS, zero failures.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "test(auth): pass ALLOWED_EMAIL identity to existing convex-test calls"
```

---

## Task 11: Frontend — `SignInScreen` component

**Files:**
- Create: `app/src/auth/SignInScreen.tsx`
- Test: `app/src/auth/SignInScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `app/src/auth/SignInScreen.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, test, vi } from "vitest"

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mockSignIn, signOut: vi.fn() }),
}))

const mockSignIn = vi.fn()

import { SignInScreen } from "./SignInScreen"

describe("SignInScreen", () => {
  test("renders the Google sign-in button", () => {
    render(<SignInScreen />)
    expect(
      screen.getByRole("button", { name: /sign in with google/i }),
    ).toBeInTheDocument()
  })

  test("clicking the button calls signIn('google')", async () => {
    mockSignIn.mockClear()
    render(<SignInScreen />)
    await userEvent.click(
      screen.getByRole("button", { name: /sign in with google/i }),
    )
    expect(mockSignIn).toHaveBeenCalledWith("google")
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
bun --cwd app test src/auth/SignInScreen.test.tsx
```

Expected: FAIL — cannot find `./SignInScreen`.

(If `app/` does not yet have a test runner config that picks up `*.test.tsx`, run from repo root: `bun test app/src/auth/SignInScreen.test.tsx` — adjust based on what `vitest.config.ts` resolves.)

- [ ] **Step 3: Implement `SignInScreen`**

Create `app/src/auth/SignInScreen.tsx`:

```tsx
import { useAuthActions } from "@convex-dev/auth/react"

import { Button } from "@/components/ui/button"

export function SignInScreen() {
  const { signIn } = useAuthActions()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            master-db
          </h1>
          <p className="text-sm text-muted-foreground">
            Personal data hub. Sign in with the owner account to continue.
          </p>
        </div>
        <Button
          className="w-full"
          onClick={() => {
            void signIn("google")
          }}
        >
          Sign in with Google
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Restricted to a single account. Other Google identities will be
          rejected.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:
```bash
bun --cwd app test src/auth/SignInScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/auth/SignInScreen.tsx app/src/auth/SignInScreen.test.tsx
git commit -m "feat(auth): add SignInScreen component"
```

---

## Task 12: Frontend — `AuthGate` component

**Files:**
- Create: `app/src/auth/AuthGate.tsx`

- [ ] **Step 1: Implement `AuthGate`**

Create `app/src/auth/AuthGate.tsx`:

```tsx
import { useConvexAuth } from "convex/react"
import type { ReactNode } from "react"

import { SignInScreen } from "./SignInScreen"

/**
 * Renders children only when the caller is authenticated. While auth is
 * still loading, renders a minimal spinner. While unauthenticated, renders
 * the sign-in screen and mounts no Convex hooks — preventing data fetches
 * from firing before the user is allowed in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <SignInScreen />
  }

  return <>{children}</>
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
bun run typecheck:app
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/src/auth/AuthGate.tsx
git commit -m "feat(auth): add AuthGate component"
```

---

## Task 13: Wire `ConvexAuthProvider` into `App.tsx`

**Files:**
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Edit `app/src/App.tsx`**

Replace the file contents with:

```tsx
import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import { ThemeProvider } from "next-themes"
import { Router } from "wouter"

import { AuthGate } from "@/auth/AuthGate"
import { AgentDrawer } from "@/components/agent/AgentDrawer"
import { DialogManager } from "@/components/dialogs/DialogManager"
import { Layout } from "@/components/layout/Layout"
import { SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { AgentDrawerProvider, useAgentDrawer } from "@/contexts/AgentDrawerContext"
import { CountProvider } from "@/contexts/CountContext"
import { DialogProvider } from "@/contexts/DialogContext"
import { HeaderSlotProvider } from "@/contexts/HeaderSlotContext"
import { OptimisticUpdatesProvider } from "@/contexts/OptimisticUpdatesContext"
import { useAgentKeybindings } from "@/hooks/useAgentKeybindings"

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string)

function AgentKeybindingsHost() {
  const { open } = useAgentDrawer()
  useAgentKeybindings({
    enabled: true,
    openForActiveTask: () => {
      void open
    },
  })
  return null
}

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ConvexAuthProvider client={convex}>
        <AuthGate>
          <Router>
            <CountProvider>
              <OptimisticUpdatesProvider>
                <AgentDrawerProvider>
                  <AgentKeybindingsHost />
                  <DialogProvider>
                    <SidebarProvider defaultOpen>
                      <HeaderSlotProvider>
                        <Layout />
                      </HeaderSlotProvider>
                      <DialogManager />
                      <AgentDrawer />
                      <Toaster />
                    </SidebarProvider>
                  </DialogProvider>
                </AgentDrawerProvider>
              </OptimisticUpdatesProvider>
            </CountProvider>
          </Router>
        </AuthGate>
      </ConvexAuthProvider>
    </ThemeProvider>
  )
}
```

Key changes:
- `ConvexProvider` → `ConvexAuthProvider` (same `client` prop).
- New `<AuthGate>` wraps the existing tree.
- Import order kept consistent with existing repo conventions.

- [ ] **Step 2: Typecheck + lint**

Run:
```bash
bun run typecheck:app && bun --cwd app run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/src/App.tsx
git commit -m "feat(auth): wire ConvexAuthProvider and AuthGate in App"
```

---

## Task 14: Google Cloud OAuth credentials + env vars

This task is partly manual (Google Cloud Console). The agent should print the exact steps and pause for confirmation.

- [ ] **Step 1: Create the OAuth client**

Manual in Google Cloud Console:

1. Open https://console.cloud.google.com/apis/credentials in a project you own.
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Web application**. Name: `master-db`.
4. Authorized redirect URIs — add BOTH:
   - `https://<your-convex-deployment>.convex.site/api/auth/callback/google`
   - `https://<your-convex-dev-deployment>.convex.site/api/auth/callback/google`
   (Convex Auth uses the Convex deployment's `.convex.site` host for OAuth callbacks, NOT the Heroku frontend URL.)
5. Save. Copy the **Client ID** and **Client secret**.

Confirm you have both values before continuing.

- [ ] **Step 2: Set Convex env vars for prod**

Run (substituting the copied values):
```bash
bunx convex env set AUTH_GOOGLE_ID "<client-id>"
bunx convex env set AUTH_GOOGLE_SECRET "<client-secret>"
bunx convex env set SITE_URL "https://<your-heroku-app>.herokuapp.com"
```

- [ ] **Step 3: Set Convex env vars for dev deployment**

Run:
```bash
bunx convex env set --dev AUTH_GOOGLE_ID "<client-id>"
bunx convex env set --dev AUTH_GOOGLE_SECRET "<client-secret>"
bunx convex env set --dev SITE_URL "http://localhost:5173"
```

- [ ] **Step 4: Verify**

Run:
```bash
bunx convex env list
bunx convex env list --dev
```

Expected: all three vars present in both environments.

- [ ] **Step 5: Note for `.env.local`**

`.env.local` does NOT need `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — those are server-side and live in the Convex env. `.env.local` should only carry `VITE_CONVEX_URL` (already there) so the Vite client knows which Convex deployment to talk to.

No commit here — secrets are not in git.

---

## Task 15: Local end-to-end verification

- [ ] **Step 1: Start the Convex dev server**

Run:
```bash
bunx convex dev
```

Expected: server starts, no errors.

- [ ] **Step 2: In a second terminal, start the Vite dev server**

Run:
```bash
bun --cwd app run dev
```

Expected: dev server on `http://localhost:5173`.

- [ ] **Step 3: Open `http://localhost:5173` in a fresh incognito window**

Expected: sign-in screen renders with "Sign in with Google" button. No app UI behind it. Browser Network panel shows no `query` / `mutation` WebSocket calls firing.

- [ ] **Step 4: Click "Sign in with Google", complete the flow as `milad@afternoonumbrellafriends.com`**

Expected: redirected back to `localhost:5173`, app loads, existing views render, queries succeed.

- [ ] **Step 5: Open a different browser / different Google account, complete sign-in flow**

Expected: page lands back on `/` but `useConvexAuth()` reports unauthenticated → sign-in screen re-renders. Convex `users` table contains zero new rows from this attempt (verify in the Convex dashboard).

- [ ] **Step 6: Sign out (use the Convex Auth `signOut()` call)**

For this verification, you can run in the browser console:
```js
// In the browser console, with the app loaded as the authorized user
window.__authActions?.signOut?.()
```
or wire a temporary sign-out button on `Layout` while testing. (A proper sign-out UI is intentionally out of scope for this plan — add it as a follow-up.)

Expected: sign-in screen returns.

- [ ] **Step 7: Stop both dev servers, run full validation one more time**

Run:
```bash
bun run typecheck && bun run lint && bun test
```

Expected: PASS.

No commit needed for this task.

---

## Task 16: Deploy to Heroku and verify production

- [ ] **Step 1: Push the branch and deploy Convex**

Run:
```bash
bunx convex deploy
```

Expected: deploy completes; schema migration runs (adds auth tables to prod).

- [ ] **Step 2: Push the frontend to Heroku**

Run:
```bash
git push heroku <current-branch>:main
```

(Adjust remote name and target branch to match your Heroku setup. If the branch is already `main`, use `git push heroku main`.)

Expected: Heroku build completes, app deploys.

- [ ] **Step 3: Open the Heroku URL in a fresh incognito window**

Expected: sign-in screen. No data hooks fire.

- [ ] **Step 4: Sign in as `milad@afternoonumbrellafriends.com`**

Expected: app loads, all existing views work end-to-end.

- [ ] **Step 5: Verify the Todoist webhook still functions**

Trigger a small change in Todoist (e.g., complete a task). Watch the Convex dashboard logs for the webhook to arrive and process successfully. This confirms the unauthenticated webhook path was not accidentally locked down.

- [ ] **Step 6: Verify crons**

In the Convex dashboard, observe the next scheduled cron run completes successfully. (Crons call internal functions, which are not affected by the wrapper swap — this is a sanity check.)

- [ ] **Step 7: Merge to main**

If everything works:
```bash
git checkout main
git merge <branch>
git push origin main
```

---

## Validation Loop (run after each backend task)

```bash
bun run typecheck && bun run lint && bun test
```

All three must pass with zero errors before committing the task.

## Notes for the engineer

- **Heroku build secrets:** none. All auth secrets live in Convex env, not the Vite bundle.
- **`bunx convex dev` may auto-restart between tasks** — that's expected and desired (regenerates types).
- **If the wrapper breaks an existing test with "Unauthorized":** that test was calling a function that's now correctly auth-gated. Add `.withIdentity({ email: ALLOWED_EMAIL })`. Do NOT bypass by reverting the wrapper.
- **If `bunx convex dev --once` complains about schema validators on auth tables:** ensure `@convex-dev/auth` and `@auth/core` versions are compatible — pin to whatever versions Bun resolved in Task 1.
- **The `convex/auth.config.ts` file is read at deploy time** to register the JWT issuer — do not delete it.
