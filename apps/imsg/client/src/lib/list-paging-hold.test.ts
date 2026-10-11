import { expect, test } from "bun:test";

import { holdListPaging, listPagingHeld } from "./list-paging-hold";

test("list paging stays held until every thread hold is released, and a double release counts once", () => {
  const first = holdListPaging();
  const second = holdListPaging();
  first();
  first();
  expect(listPagingHeld()).toBe(true);
  second();
  expect(listPagingHeld()).toBe(false);
});
