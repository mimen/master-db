import { expect, test } from "bun:test";
import { FakeIngest } from "./fake-ingest";

test("fake ingest records calls and simulates failures", async () => {
  const ingest = new FakeIngest();
  expect(await ingest.post("sync", { key: "test", cursor: "1" })).toBeNull();
  expect(ingest.calls).toEqual([{ kind: "sync", body: { key: "test", cursor: "1" } }]);
  ingest.fail = "sync";
  await expect(ingest.post("sync", { key: "test" })).rejects.toThrow("offline");
});
