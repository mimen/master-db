import { expect, test } from "bun:test";

import { nextLeaving, withLeaving } from "./leaving-rows";

const id = (s: string) => s;

test("a settled row stays in its slot while it collapses", () => {
  const leaving = nextLeaving(["a", "b", "c"], ["a", "c"], new Map(), id);
  expect([...leaving.keys()]).toEqual(["b"]);
  expect(withLeaving(["a", "c"], leaving, id)).toEqual(["a", "b", "c"]);
});

test("two rows leaving in a row keep their order", () => {
  const first = nextLeaving(["a", "b", "c", "d"], ["a", "c", "d"], new Map(), id);
  const second = nextLeaving(["a", "c", "d"], ["a", "d"], first, id);
  expect(withLeaving(["a", "d"], second, id)).toEqual(["a", "b", "c", "d"]);
});

test("Undo brings the row back and it stops leaving", () => {
  const leaving = nextLeaving(["a", "b"], ["a"], new Map(), id);
  const undone = nextLeaving(["a"], ["a", "b"], leaving, id);
  expect(undone.size).toBe(0);
  expect(withLeaving(["a", "b"], undone, id)).toEqual(["a", "b"]);
});
