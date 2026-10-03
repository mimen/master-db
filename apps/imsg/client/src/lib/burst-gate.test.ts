import { expect, test } from "bun:test";
import { burstGate } from "./burst-gate";

test("fires once per burst and again after a quiet gap", () => {
  let clock = 1_000;
  const gate = burstGate(5_000, () => clock);
  const fired: boolean[] = [];
  for (const at of [1_000, 1_200, 3_000, 7_900, 13_000, 13_100]) {
    clock = at;
    fired.push(gate());
  }
  expect(fired).toEqual([true, false, false, false, true, false]);
});
