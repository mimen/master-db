import { expect, test } from "bun:test";
import { splitAroundMatch } from "./split-match";

test("splits around the first case-insensitive match and keeps the original casing", () => {
  expect(splitAroundMatch("Are you still coming to the showcase Saturday?", "SHO")).toEqual({
    before: "Are you still coming to the ",
    match: "sho",
    after: "wcase Saturday?",
  });
});

test("a match deep in a long message keeps only the nearby lead", () => {
  const split = splitAroundMatch("This is a really long opening sentence before we finally say quarterly numbers", "quarterly");
  expect(split?.before).toBe("…sentence before we finally say ");
  expect(split?.match).toBe("quarterly");
});

test("no match or a blank needle returns null", () => {
  expect(splitAroundMatch("hello", "xyz")).toBeNull();
  expect(splitAroundMatch("hello", "  ")).toBeNull();
});
