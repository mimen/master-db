import { describe, expect, test, vi } from "vitest";

import { deliverWebhook } from "./deliver";

describe("deliverWebhook", () => {
  test("posts JSON with optional bearer token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await deliverWebhook(
      { url: "https://example.com/wh", token: "tok", body: { a: 1 } },
      { fetch: fetchFn, retries: 0, backoffMs: 0 },
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://example.com/wh");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  test("retries on 500 then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    const result = await deliverWebhook(
      { url: "https://example.com", token: null, body: {} },
      { fetch: fetchFn, retries: 3, backoffMs: 0 },
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.delivered).toBe(true);
  });

  test("gives up after retries", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const result = await deliverWebhook(
      { url: "https://example.com", token: null, body: {} },
      { fetch: fetchFn, retries: 2, backoffMs: 0 },
    );
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.delivered).toBe(false);
  });
});
