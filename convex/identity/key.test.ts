import { afterEach, describe, expect, test } from "vitest";

import { requireIdentityKey } from "./key";

describe("requireIdentityKey", () => {
  afterEach(() => {
    delete process.env.IMSG_IDENTITY_KEY;
  });

  test("fails closed: throws when IMSG_IDENTITY_KEY is unset, regardless of what's provided", () => {
    delete process.env.IMSG_IDENTITY_KEY;
    expect(() => requireIdentityKey("anything")).toThrow(
      "IMSG_IDENTITY_KEY not configured on this deployment",
    );
  });

  test("throws when the provided key doesn't match", () => {
    process.env.IMSG_IDENTITY_KEY = "correct-key";
    expect(() => requireIdentityKey("wrong-key")).toThrow();
  });

  test("succeeds when the provided key matches", () => {
    process.env.IMSG_IDENTITY_KEY = "correct-key";
    expect(() => requireIdentityKey("correct-key")).not.toThrow();
  });
});
