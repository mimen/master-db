import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { FakeIngest, ROUTED_KINDS } from "./fake-ingest";

test("fake ingest records calls and simulates failures", async () => {
  const ingest = new FakeIngest();
  expect(await ingest.post("sync", { key: "test", cursor: "1" })).toBeNull();
  expect(ingest.calls).toEqual([{ kind: "sync", body: { key: "test", cursor: "1" } }]);
  ingest.fail = "sync";
  await expect(ingest.post("sync", { key: "test" })).rejects.toThrow("offline");
});

test("fake ingest answers only the kinds Convex routes, as production does", async () => {
  expect(ROUTED_KINDS.has("account")).toBe(true);
  expect(ROUTED_KINDS.size).toBeGreaterThan(30);
  const ingest = new FakeIngest();
  await expect(ingest.post("notARoute" as "sync", { key: "test" })).rejects.toThrow("Comma ingest notARoute HTTP 404");
});

test("every kind the Mini's processes post to /comma/ingest is in the Convex ROUTES table", () => {
  const server = join(import.meta.dir, "..");
  const posted = new Set(readdirSync(server, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
    .flatMap((path) => [...readFileSync(join(server, path), "utf8")
      .matchAll(/\b(?:ingest|base|port)\.(?:post|request)(?:<[^>]*>)?\(\s*"(\w+)"/g)].map((match) => match[1]!)));
  for (const kind of ["account", "conversations", "messages", "claim", "agentClaim", "todayClaim"]) expect(posted).toContain(kind);
  expect([...posted].filter((kind) => !ROUTED_KINDS.has(kind))).toEqual([]);
});
