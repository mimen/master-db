import { afterEach, beforeEach, expect, test } from "bun:test";
import type { TodayView } from "../../../../convex/schema/comma/validators";
import { createApp } from "../../server/app";
import type { Config } from "../../server/config";
import { OverlayDb } from "../../server/db";
import { registerConvexFixture } from "./convex";
import { FixtureBlueBubbles } from "./fake-bluebubbles";
import { CHAT_GUIDS, FIXTURE_NOW, FixtureIdentity, TODAY_SEED, fixtureSeed } from "./world";

const config: Config = {
  bbUrl: "fixture://bluebubbles", bbPassword: "fixture", hostname: "127.0.0.1", port: 0,
  dbPath: ":memory:", convexSiteUrl: null, appleContactsIngestSecret: null,
  convexCloudUrl: null, identityKey: null, commaBridgeSecret: null,
  whisper: { binaryPath: null, modelPath: null, workDir: "/tmp/imsg-fixture-test" },
  ai: { gatewayUrl: "http://127.0.0.1:9", gatewayKey: "", fastModel: "fixture", vaultPath: "/tmp" },
};
let fixture: Awaited<ReturnType<typeof createApp>>;
let reset: () => void;
beforeEach(async () => {
  const bb = new FixtureBlueBubbles(fixtureSeed());
  const db = new OverlayDb(":memory:");
  const identity = new FixtureIdentity();
  fixture = await createApp({
    config, bb, db, now: () => FIXTURE_NOW, names: identity, identity, backgroundServices: false,
    configureFixtureRoutes: (app, controls) => { reset = registerConvexFixture(app, controls, bb, db, identity); },
  });
});
afterEach(() => fixture.dispose());

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fixture.app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
const call = <T>(name: string, args: Record<string, unknown> = {}) => post<T>("/__fixture/convex", { name, args });
const get = () => call<TodayView | null>("comma/today:get", { day: "2026-10-27" });

test("serves the seeded queue for any day, with a settle in the clear log", async () => {
  const seeded = await get();
  expect(seeded?.day).toBe("2026-10-27");
  expect(seeded?.queue?.items[0]).toMatchObject({ conversationId: CHAT_GUIDS.needs, rank: 1, group: "friday" });
  expect(seeded?.queue?.openAtSnapshot).not.toContain(CHAT_GUIDS.waiting);
  expect(seeded?.queue?.snapshotAt).toBe(TODAY_SEED.snapshotAt);
  expect(seeded?.cleared).toEqual([]);

  await call("comma/outbox:enqueue", { clientKey: "settle-alex", conversationId: CHAT_GUIDS.needs, payload: { kind: "settle", messageGuid: "needs-2" } });
  expect((await get())?.cleared).toEqual([{ conversationId: CHAT_GUIDS.needs, at: FIXTURE_NOW }]);
});

test("Regenerate is building first, then ranks the open conversations, and a second press is a no-op", async () => {
  const building = await call<{ status: string; attempt: number }>("comma/today:requestBuild", { day: "2026-10-27", dayStart: 0 });
  expect(building).toMatchObject({ status: "building", attempt: 2 });
  expect(await call("comma/today:requestBuild", { day: "2026-10-27", dayStart: 0 })).toMatchObject({ status: "building", attempt: 2 });
  expect((await get())?.queue?.snapshotAt).toBe(TODAY_SEED.snapshotAt);
  await Bun.sleep(2_700);
  const built = await get();
  expect(built?.run).toMatchObject({ status: "done", attempt: 2 });
  expect(built?.queue?.snapshotAt).toBeGreaterThan(TODAY_SEED.snapshotAt);
  expect(built?.queue?.items.map((item) => item.conversationId)).toContain(CHAT_GUIDS.unreadGroup);
  expect(built?.queue?.items.map((item) => item.rank)).toEqual(built?.queue?.items.map((_, index) => index + 1));
});

test("the mode route drives unbuilt and failed, and reset restores the seed", async () => {
  await post("/__fixture/today", { mode: "unbuilt" });
  expect(await get()).toBeNull();
  await post("/__fixture/today", { mode: "failed" });
  expect(await get()).toMatchObject({ run: { status: "failed", error: "The gateway timed out" }, queue: null });
  reset();
  expect((await get())?.run.status).toBe("done");
});
