import { describe, expect, test } from "bun:test";

import { retirePendingScheduled, withoutPendingScheduled, type PendingScheduled } from "./pending-scheduled";
import { pendingScheduledCount } from "./scheduled";

const row = (bbId: number, status: "pending" | "in-progress" | "complete" = "pending") => ({ bbId, status });
const pending = (...entries: [number, boolean][]): PendingScheduled =>
  new Map(entries.map(([id, confirmed]) => [id, { confirmed }]));

describe("withoutPendingScheduled", () => {
  test("a cancelled or sent-now message leaves the pending count on the tap", () => {
    const rows = [row(1), row(2)];
    expect(pendingScheduledCount(withoutPendingScheduled(rows, pending([1, false])))).toBe(1);
  });

  test("hands back the same rows when nothing pending is in them, so readers do not re-render", () => {
    const rows = [row(1)];
    expect(withoutPendingScheduled(rows, pending([9, false]))).toBe(rows);
  });
});

describe("retirePendingScheduled", () => {
  test("keeps an unconfirmed one even when the mirror already dropped it", () => {
    const intents = pending([1, false]);
    expect(retirePendingScheduled(intents, [])).toBe(intents);
  });

  test("keeps a confirmed send now while the mirror still queues it, and drops it once it went out", () => {
    const intents = pending([1, true]);
    expect(retirePendingScheduled(intents, [row(1)])).toBe(intents);
    expect(retirePendingScheduled(intents, [row(1, "complete")]).size).toBe(0);
  });

  test("drops a confirmed cancel once the mirror deleted the row", () => {
    expect(retirePendingScheduled(pending([1, true]), [row(2)]).size).toBe(0);
  });
});
