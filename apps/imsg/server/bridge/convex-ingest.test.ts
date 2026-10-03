import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { ConvexIngest } from "./convex-ingest";

const client = new ConvexIngest({ convexSiteUrl: "https://test.convex.site", commaBridgeSecret: "secret" });
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let sleepSpy: ReturnType<typeof spyOn<typeof Bun, "sleep">>;
beforeEach(() => { fetchSpy = spyOn(globalThis, "fetch"); sleepSpy = spyOn(Bun, "sleep"); });
afterEach(() => { fetchSpy.mockRestore(); sleepSpy.mockRestore(); });

function success() { return Response.json({ ok: true, result: null }); }

test("posts the exact args with bearer auth", async () => {
  fetchSpy.mockResolvedValueOnce(success());
  expect(await client.post("sync", { key: "backfill", cursor: "100" })).toBeNull();
  expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://test.convex.site/comma/ingest/sync");
  expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
    body: '{"key":"backfill","cursor":"100"}',
  });
});

test("retries 5xx with exponential backoff", async () => {
  sleepSpy.mockResolvedValue(undefined);
  fetchSpy.mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response("unavailable", { status: 500 }))
    .mockResolvedValueOnce(success());
  await client.post("sync", { key: "backfill" });
  expect(fetchSpy).toHaveBeenCalledTimes(3);
  expect(sleepSpy.mock.calls.map(([delay]) => delay)).toEqual([250, 500]);
});

test("retries network errors", async () => {
  sleepSpy.mockResolvedValue(undefined);
  fetchSpy.mockRejectedValueOnce(new Error("socket closed")).mockResolvedValueOnce(success());
  await client.post("sync", { key: "backfill" });
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test("does not retry 4xx and logs the response body", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    fetchSpy.mockResolvedValueOnce(new Response("invalid message", { status: 400 }));
    await expect(client.post("sync", { key: "backfill" })).rejects.toThrow("HTTP 400");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Comma ingest sync HTTP 400: invalid message");
  } finally { log.mockRestore(); }
});

test("stops after five network attempts", async () => {
  sleepSpy.mockResolvedValue(undefined);
  fetchSpy.mockRejectedValue(new Error("offline"));
  await expect(client.post("sync", { key: "backfill" })).rejects.toThrow("offline");
  expect(fetchSpy).toHaveBeenCalledTimes(5);
});

test("disabled bridge makes no request", async () => {
  await expect(new ConvexIngest({ convexSiteUrl: null, commaBridgeSecret: null })
    .post("sync", { key: "backfill" })).rejects.toThrow("disabled");
  expect(fetchSpy).not.toHaveBeenCalled();
});
