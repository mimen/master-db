import { afterEach, describe, expect, test } from "bun:test";

import { BlueBubblesClient } from "./bluebubbles";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("BlueBubblesClient transport recovery", () => {
  test("retries a dropped pooled connection with a fresh connection", async () => {
    const calls: RequestInit[] = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {});
      if (calls.length === 1) throw new Error("The socket connection was closed unexpectedly");
      return new Response(JSON.stringify({ status: 200, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = new BlueBubblesClient("http://127.0.0.1:1234", "test-password");
    const result = await client.queryChats();

    expect(result).toEqual({ ok: true, value: [] });
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[1]?.headers).get("Connection")).toBe("close");
  });

  test("does not retry a mutating request after an ambiguous transport failure", async () => {
    let calls = 0;
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      calls += 1;
      throw new Error("The socket connection was closed unexpectedly");
    }) as unknown as typeof fetch;

    const client = new BlueBubblesClient("http://127.0.0.1:1234", "test-password");
    await expect(client.sendText("chat-guid", "hello")).rejects.toThrow(
      "The socket connection was closed unexpectedly",
    );
    expect(calls).toBe(1);
  });
});
