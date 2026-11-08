import { expect, test } from "bun:test";
import { OverlayDb } from "../db";
import { PRECOMPUTE_DAILY_CAP, PrecomputeBudget } from "./suggestions";

const DAY = 86_400_000;

test("the precompute budget spends up to the daily cap, survives a restart, and resets the next day", () => {
  const db = new OverlayDb(":memory:");
  let now = 10_000;
  const budget = new PrecomputeBudget(db, () => now);
  for (let i = 0; i < PRECOMPUTE_DAILY_CAP; i++) expect(budget.take()).toBe(true);
  expect(budget.take()).toBe(false);
  const restarted = new PrecomputeBudget(db, () => now);
  expect(restarted.take()).toBe(false);
  expect(restarted.health()).toEqual({ generatedToday: PRECOMPUTE_DAILY_CAP, cap: PRECOMPUTE_DAILY_CAP, lastAt: 10_000 });
  now += DAY;
  expect(restarted.take()).toBe(true);
  expect(restarted.health()).toMatchObject({ generatedToday: 1 });
});

test("an unreadable saved budget spends nothing more that day", () => {
  const db = new OverlayDb(":memory:");
  db.setAiMeta("suggestion_precompute_budget", "{not json");
  const budget = new PrecomputeBudget(db, () => 10_000);
  expect(budget.take()).toBe(false);
});
