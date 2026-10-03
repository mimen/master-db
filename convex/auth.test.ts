import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";

import { internalAction } from "./_generated/server";
import { ALLOWED_EMAIL } from "./_lib/authed";
import { allowedRedirect, authorizeTailnet, rejectIfNotAllowed } from "./auth";
import schema from "./schema";

const previousSecret = process.env.COMMA_BRIDGE_SECRET;
afterEach(() => {
  if (previousSecret === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previousSecret;
});

const modules = {
  "./_generated/api.js": () => import("./_generated/api.js"),
  "./_generated/server.js": () => import("./_generated/server.js"),
  "./auth.ts": () => import("./auth"),
  "./tailnetTest.ts": async () => ({
    authorize: internalAction({
      args: { secret: v.optional(v.string()) },
      handler: (ctx, args) => authorizeTailnet(args, ctx),
    }),
  }),
};
const authorize = makeFunctionReference<
  "action", { secret?: string }, Awaited<ReturnType<typeof authorizeTailnet>>
>("tailnetTest:authorize");

describe("allowedRedirect", () => {
  test.each([
    "http://localhost:3000",
    "http://localhost:3000/settings",
    "https://convex-db-master-d31d50f579b2.herokuapp.com?tab=settings",
    "https://milads-mac-mini.taild31e9a.ts.net:8447",
  ])("accepts %s", (redirectTo) => {
    expect(allowedRedirect(redirectTo)).toBe(redirectTo);
  });

  test.each([
    "http://127.0.0.1:54321",
    "http://127.0.0.1:54321/",
    "http://127.0.0.1:80?code=abc",
    "http://127.0.0.1:65535/?code=abc",
    "exp://192.168.1.5:8081/--/auth",
    "exp://milads-mac-mini.taild31e9a.ts.net:8081/--/settings?code=abc",
    "http://127.0.0.1:54321/settings",
    "http://127.0.0.1.evil.com:54321",
    "http://user@127.0.0.1:5",
    "http://user:pass@127.0.0.1:5",
    "https://127.0.0.1:54321",
    "http://localhost:54321",
    "http://127.0.0.1:54321/#code=abc",
    "http://127.0.0.1:65536",
    "exp://host:8081/other",
    "exp://host:8081/--",
    "exp://user@host:8081/--/auth",
    "exp://user:pass@host:8081/--/auth",
    "imsg://x",
    "https://milads-mac-mini.taild31e9a.ts.net:8447.evil.com",
    "not a URL",
  ])("rejects %s", (redirectTo) => {
    expect(() => allowedRedirect(redirectTo)).toThrow(/Disallowed redirectTo/);
  });
});

describe("authorizeTailnet", () => {
  test("links the tailnet account to the existing Google user and reuses it", async () => {
    process.env.COMMA_BRIDGE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: ALLOWED_EMAIL, emailVerificationTime: 1,
      });
      await ctx.db.insert("authAccounts", {
        userId, provider: "google", providerAccountId: "google-user",
      });
      return userId;
    });
    expect(await t.action(authorize, { secret: "correct-secret" })).toEqual({ userId });
    expect(await t.action(authorize, { secret: "correct-secret" })).toEqual({ userId });
    const result = await t.run(async (ctx) => ({
      users: await ctx.db.query("users").collect(),
      accounts: await ctx.db.query("authAccounts").collect(),
    }));
    expect(result.users).toHaveLength(1);
    expect(result.accounts.map((account) => account.provider)).toEqual(["google", "tailnet"]);
    expect(result.accounts[1].providerAccountId).toBe(ALLOWED_EMAIL);
  });

  test("creates the allowed user when no account exists", async () => {
    process.env.COMMA_BRIDGE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const result = await t.action(authorize, { secret: "correct-secret" });
    const user = await t.run((ctx) => result ? ctx.db.get(result.userId) : Promise.resolve(null));
    expect(user?.email).toBe("milad@afternoonumbrellafriends.com");
  });

  test.each(["wrong-secret", "", undefined])("rejects %s without creating an account", async (secret) => {
    process.env.COMMA_BRIDGE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    expect(await t.action(authorize, secret === undefined ? {} : { secret })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("authAccounts").collect())).toEqual([]);
  });

  test("fails closed when the environment secret is unset or empty", async () => {
    const t = convexTest(schema, modules);
    delete process.env.COMMA_BRIDGE_SECRET;
    expect(await t.action(authorize, { secret: "correct-secret" })).toBeNull();
    process.env.COMMA_BRIDGE_SECRET = "";
    expect(await t.action(authorize, { secret: "" })).toBeNull();
  });
});

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
