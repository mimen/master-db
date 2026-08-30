import { describe, expect, test } from "bun:test";
import { nestedSheetDelay } from "./nested-sheet";

describe("nested action sheets", () => {
  test("waits for the first native iOS sheet to dismiss", () => {
    expect(nestedSheetDelay("ios")).toBe(300);
  });

  test("opens immediately on web and Android", () => {
    expect(nestedSheetDelay("web")).toBe(0);
    expect(nestedSheetDelay("android")).toBe(0);
  });
});
