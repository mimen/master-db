import { describe, expect, test } from "bun:test";

import { oauthCallbackCode } from "./oauth-callback";

describe("oauthCallbackCode", () => {
  test("extracts and decodes the code from an Expo Go redirect", () => {
    expect(oauthCallbackCode("exp://192.168.1.5:8081/--/settings?code=a%2Bb%26c%3Dd"))
      .toBe("a+b&c=d");
  });

  test("returns null for absent or empty codes", () => {
    expect(oauthCallbackCode("exp://host:8081/--/settings?error=access_denied")).toBeNull();
    expect(oauthCallbackCode("exp://host:8081/--/settings?code=")).toBeNull();
  });

  test("does not accept a code in the fragment", () => {
    expect(oauthCallbackCode("exp://host:8081/--/settings#code=abc")).toBeNull();
  });

  test("throws for malformed URLs so the caller can show a failure", () => {
    expect(() => oauthCallbackCode("not a URL")).toThrow();
  });
});
