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
