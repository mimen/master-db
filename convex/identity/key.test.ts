import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";

import { ALLOWED_EMAIL } from "../_lib/authed";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { listTagsRef } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

afterEach(() => {
  delete process.env.IMSG_IDENTITY_KEY;
  delete process.env.IMSG_SERVER_SECRET;
});

describe("identity access", () => {
  test("the server secret opens the identity functions without a session", async () => {
    process.env.IMSG_SERVER_SECRET = "server-secret";
    const t = convexTest(schema, modules);
    expect(await t.query(listTagsRef, { key: "server-secret" })).toEqual([]);
  });

  test("the retired shared key works only while it is still set", async () => {
    const t = convexTest(schema, modules);
    process.env.IMSG_IDENTITY_KEY = "bundled-key";
    expect(await t.query(listTagsRef, { key: "bundled-key" })).toEqual([]);
    delete process.env.IMSG_IDENTITY_KEY;
    await expect(t.query(listTagsRef, { key: "bundled-key" })).rejects.toThrow("Unauthorized");
  });

  test("a wrong key or no key falls through to the signed-in check", async () => {
    process.env.IMSG_SERVER_SECRET = "server-secret";
    const t = convexTest(schema, modules);
    await expect(t.query(listTagsRef, { key: "wrong" })).rejects.toThrow("Unauthorized");
    await expect(t.query(listTagsRef, {})).rejects.toThrow("Unauthorized");
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: ALLOWED_EMAIL }));
    const signedIn = t.withIdentity({ subject: `${userId}|session` });
    expect(await signedIn.query(listTagsRef, {})).toEqual([]);
  });

  test("an unset secret never matches an empty key", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(listTagsRef, { key: "" })).rejects.toThrow("Unauthorized");
  });
});
