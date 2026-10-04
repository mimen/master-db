import { expect, test } from "bun:test";
import { fixtureCommandWatch } from "./fixture-command-watch";

test("fixture commands can observe a terminal result and unsubscribe", async () => {
  let notify!: () => void;
  const notified = new Promise<void>((resolve) => { notify = resolve; });
  const watch = fixtureCommandWatch(async () => ({ status: "sent", result: { kind: "react", ok: true } }));
  expect(watch.localQueryResult()).toBeUndefined();
  const unsubscribe = watch.onUpdate(notify);
  await notified;
  expect(watch.localQueryResult()).toMatchObject({ status: "sent", result: { kind: "react", ok: true } });
  unsubscribe();
});

test("fixture watch failures propagate through localQueryResult", async () => {
  let notify!: () => void;
  const notified = new Promise<void>((resolve) => { notify = resolve; });
  const watch = fixtureCommandWatch(async () => { throw new Error("offline"); });
  const unsubscribe = watch.onUpdate(notify);
  await notified;
  expect(() => watch.localQueryResult()).toThrow("offline");
  unsubscribe();
});
