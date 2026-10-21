import { expect, test } from "bun:test";

import { createDelayedStatus, type ShownStatus } from "./delayed-status";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a status shows only after 400 ms, then stays at least 400 ms after it clears", async () => {
  const shown: (ShownStatus<string> | null)[] = [];
  const status = createDelayedStatus<string>((value) => shown.push(value));
  status.update("turn", "working");
  await wait(300);
  expect(shown).toEqual([]);
  await wait(150);
  expect(shown).toEqual([{ key: "turn", value: "working" }]);
  status.update("turn", null);
  expect(shown).toHaveLength(1);
  await wait(450);
  expect(shown.at(-1)).toBeNull();
  status.dispose();
});

test("a status that clears inside the delay never shows", async () => {
  const shown: (ShownStatus<string> | null)[] = [];
  const status = createDelayedStatus<string>((value) => shown.push(value));
  status.update("turn", "working");
  await wait(100);
  status.update("turn", null);
  await wait(450);
  expect(shown).toEqual([]);
  status.dispose();
});
