import { expect, test } from "bun:test";
import { takeBootToken } from "./boot-handoff";
import { fetchAccessToken } from "./convex-token";

for (const forceRefreshToken of [false, true]) {
  test(`fetches the Mini session token, forced=${forceRefreshToken}`, async () => {
    const urls: string[] = [];
    const fetcher = Object.assign(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ token: "access-token" });
    }, { preconnect: fetch.preconnect });
    expect(await fetchAccessToken("http://localhost:8399", { forceRefreshToken }, fetcher)).toBe("access-token");
    expect(urls).toEqual([`http://localhost:8399/api/convex-token${forceRefreshToken ? "?refresh=1" : ""}`]);
  });
}

for (const response of [
  () => Response.json({ error: "unavailable" }, { status: 503 }),
  () => Response.json({ token: 7 }),
  () => Response.json(null),
  () => new Response("not json"),
  () => { throw new Error("offline"); },
]) {
  test("token failure returns null without exposing an error or credentials", async () => {
    let calls = 0;
    const fetcher = Object.assign(async () => { calls++; return response(); }, { preconnect: fetch.preconnect });
    expect(await fetchAccessToken("", { forceRefreshToken: false }, fetcher, async () => {})).toBeNull();
    expect(calls).toBe(5);
  });
}

test("a Mini blip is retried instead of signing the client out", async () => {
  const replies = [503, 503, 200];
  const waits: number[] = [];
  const fetcher = Object.assign(async () => {
    const status = replies.shift()!;
    return status === 200 ? Response.json({ token: "access-token" }) : Response.json({ error: "unavailable" }, { status });
  }, { preconnect: fetch.preconnect });
  expect(await fetchAccessToken("", { forceRefreshToken: false }, fetcher, async (ms) => { waits.push(ms); })).toBe("access-token");
  expect(waits).toEqual([250, 750]);
});

function countingFetcher() {
  const urls: string[] = [];
  const fetcher = Object.assign(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json({ token: "fresh-token" });
  }, { preconnect: fetch.preconnect });
  return { urls, fetcher };
}

test("the boot request answers the first token call and is consumed once", async () => {
  const boot = { token: Promise.resolve(Response.json({ token: "boot-token" })) };
  const { urls, fetcher } = countingFetcher();
  const take = () => takeBootToken(boot);
  expect(await fetchAccessToken("", { forceRefreshToken: false }, fetcher, async () => {}, take)).toBe("boot-token");
  expect(urls).toEqual([]);
  expect(await fetchAccessToken("", { forceRefreshToken: false }, fetcher, async () => {}, take)).toBe("fresh-token");
  expect(urls).toEqual(["/api/convex-token"]);
});

test("a forced refresh never uses the boot request", async () => {
  const boot = { token: Promise.resolve(Response.json({ token: "boot-token" })) };
  const { urls, fetcher } = countingFetcher();
  expect(await fetchAccessToken("", { forceRefreshToken: true }, fetcher, async () => {}, () => takeBootToken(boot)))
    .toBe("fresh-token");
  expect(urls).toEqual(["/api/convex-token?refresh=1"]);
});

for (const failed of [
  () => Promise.resolve(Response.json({ error: "unavailable" }, { status: 503 })),
  () => Promise.reject(new Error("offline")),
]) {
  test("a failed boot request falls back to the retried fetch", async () => {
    const replies = [503, 200];
    const waits: number[] = [];
    const fetcher = Object.assign(async () => {
      const status = replies.shift()!;
      return status === 200 ? Response.json({ token: "late-token" }) : Response.json({}, { status });
    }, { preconnect: fetch.preconnect });
    expect(await fetchAccessToken("", { forceRefreshToken: false }, fetcher, async (ms) => { waits.push(ms); }, failed))
      .toBe("late-token");
    expect(waits).toEqual([250]);
  });
}
