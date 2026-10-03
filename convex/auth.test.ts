import { describe, expect, test } from "vitest";

import { ALLOWED_EMAIL } from "./_lib/authed";
import { allowedRedirect, rejectIfNotAllowed } from "./auth";

describe("allowedRedirect", () => {
  test.each([
    "http://localhost:3000",
    "http://localhost:3000/settings",
    "https://convex-db-master-d31d50f579b2.herokuapp.com?tab=settings",
    "https://milads-mac-mini.taild31e9a.ts.net:8447",
    "http://127.0.0.1:54321",
    "http://127.0.0.1:54321/",
    "http://127.0.0.1:80?code=abc",
    "http://127.0.0.1:65535/?code=abc",
    "exp://192.168.1.5:8081/--/auth",
    "exp://milads-mac-mini.taild31e9a.ts.net:8081/--/settings?code=abc",
  ])("accepts %s", (redirectTo) => {
    expect(allowedRedirect(redirectTo)).toBe(redirectTo);
  });

  test.each([
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
