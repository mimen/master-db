import { afterEach, describe, expect, test } from "vitest";

import { checkBridgeAuth } from "./bridgeAuth";

const previousSecret = process.env.COMMA_BRIDGE_SECRET;
afterEach(() => {
  if (previousSecret === undefined) delete process.env.COMMA_BRIDGE_SECRET;
  else process.env.COMMA_BRIDGE_SECRET = previousSecret;
});

function request(authorization?: string): Request {
  return new Request("https://example.convex.site/comma/ingest/messages", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("bridge secret", () => {
  test("fails closed when unconfigured", () => {
    delete process.env.COMMA_BRIDGE_SECRET;
    expect(checkBridgeAuth(request("Bearer correct"))?.status).toBe(500);
  });

  test("accepts only the exact bearer value", () => {
    process.env.COMMA_BRIDGE_SECRET = "abcdef0123456789";
    expect(checkBridgeAuth(request("Bearer abcdef0123456789"))).toBeNull();
    for (const header of [
      undefined,
      "abcdef0123456789",
      "bearer abcdef0123456789",
      "Bearer abcdef0123456788",
      "Bearer abcdef01234567890",
      "Bearer abcdef012345678",
      "Bearer ",
    ]) {
      expect(checkBridgeAuth(request(header))?.status).toBe(401);
    }
  });
});
