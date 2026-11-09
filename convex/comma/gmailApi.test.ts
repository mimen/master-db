import { afterEach, describe, expect, it, vi } from "vitest";

import { googleApi, GoogleApiError } from "./gmailApi";

const answer = (status: number, body: unknown) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
async function failure(): Promise<GoogleApiError> {
  try {
    await googleApi("https://gmail.googleapis.com/x");
  } catch (error) {
    if (error instanceof GoogleApiError) return error;
  }
  throw new Error("expected a GoogleApiError");
}

afterEach(() => vi.restoreAllMocks());

describe("GoogleApiError.rateLimited", () => {
  it("treats Gmail's per-user 403 as a rate limit", async () => {
    answer(403, { error: { code: 403, status: "PERMISSION_DENIED", errors: [{ reason: "userRateLimitExceeded" }] } });
    const error = await failure();
    expect(error.reason).toBe("userRateLimitExceeded");
    expect(error.rateLimited).toBe(true);
    expect(error.message).toContain("userRateLimitExceeded");
  });

  it("treats 429 and RESOURCE_EXHAUSTED as rate limits", async () => {
    answer(429, { error: { status: "RESOURCE_EXHAUSTED" } });
    expect((await failure()).rateLimited).toBe(true);
  });

  it("keeps a real permission denial fatal", async () => {
    answer(403, { error: { status: "PERMISSION_DENIED", errors: [{ reason: "insufficientPermissions" }] } });
    expect((await failure()).rateLimited).toBe(false);
  });

  it("reads OAuth's string error", async () => {
    answer(400, { error: "invalid_grant" });
    const error = await failure();
    expect(error.code).toBe("invalid_grant");
    expect(error.rateLimited).toBe(false);
  });
});
