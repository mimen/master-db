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
