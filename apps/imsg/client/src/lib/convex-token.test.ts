import { expect, test } from "bun:test";
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
    const fetcher = Object.assign(async () => response(), { preconnect: fetch.preconnect });
    expect(await fetchAccessToken("", { forceRefreshToken: false }, fetcher)).toBeNull();
  });
}
