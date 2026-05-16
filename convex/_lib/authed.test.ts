import { describe, expect, test, vi } from "vitest";

import { ALLOWED_EMAIL, assertAllowed, userIdFromSubject } from "./authed";

type MockUser = { email: string } | null;

function makeQueryCtx(opts: {
  identity?: { subject: string } | null;
  userInDb?: MockUser;
}) {
  return {
    auth: {
      getUserIdentity: async () =>
        opts.identity === undefined ? null : opts.identity,
    },
    db: {
      get: vi.fn().mockResolvedValue(opts.userInDb ?? null),
    },
  } as unknown as Parameters<typeof assertAllowed>[0];
}

function makeActionCtx(opts: {
  identity?: { subject: string } | null;
  emailFromQuery?: string | null;
}) {
  return {
    auth: {
      getUserIdentity: async () =>
        opts.identity === undefined ? null : opts.identity,
    },
    runQuery: vi.fn().mockResolvedValue(opts.emailFromQuery ?? null),
  } as unknown as Parameters<typeof assertAllowed>[0];
}

describe("ALLOWED_EMAIL", () => {
  test("is the single whitelisted address", () => {
    expect(ALLOWED_EMAIL).toBe("milad@afternoonumbrellafriends.com");
  });
});

describe("userIdFromSubject", () => {
  test("splits ConvexAuth subject of form <userId>|<sessionId>", () => {
    expect(userIdFromSubject("usrabc|sess123")).toBe("usrabc");
  });

  test("returns subject as-is when no pipe present", () => {
    expect(userIdFromSubject("usrabc")).toBe("usrabc");
  });
});

describe("assertAllowed — query/mutation context (uses ctx.db)", () => {
  test("throws Unauthorized when no identity is present", async () => {
    await expect(assertAllowed(makeQueryCtx({ identity: null }))).rejects.toThrow(/Unauthorized/);
  });

  test("throws Unauthorized when user row is missing", async () => {
    await expect(
      assertAllowed(makeQueryCtx({ identity: { subject: "u1|s1" }, userInDb: null })),
    ).rejects.toThrow(/Unauthorized/);
  });

  test("throws Unauthorized when user email does not match", async () => {
    await expect(
      assertAllowed(
        makeQueryCtx({
          identity: { subject: "u1|s1" },
          userInDb: { email: "intruder@example.com" },
        }),
      ),
    ).rejects.toThrow(/Unauthorized/);
  });

  test("resolves when user.email matches ALLOWED_EMAIL", async () => {
    await expect(
      assertAllowed(
        makeQueryCtx({
          identity: { subject: "u1|s1" },
          userInDb: { email: ALLOWED_EMAIL },
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("assertAllowed — action context (uses ctx.runQuery)", () => {
  test("throws Unauthorized when no identity is present", async () => {
    await expect(assertAllowed(makeActionCtx({ identity: null }))).rejects.toThrow(/Unauthorized/);
  });

  test("throws Unauthorized when runQuery returns no email", async () => {
    await expect(
      assertAllowed(
        makeActionCtx({ identity: { subject: "u1|s1" }, emailFromQuery: null }),
      ),
    ).rejects.toThrow(/Unauthorized/);
  });

  test("resolves when runQuery returns ALLOWED_EMAIL", async () => {
    await expect(
      assertAllowed(
        makeActionCtx({ identity: { subject: "u1|s1" }, emailFromQuery: ALLOWED_EMAIL }),
      ),
    ).resolves.toBeUndefined();
  });
});
