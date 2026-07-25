import { describe, expect, test } from "bun:test";
import {
  requireConvexUrl,
  requireIdentityKey,
  validateConvexUrl,
  validateIdentityKey,
} from "./public-env";

describe("Convex public URL validation", () => {
  test("accepts absolute HTTP and HTTPS URLs", () => {
    expect(validateConvexUrl("https://example.convex.cloud")).toEqual({
      ok: true,
      value: "https://example.convex.cloud",
    });
    expect(validateConvexUrl("http://localhost:3210")).toEqual({
      ok: true,
      value: "http://localhost:3210",
    });
  });

  test("rejects missing and relative URLs before Convex initializes", () => {
    expect(validateConvexUrl(undefined)).toEqual({
      ok: false,
      error: "EXPO_PUBLIC_CONVEX_URL is required",
    });
    expect(validateConvexUrl("/convex")).toEqual({
      ok: false,
      error: "EXPO_PUBLIC_CONVEX_URL must be an absolute HTTP(S) URL",
    });
    expect(() => requireConvexUrl("")).toThrow("EXPO_PUBLIC_CONVEX_URL is required");
  });

  test("rejects non-HTTP URL schemes", () => {
    expect(validateConvexUrl("file:///tmp/convex")).toEqual({
      ok: false,
      error: "EXPO_PUBLIC_CONVEX_URL must be an absolute HTTP(S) URL",
    });
  });

  test("requires the identity key embedded in the client", () => {
    expect(validateIdentityKey("identity-key")).toEqual({
      ok: true,
      value: "identity-key",
    });
    expect(validateIdentityKey("  ")).toEqual({
      ok: false,
      error: "EXPO_PUBLIC_IMSG_IDENTITY_KEY is required",
    });
    expect(() => requireIdentityKey(undefined)).toThrow(
      "EXPO_PUBLIC_IMSG_IDENTITY_KEY is required",
    );
  });
});
